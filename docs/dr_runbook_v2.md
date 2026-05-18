# Matika v2.0 — Disaster Recovery Runbook

**Audience:** Primary engineer + backend lead during a data-loss / region-down / config-corruption incident.
**Scope:** Recovery plan for the three persistent stores Matika cares about: RDS PostgreSQL, S3 (FHIR observations), Cognito user pool. Plus the v2.0-specific shape of "single-region acceptable" and the explicit RTO/RPO targets the launch plan §7.1 commits to.
**Companion docs:** `docs/runbook_oncall_v2.md`, `docs/runbook_support_v2.md`, `docs/setup-and-deployment-guide.md`.

> **v2.0 architecture context.** The platform is single-region (`ap-south-1`) by design — DPDP Act data residency. Multi-region active-active is explicitly deferred (launch plan §12 "Out of scope for v2.0"). This runbook documents the recovery posture for that single-region world; multi-region failover is out of scope until v2.1 at the earliest.

---

## RTO / RPO targets (v2.0)

| Surface | Recovery Time Objective (RTO) | Recovery Point Objective (RPO) |
|---|---|---|
| RDS (clinical data) | 1 hour | 5 minutes (PITR granularity) |
| S3 (FHIR observations) | 1 hour | 5 minutes (write-ahead model) |
| Cognito user pool | 4 hours (config rebuild) | 0 (no data is created in Cognito at runtime — every write also lands in RDS via post-confirmation lambda) |
| Lambda / API GW / SNS | 30 minutes (terraform re-apply) | n/a (stateless — recovery = re-apply) |

A "full DR" — entire ap-south-1 region down — is RTO ~24h until we're multi-region. v2.0 ships with the documented assumption that AWS regional outages are accepted downtime risk for the small beta cohort.

---

## Backup architecture overview

One-page summary of what's backed up, by what mechanism, where it lives, and for how long. Detail per surface below the table.

| Surface | Mechanism | Location | Retention | Cross-region? | Automated? |
|---|---|---|---|---|---|
| RDS PostgreSQL | Automated PITR + daily snapshots | Same region (ap-south-1) | prod 35d / non-prod 7d | No (v2.1) | Yes (AWS-managed) |
| RDS pre-deploy snapshots | `aws rds create-db-snapshot` (manual) | Same region | Indefinite until manually deleted | No | No — engineer-triggered |
| S3 documents bucket | Versioning ON | Same region | Noncurrent versions: GLACIER at 30d, expire at 365d | No (v2.1) | Yes |
| S3 raw interactions | Versioning ON | Same region | Noncurrent versions: DEEP_ARCHIVE at 30d, expire at 2555d (7yr) | No | Yes |
| S3 access logs | Versioning ON | Same region | No noncurrent expiry rule | No | Yes |
| Cognito user pool | Manual `aws cognito-idp` export (see §3) | Engineer laptop / ad-hoc S3 | "Since last manual snapshot" — RPO unbounded | No | No (`TARGET` — nightly EventBridge → Lambda) |
| Terraform state | S3 versioning on `carelog-terraform-state` | Same region | Indefinite (every plan/apply versioned) | No | Yes |
| Terraform locks | DynamoDB `carelog-terraform-locks` | Same region | n/a — ephemeral locks | No | Yes |
| Secrets Manager | Automatic per-update versioning | Same region | All versions retained until manually scheduled for deletion | No | Yes |

### 1. RDS backups

- **PITR retention:** `infrastructure/terraform/modules/rds/main.tf:151` — `backup_retention_period = var.environment == "prod" ? 35 : 7`. Prod: 35 days. dev/staging: 7 days. PITR is enabled implicitly any time `backup_retention_period > 0`.
- **Automated daily snapshots:** AWS takes one daily snapshot inside the backup window (`backup_window = "03:00-04:00"` UTC, `modules/rds/main.tf:152`). These snapshots share the `backup_retention_period` lifetime — there is no separate retention knob. No additional snapshot configuration beyond the PITR retention.
- **Snapshot ARN pattern:** `arn:aws:rds:ap-south-1:316643066568:snapshot:rds:carelog-<env>-<YYYY-MM-DD-HH-MM>` for automated snapshots; manual snapshots drop the `rds:` prefix.
- **Multi-AZ:** `modules/rds/main.tf:157` — `multi_az = var.multi_az`. dev defaults to `false` (cost); prod's `environments/prod/main.tf` overrides to `true`. Multi-AZ gives synchronous standby + automatic failover (~30-60s) — NOT a backup, but reduces RTO for hardware/AZ failures.
- **Deletion protection:** `modules/rds/main.tf:170` — `deletion_protection = var.deletion_protection`. dev defaults to `false`; prod passes `true`.
- **Final snapshot:** `modules/rds/main.tf:176-177` — prod takes a final snapshot named `carelog-prod-final-snapshot` on destroy; non-prod skips.
- **Manual pre-deploy snapshots:** NOT automated. Engineer MUST run the following before any risky migration (V0XX with destructive ALTER TABLE, DROP COLUMN, data rewrite, etc.):
  ```bash
  aws rds create-db-snapshot \
    --db-instance-identifier carelog-<env> \
    --db-snapshot-identifier carelog-<env>-pre-V0XX-$(date +%Y%m%d-%H%M) \
    --region ap-south-1
  ```
  Track these in `docs/migrations_log.md` (create if missing). Manual snapshots persist independently of `backup_retention_period`.

### 2. S3 backups

- **Documents bucket** `carelog-v2-<env>-documents-<acct>`: versioning ON (`modules/s3/main.tf:77-82`). Cross-region replication NOT configured — v2.0 known gap, deferred to v2.1.
- **Documents lifecycle** (`modules/s3/main.tf:126-191`):
  - Current versions: STANDARD → INTELLIGENT_TIERING at 90d → GLACIER at 365d.
  - Noncurrent versions: STANDARD → GLACIER at 30d noncurrent, expire at 365d noncurrent.
  - Incomplete multipart uploads abort at 7d.
  - There IS a noncurrent-version expiration. Plan capacity around the 365-day window — versions older than that are unrecoverable.
- **Raw interactions bucket** `carelog-raw-<env>-<acct>`: versioning ON. Lifecycle (`modules/s3/main.tf:375-454`): STANDARD → STANDARD_IA at 90d → DEEP_ARCHIVE at 365d → expire at 2555d (7yr DPDP retention). Noncurrent versions: DEEP_ARCHIVE at 30d, expire at 2555d.
- **Access logs bucket** `carelog-v2-<env>-access-logs-<acct>`: versioning ON. No lifecycle policy — every version retained indefinitely (will need cost cleanup eventually; flag as v2.1 follow-up).
- **Replica bucket (v2.1):** `<DEFERRED v2.1 — multi-region design pending; owner: founder + infra at v2.1 kickoff>` in `<DEFERRED v2.1 — likely ap-southeast-1 or me-south-1 pending DPDP-residency review>` — not yet declared; cross-region replication design is part of the v2.1 multi-region work, NOT in scope for v2.0 (intra-region durability via S3 versioning + DPDP residency on ap-south-1 only).

### 3. Cognito backups

- No native PITR. No native cross-region replication. AWS Cognito has no managed backup feature in 2026.
- **Export mechanism:** described in §3 below. Currently MANUAL — RPO = "since the last manual snapshot." If the snapshot was last taken 14 days ago, 14 days of user-pool drift is unrecoverable.
- **Automation target (`TARGET` — NOT WIRED):** nightly EventBridge schedule → Lambda → write JSON snapshot to `s3://carelog-v2-<env>-documents-<acct>/cognito-snapshots/<date>/`. Track as a launch-plan follow-up; flag in `docs/testing_todos_v2.md` if not already.
- **What the export DOES capture:** pool config (schema, lambda triggers, email/SMS config), user list with attributes, group memberships.
- **What the export DOES NOT capture:** passwords (irrecoverable — restored users must reset), MFA secrets, OAuth refresh tokens. Plan a post-restore comms blast acknowledging password resets.

### 4. Terraform state backups

- S3 versioning ON for `carelog-terraform-state` (`infrastructure/terraform/bootstrap/main.tf:57-62`). Every `terraform plan` write or `terraform apply` creates a new object version.
- `lifecycle { prevent_destroy = true }` on the bucket itself (`bootstrap/main.tf:50-52`) — the bucket cannot be destroyed by terraform.
- Recoverable via `aws s3api copy-object` from a known-good version — see §4 (Configuration recovery) below.
- Lock table `carelog-terraform-locks` in DynamoDB, PAY_PER_REQUEST, hash key `LockID` (`bootstrap/main.tf:94-113`). Also `prevent_destroy = true`. The lock table is operational, not a backup — losing it just stalls applies until recreated.
- **Bootstrap state file** (`infrastructure/terraform/bootstrap/terraform.tfstate`): local-only by design — committed in the repo as a backup. Losing it just means re-importing two resources, not a state rebuild.

### 5. Secrets Manager backups

- Versioning is automatic — every `update-secret` creates a new version with a `VersionId`.
- List versions: `aws secretsmanager list-secret-version-ids --secret-id carelog-<env>-db-password --region ap-south-1`.
- Retrieve a specific version: `aws secretsmanager get-secret-value --secret-id carelog-<env>-db-password --version-id <id> --region ap-south-1`.
- Useful for: rolling back an accidental rotation that broke lambdas; recovering the prior DB password if a manual rotation went wrong.
- Versions are retained until you explicitly schedule the SECRET for deletion (default 30-day recovery window). Old versions of a live secret are NOT auto-pruned.

---

## 1. RDS Point-In-Time Restore (PITR)

**When:** RDS data corruption (bad migration, accidental DELETE, compromised SQL injection) within the last 35 days.

### Step 1 — Identify the target restore time
PITR can recover to any second in the last 35 days. You need to know **when corruption began**.

```bash
# Check the audit_log for the suspect change window
SELECT id, action, resource_type, resource_id, user_id, details, created_at
FROM audit_log
WHERE created_at BETWEEN '<start>' AND '<end>'
ORDER BY created_at;
```

Pick a `restore-to-time` 1-2 minutes BEFORE the first corrupting action.

### Step 2 — Restore to a new instance
```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier carelog-<env> \
  --target-db-instance-identifier carelog-<env>-restored-$(date +%s) \
  --restore-time "2026-05-14T13:42:00Z" \
  --db-subnet-group-name <existing-subnet-group> \
  --vpc-security-group-ids <existing-sg> \
  --region ap-south-1
```
~15-30 min provisioning. The new instance is in the same VPC + subnet group as the original; it does NOT auto-receive traffic.

### Step 3 — Verify the restored data
```bash
# Update bastion SSM tunnel parameter to the new instance endpoint
RESTORED_HOST=$(aws rds describe-db-instances \
  --db-instance-identifier carelog-<env>-restored-<timestamp> \
  --query 'DBInstances[0].Endpoint.Address' --output text)

# Tunnel to the restored instance on a different local port
aws ssm start-session --target i-<bastion-id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$RESTORED_HOST\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"55434\"]}" \
  --region ap-south-1

# Spot-check the affected rows
psql -h 127.0.0.1 -p 55434 -U <admin> -d <db> -c "SELECT count(*) FROM <table>;"
```

### Step 4 — Cut over (the irreversible part)
Two options. Pick based on blast radius.

**Option A — Rename swap (faster, lower risk):**
```bash
# Original → -corrupted-<ts>; restored → original name
aws rds modify-db-instance --db-instance-identifier carelog-<env> --new-db-instance-identifier carelog-<env>-corrupted-$(date +%s) --apply-immediately --region ap-south-1
aws rds modify-db-instance --db-instance-identifier carelog-<env>-restored-<ts> --new-db-instance-identifier carelog-<env> --apply-immediately --region ap-south-1
```
Both ops take ~5 minutes; lambdas reconnect on next cold start. Schedule this during low-traffic window if possible.

**Option B — Selective row replay (lower risk for partial corruption):**
Connect to BOTH the original AND the restored instances. Diff the affected tables. Run targeted INSERT/UPDATE/DELETE statements to bring the original back to the restored state. Use this for surgical fixes (e.g., one bad caregiver delete-patient) rather than full corruption.

### Step 5 — Post-restore checklist
- Verify `terraform plan` returns "No changes." against the original env (the rename keeps the lambda env vars pointing at the same hostname).
- Migrate schema if needed (`flyway info` to confirm V001-V0XX state matches expectations).
- Re-run smoke flows: `caregiver_protocol_setup.yaml` for caregiver-side, `patient_logging_happy_path.yaml` for patient-side.
- Audit log a DR_RESTORE entry with the restore-time + reason.

---

## 2. S3 FHIR Observations Recovery

**When:** Accidental S3 object delete, S3 bucket corruption, region-S3 outage.

### Versioning + replication state (v2.0)

| Bucket | Versioning | Cross-region replication | Notes |
|---|---|---|---|
| `carelog-v2-<env>-documents-<acct>` | ON (s3 module) | NOT configured | All FHIR observations land here |
| `carelog-v2-<env>-access-logs-<acct>` | ON | n/a | S3 access logs |
| `carelog-raw-<env>-<acct>` | ON | n/a | Raw interaction artifacts |

**v2.0 known gap:** cross-region replication is NOT enabled on the documents bucket. This is explicitly deferred to v2.1 (multi-region work). Single-region S3 has 11-9s durability — accidental delete recovery via versioning works; region-down requires regional outage to resolve.

### Step 1 — Restore from version (accidental delete)
```bash
# List versions of the deleted object
aws s3api list-object-versions \
  --bucket carelog-v2-<env>-documents-<acct> \
  --prefix "observations/<patient-id>/<YYYY>/<MM>/<DD>/" \
  --query 'Versions[?IsLatest==`false`]' --region ap-south-1

# Restore the latest non-delete-marker version
aws s3api copy-object \
  --bucket carelog-v2-<env>-documents-<acct> \
  --copy-source "carelog-v2-<env>-documents-<acct>/<key>?versionId=<version-id>" \
  --key "<key>" --region ap-south-1
```

### Step 2 — Verify the restore landed
```bash
aws s3api head-object \
  --bucket carelog-v2-<env>-documents-<acct> \
  --key "<key>" \
  --region ap-south-1 --query 'LastModified'
```

### Step 3 — Backfill missing FHIR-observation references in RDS
The RDS `observations` table is the source of truth for "did the patient log a vital." S3 holds the FHIR-shaped artifact. If S3 was lost but RDS is intact, replay the relevant observations through `construct-fhir-batch` lambda to regenerate the S3 objects.

```bash
aws lambda invoke --function-name carelog-<env>-construct-fhir-batch \
  --cli-binary-format raw-in-base64-out \
  --payload '{"replay_from":"<iso-timestamp>","patient_id":"<uuid>"}' \
  /tmp/fhir-replay.json --region ap-south-1
```

### Region-down playbook
ap-south-1 S3 down: there is no failover. Document downtime, page AWS Support, wait for region recovery. v2.1 cross-region replication is the structural fix.

---

## 3. Cognito user pool export + recovery

**When:** Cognito config corruption, accidental user-pool delete, or pre-DR snapshot for v2.1 multi-region.

### Step 1 — Snapshot the pool config + users
```bash
POOL_ID=ap-south-1_<id>

# Pool-level config
aws cognito-idp describe-user-pool --user-pool-id $POOL_ID --region ap-south-1 \
  > /tmp/cognito-pool-config-$(date +%Y%m%d).json

# All users + their attributes
aws cognito-idp list-users --user-pool-id $POOL_ID --region ap-south-1 \
  --query 'Users[*].{Username:Username,Status:UserStatus,Attributes:Attributes,Created:UserCreateDate}' \
  > /tmp/cognito-users-$(date +%Y%m%d).json

# Group memberships per user (slower — one call per group)
for group in patients caregivers doctors; do
  aws cognito-idp list-users-in-group --user-pool-id $POOL_ID --group-name $group --region ap-south-1 \
    --query "Users[*].Username" --output text \
    > /tmp/cognito-group-$group-$(date +%Y%m%d).txt
done
```

Recommend running this nightly via EventBridge + Lambda → S3 (post-v2.0 work; not currently scheduled).

### Step 2 — Recover by re-creating the pool from snapshot
- terraform recreates the pool from the cognito module (`aws_cognito_user_pool.main` in `modules/cognito/main.tf`) — schema, lambda triggers, email config, group definitions all re-land. **Note:** the pool ID changes; lambdas + Android `amplify_outputs.json` need to be updated to the new pool ID.
- Re-create users from the snapshot via `admin-create-user` (with `MessageAction=SUPPRESS` so they don't get re-onboarded by surprise email).
- Re-add to groups via `admin-add-user-to-group`.
- Manual data the snapshot doesn't capture: passwords (irrecoverable — users must reset). The post-confirmation lambda's RDS users-row insert relies on a confirmed sign-up; for restored users, the RDS row already exists from the original session — reconcile by `cognito_sub` join.

### v2.0 caveat
Cognito user pools have NO native cross-region replication and NO PITR. The export-script approach above is the closest thing. Until we wire the nightly export to S3, RPO for Cognito = "since the last manual snapshot."

---

## 4. Configuration recovery (terraform state)

The terraform state bucket is `carelog-terraform-state` (same bucket for dev/staging/prod, different keys). Versioning is ON; the bootstrap config (`infrastructure/terraform/bootstrap/main.tf:57-62`) enabled it for exactly this reason.

### State corruption recovery
```bash
aws s3api list-object-versions \
  --bucket carelog-terraform-state \
  --prefix dev/terraform.tfstate \
  --region ap-south-1 --query 'Versions'
# Pick a known-good version
aws s3api copy-object \
  --bucket carelog-terraform-state \
  --copy-source "carelog-terraform-state/dev/terraform.tfstate?versionId=<good-version>" \
  --key "dev/terraform.tfstate" --region ap-south-1
# Re-sync
cd infrastructure/terraform/environments/dev
terraform init -reconfigure
terraform plan  # MUST return "No changes."
```

### Lock corruption (DynamoDB)
If `terraform apply` reports "lock held by …" and the holder is gone:
```bash
aws dynamodb delete-item \
  --table-name carelog-terraform-locks \
  --key '{"LockID":{"S":"<lock-id-from-error>"}}' \
  --region ap-south-1
```
Only after confirming no other engineer is mid-apply.

---

## 5. Regional outage (ap-south-1 down)

**When:** AWS ap-south-1 reports a region-wide event, or multiple Matika services in the region are simultaneously unreachable.

### 5.1 Determine scope

First action: figure out whether the region is hard-down, partially degraded, or only one service is affected. Three signals to check IN PARALLEL:

1. **AWS Health Dashboard** — `https://health.aws.amazon.com/health/status` (no auth required). Filter by region `Asia Pacific (Mumbai) ap-south-1`. Account-level events also show in the AWS console Health page (`https://health.aws.amazon.com/health/home`) — log in first.
2. **AWS Support case** — open a SEV-2 case (`aws support create-case` or console). For paid Business/Enterprise support tiers, this gets a human within ~1h.
3. **Synthetic checks** — run a `curl` against the API Gateway base URL from outside ap-south-1 (your laptop). 5xx from edge = AWS-side; timeout = DNS or region-wide; success = Matika app-layer.

Single-service outages (e.g., only Bedrock) → §5.4. Single-AZ → §5.3. Hard region-wide → §5.2.

### 5.2 Hard regional outage (entire ap-south-1 unreachable)

There is no automatic failover. v2.0 is single-region by design — DPDP Act data residency forbids fanning out to a non-India region without a DPDP-aware data classification pass, which is part of v2.1 scope.

Expected downtime: tied to AWS recovery time. AWS regional outages historically resolve in 2-12 hours.

**Actions in order:**

1. **Confirm the outage.** AWS Health Dashboard event + an AWS Support case acknowledgement is the bar. Do NOT trust a single failing curl — the laptop's ISP could be the problem.
2. **Communicate to users via the status page.** Use the customer-facing template in §6.1. Mark status as `Investigating`.
3. **Notify the beta cohort directly via WhatsApp.** Use the template in §6.2. Send from the support phone — for v2.0 beta in solo-founder mode this is the founder's own number (until a dedicated beta-support WhatsApp number provisions per F48). For caregivers who haven't opted into WhatsApp, fall back to SMS via the same template.
4. **Do NOT attempt to re-create infrastructure in a different region during a regional outage.** DPDP requires India residency; deploying to a non-India region would be a compliance violation. Wait for region recovery. The DPDP boundary is a launch-plan §12 hard constraint.
5. **Engineering activity during the outage:**
   - Note the timestamp of last successful backup for each surface (RDS snapshot timestamp, S3 versioning marker, last Cognito snapshot date) — this fixes the RPO you'll be at on recovery.
   - Review the post-incident playbook draft. Queue any data backfill scripts that will be needed (e.g., re-running idempotent reminder dispatches).
   - Do NOT run terraform anywhere — the state bucket is in the same region and writes will fail; partial-apply state is worse than no-apply state.
6. **Recovery cutover:**
   - When AWS marks the region as resolved, smoke-test each surface in this order: RDS → Lambda → API Gateway → Cognito → S3 → Bedrock.
   - For each, run the existing smoke flow if one exists (Maestro flows in `test-automation/`).
   - Only after all 6 are green, update the status page to `Resolved` and send the post-incident message (§6.4).

### 5.3 Partial-region outage (one AZ)

- **RDS:** `modules/rds/main.tf:157` — `multi_az = var.multi_az`. **Prod has multi-AZ ON; dev has it OFF.** In prod, RDS auto-failovers to the standby in a different AZ within ~30-60 seconds. Verify the failover happened:
  ```bash
  aws rds describe-db-instances \
    --db-instance-identifier carelog-prod \
    --query 'DBInstances[0].{AZ:AvailabilityZone,SecondaryAZ:SecondaryAvailabilityZone,Status:DBInstanceStatus}' \
    --region ap-south-1
  ```
  Expect `Status: available` and the primary AZ flipped to the previous standby. No app changes needed — the writer endpoint hostname stays the same.
  In dev, an AZ outage will take RDS down until the AZ recovers. Acceptable for non-prod.
- **Lambda:** Multi-AZ by default across the region's AZs. No action needed.
- **S3:** Multi-AZ by default within the region. No action needed.
- **API Gateway:** Multi-AZ by default. No action needed.

### 5.4 Bedrock-specific outage (only Bedrock down)

The Android app surfaces a Bedrock failure to the user via the raw exception message — `ConversationStateMachine.applyTurnFailure` (`android/app/src/main/java/com/carelog/inference/ConversationStateMachine.kt:125-130`) sets `lastError = error.message ?: error::class.simpleName ?: "Unknown error"`. There is **no friendly mapping layer** — the user sees whatever the SDK exception's `message` is (typically a Bedrock SDK string like `ThrottlingException: Too many requests` or `ServiceUnavailableException: ...`). Flag as a UX-polish follow-up: wrap with a user-facing friendly message similar to the STT `friendlySttErrorMessage` pattern already used in `MatikaConversationViewModel.kt:494`.

**Cross-region inference posture:** Bedrock is NOT configured for cross-region fallback in v2.0. The 2026-05-02 design decision (recorded in `infrastructure/terraform/modules/bedrock/main.tf:6-9`) is in-region direct invocation in ap-south-1 — Claude Haiku 4.5 + Sonnet 4.6 are now native to ap-south-1, so cross-region inference profiles were dropped to keep DPDP residency clean and remove an IAM hop. The model IDs are `global.*` system-defined inference profile IDs (see `bedrock/main.tf:23-31`) — the `global.*` prefix means the profile routes across multiple regions including ap-south-1, but the lambda invokes the profile resident in ap-south-1.

**If Bedrock in ap-south-1 is down:**

1. Verify it's Bedrock and not a lambda IAM/config issue:
   ```bash
   aws bedrock-runtime invoke-model \
     --model-id <BEDROCK_HAIKU_MODEL_ID-from-lambda-env> \
     --body '{"anthropic_version":"bedrock-2023-05-31","max_tokens":10,"messages":[{"role":"user","content":"ping"}]}' \
     --cli-binary-format raw-in-base64-out \
     --region ap-south-1 \
     /tmp/bedrock-test.json
   ```
   Failure here = Bedrock-side. Success = app-layer regression, not a Bedrock outage — stop, investigate the lambda.
2. **Quick mitigation (DPDP caveat — see step 3):** the lambda env vars `BEDROCK_HAIKU_MODEL_ID` and `BEDROCK_SONNET_MODEL_ID` (set in `modules/lambda/main_v2.tf:55-56`) carry the inference-profile IDs. To point the lambda at a different region's profile temporarily:
   ```bash
   # Get current value (preserve it for revert)
   aws lambda get-function-configuration \
     --function-name carelog-<env>-bedrock-router \
     --query 'Environment.Variables.BEDROCK_HAIKU_MODEL_ID' \
     --region ap-south-1
   # Update — replace <NEW_MODEL_ID> with the alt-region profile/model ID
   aws lambda update-function-configuration \
     --function-name carelog-<env>-bedrock-router \
     --environment "Variables={...,BEDROCK_HAIKU_MODEL_ID=<NEW_MODEL_ID>,BEDROCK_SONNET_MODEL_ID=<NEW_MODEL_ID>}" \
     --region ap-south-1
   ```
   Note: `update-function-configuration --environment` REPLACES the entire env-var map — read the current full map first and re-include all keys, otherwise you'll blank out other vars. (See `terraform_lambda_drift_pattern.md` memory — this is the same class of footgun.)
3. **DPDP caveat — DO NOT do step 2 in prod without explicit compliance sign-off.** Routing inference to a non-India region violates DPDP residency. In prod, the correct call is to wait for ap-south-1 Bedrock recovery and communicate downtime. Step 2 is documented for dev/staging dry-runs and as the operational lever IF compliance later gives a written exception.
4. **Revert post-incident:** re-apply terraform to restore the lambda env vars to the source-of-truth values, then verify `aws lambda get-function-configuration` shows the original IDs.

### 5.5 Cognito-specific outage (sign-in down but RDS/Bedrock up)

- **Existing sessions:** continue to work. Cognito tokens live independently of the Cognito control plane. Token TTLs (verified in `modules/cognito/main.tf:240-302`):
  - Mobile app client: access 1h, id 1h, refresh 30d.
  - Web client: access 1h, id 1h, refresh 7d.
  - As long as a user has a valid access token (≤1h old) or a refresh token (≤30d / 7d), the API still works.
- **New sign-ins:** fail with whatever the Cognito-side error is. No workaround possible — Cognito is single-region and has no client-side fallback.
- **Communicate:** use the §6.1 template, scoped to "new sign-ins only" so existing users don't panic.
- **Recovery:** no action on our side. Cognito recovers itself; sign-ins resume.

---

## 6. Communications templates

Ready-to-paste templates for the three outage-comms surfaces. Fill in the placeholders, ship.

### 6.1 Customer-facing status page (markdown)

```
## Service disruption — Matika v2.0
**Status:** Investigating / Identified / Monitoring / Resolved (pick one)
**Started:** <ISO timestamp>
**Affected:** <which features — sign-in, voice logging, push notifications, etc.>

We are investigating reports of <symptom> affecting the Matika app. Your data is safe and stored as normal; the issue is limited to <scope>.

- <ISO timestamp>: Issue identified as <root cause when known>.
- <ISO timestamp>: Mitigation in progress.
- <ISO timestamp>: Service restored. Postmortem to follow within 7 days.

If you need urgent help, please reach out to your assigned caregiver or our beta support: subhajit@kyabla.in (interim — beta-support WhatsApp number TO BE PROVISIONED PRE-BETA per F48).
```

Update cadence: every 30 minutes for SEV-1, every 60 minutes for SEV-2, on state-change only for SEV-3.

### 6.2 WhatsApp message to the beta cohort

**English template:**
```
Hi <Name>, this is the Matika team. We're experiencing a temporary issue with the app (started around <local time>). Your existing data is safe. We expect it to be fixed within <window>. We'll message you again when it's back to normal. Sorry for the inconvenience.
```

**Hindi template:**
```
<DEFERRED — Hindi translation pending; owner: founder coordinating with content team, target T-14 pre-beta. Do NOT machine-translate for outage comms — pre-approved phrasing required for trust.>
```

**Bengali template:**
```
<DEFERRED — Bengali translation pending; owner: founder coordinating with content team, target T-14 pre-beta. Do NOT machine-translate for outage comms — pre-approved phrasing required for trust.>
```

Do NOT machine-translate the Hindi/Bengali versions for outage comms — pre-approved phrasings are required for trust. Block on the content team if needed; default to the English template only.

Send from: founder's own number (interim — beta-support WhatsApp number TO BE PROVISIONED PRE-BETA per F48). List of beta cohort numbers: TO BE PROVISIONED PRE-BETA — owner: founder will publish a private gdoc / encrypted Notion page once the cohort is selected (target T-7 per launch-plan §8 timeline).

### 6.3 Internal Slack incident channel kickoff message

Paste this into the incident channel within 5 minutes of declaring an incident:

```
:rotating_light: INCIDENT START — <YYYY-MM-DD HH:MM> IST
**Title:** <short>
**Severity:** SEV-1 / SEV-2 / SEV-3
**Affected:** <users / features>
**Incident commander:** <handle>
**Comms lead:** <handle>
**Status doc:** <link>
**First update in:** 30 min
```

Cadence: re-post a status snapshot in the same thread every 30 minutes until resolution. The IC owns this — do not let the channel go silent.

### 6.4 Post-incident message (after resolution)

Send via the same channel as the original notification (status page + WhatsApp).

**English:**
```
Hi <Name>, the issue we wrote about earlier is now fixed. The app is back to normal. Thank you for your patience. If you notice anything still not working, please reply to this message.
```

**Hindi / Bengali:** `<DEFERRED — translations pending; owner: founder coordinating with content team, target T-14 pre-beta.>`

Within 7 days of a SEV-1 or SEV-2: publish a public postmortem in `docs/postmortems/<YYYY-MM-DD>-<slug>.md` and link from the status page entry.

---

## DR drill cadence (post-beta)

The launch plan §3.2 GA criteria require a DR drill ("Backup/restore drill: RDS PITR, S3 cross-region replication, Cognito user pool export"). Schedule:
- **Pre-beta (T-21):** Cognito snapshot + restore drill (rebuild pool from export, verify users land).
- **Pre-GA (T-30 from GA):** Full RDS PITR drill against staging — restore an arbitrary point-in-time, verify data integrity, swap back.
- **GA + 30 days:** First quarterly drill in prod.

Document each drill in `docs/dr_drill_log.md` (create on first drill).

> **Drills NEVER run in prod.** Always against staging. The closest a drill ever gets to prod is a read-only inspection of prod's backup metadata (e.g., `aws rds describe-db-snapshots` to confirm prod automated snapshots exist). Any mutation — restore, swap, delete — is a staging-only operation. Prod is exercised by the real-incident response, not by drills.

### Drill 1 — Cognito snapshot + restore (pre-beta, T-21)

**Goal:** prove the export script + admin-create-user re-hydration path actually rebuilds a working pool. Surface any missing attributes / group memberships before a real incident.

- [ ] Run the §3 Step 1 export against the **staging** pool. Confirm three artifacts land in `/tmp/`: pool-config JSON, users JSON, per-group `.txt`.
- [ ] Spot-check the users JSON has `custom:persona_type` and `custom:linked_patient_id` for at least one patient + one caregiver.
- [ ] In a SCRATCH AWS account (or a `carelog-drill-<date>` pool in the same account), `terraform apply` the cognito module to provision a fresh pool.
- [ ] Run an `admin-create-user` loop over the users JSON, then `admin-add-user-to-group` from the per-group `.txt`. Set `MessageAction=SUPPRESS`.
- [ ] Verify count: `aws cognito-idp list-users` against the new pool returns the same N as the snapshot.
- [ ] Sign in as one restored user with a freshly-set password — confirm the access token contains the expected `cognito:groups` claim.
- [ ] Tear down the drill pool (`terraform destroy` of the drill module) and log results in `docs/dr_drill_log.md`.

### Drill 2 — RDS PITR (pre-GA, T-30 from GA)

**Goal:** prove the §1 PITR procedure end-to-end against staging, including the cutover. Time the whole thing — should fit in the 1h RTO.

- [ ] Pick a recent timestamp inside the staging PITR window (last 7 days). Record it.
- [ ] Run §1 Step 2 (`restore-db-instance-to-point-in-time`) against the staging instance. Time from `aws` invocation to `available` status.
- [ ] SSM-tunnel to the restored instance per §1 Step 3. Spot-check row counts against the original.
- [ ] Execute §1 Step 4 Option A (rename swap) against staging. Confirm lambdas reconnect — invoke a known smoke lambda and watch CloudWatch logs.
- [ ] Run the two Maestro flows: `caregiver_protocol_setup.yaml`, `patient_logging_happy_path.yaml`. Both PASS.
- [ ] Swap back and clean up the `-corrupted-<ts>` instance.
- [ ] Total elapsed time logged in `docs/dr_drill_log.md`. If > 60 min, file a follow-up to tighten the runbook before GA.

### Drill 3 — S3 versioning + object-restore

**Goal:** prove that an accidentally deleted FHIR observation can be restored via versioning, including the RDS-to-S3 replay path. Schedule alongside one of the other drills.

- [ ] Pick a non-critical FHIR observation in staging. Note its `s3_key` and `versionId`.
- [ ] `aws s3api delete-object` (no version ID — creates a delete marker).
- [ ] Confirm `aws s3 ls` no longer shows it; confirm `list-object-versions` still does.
- [ ] Execute §2 Step 1 to restore from version. Confirm the object is back via §2 Step 2.
- [ ] Verify the FHIR shape round-trips: download the restored object, parse as JSON, confirm it matches the original.
- [ ] Run the §2 Step 3 replay-from-RDS lambda invocation against a *different* (still-existing) observation. Confirm it produces a new S3 version without duplicating data (idempotency check).
- [ ] Log in `docs/dr_drill_log.md`.

### Drill 4 — Terraform state rollback (annual, lightweight)

**Goal:** verify state-file versioning rollback works without disrupting an env.

- [ ] In a `drill/` workspace (or a throwaway dev env), list state versions: `aws s3api list-object-versions --bucket carelog-terraform-state --prefix drill/terraform.tfstate`.
- [ ] Restore an older version per §4. Run `terraform init -reconfigure && terraform plan`. Expect non-empty plan (drift between rolled-back state and reality).
- [ ] Restore the latest version. Run `terraform plan`. Expect `No changes.`.
- [ ] Log in `docs/dr_drill_log.md`.

### Drill 5 — Comms dry-run (one-off, pre-beta)

**Goal:** prove the §6 templates actually flow through the channels — no broken Slack incident channel, no untested WhatsApp sender, no missing status-page tooling.

- [ ] Spin up a private Slack channel `#drill-incident-<date>`. Post the §6.3 template. Confirm rendering.
- [ ] Send the §6.2 English WhatsApp template to ONE engineer's number (not the beta cohort). Confirm delivery.
- [ ] Post the §6.1 status template to a staging instance of whichever status-page tool we'll use. Status-page tooling is `<TO BE PROVISIONED PRE-BETA — owner: founder; candidates Statuspage.io vs Atlassian Statuspage vs self-hosted Cachet; decision target T-21>`. Confirm rendering + email subscribers receive a notification.
- [ ] Log in `docs/dr_drill_log.md`.

---

*Runbook v1.1 — 2026-05-17 (extended with backup-arch overview, regional outage procedure, comms templates, drill checklist).*

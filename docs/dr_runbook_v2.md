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

## DR drill cadence (post-beta)

The launch plan §3.2 GA criteria require a DR drill ("Backup/restore drill: RDS PITR, S3 cross-region replication, Cognito user pool export"). Schedule:
- **Pre-beta (T-21):** Cognito snapshot + restore drill (rebuild pool from export, verify users land).
- **Pre-GA (T-30 from GA):** Full RDS PITR drill against staging — restore an arbitrary point-in-time, verify data integrity, swap back.
- **GA + 30 days:** First quarterly drill in prod.

Document each drill in `docs/dr_drill_log.md` (create on first drill).

---

*Runbook v1.0 — 2026-05-14 (Stream G).*

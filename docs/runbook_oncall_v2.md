# Matika v2.0 — On-Call Runbook

**Audience:** Engineer on the v2.0 paging rotation.
**Scope:** First-response for the top-10 alerts paging the operator-alerts SNS topic.
**Companion docs:** `docs/runbook_support_v2.md` (patient/caregiver issues), `docs/dr_runbook_v2.md` (disaster recovery), `docs/setup-and-deployment-guide.md` (deploy/restore).

This runbook is opinionated about the **first 3 diagnostic steps** for each alert. Steps assume you have:
- AWS CLI configured for account `316643066568`, region `ap-south-1`.
- Bastion SSM access (instance ID `i-017956fca070240a7`; tunnel pattern in `dev_rds_ssm_tunnel.md` memory).
- Read access to dev/staging/prod CloudWatch logs.

For every alert below, the Alarm Name column matches the live AWS resource exactly so you can `cmd-F` from a paging notification.

---

## Solo-founder paging mode (v2.0 closed beta — M1)

For the closed beta cohort (~10 patients, July 2026 onward), Matika ops runs in **solo-founder mode**:

- **Paging tool:** none. Cloudwatch alarms fan out via the `carelog-<env>-operator-alerts` SNS topic → email to `subhajit@kyabla.in` (the founder). For SEV-1-class alarms, AWS SNS additionally delivers SMS to the same identity via the email-to-SMS gateway (revisit when a dedicated SMS endpoint is provisioned). No PagerDuty / Opsgenie subscription for beta — cost + tooling overhead unjustified for one responder. Decision recorded 2026-05-17 (F48 ops naming pass).
- **On-call rotation:** founder is sole responder for every alarm class. The escalation tree below lists `founder (solo responder)` for every cell; revisit at first ops/eng hire.
- **Auto-escalation policy:** none. If the founder no-acks, there is no secondary tier; honest about current state. The pre-GA tooling decision (PagerDuty vs Opsgenie) is tracked under [F48 → §7.4 launch-plan beta-gate] and must land before the cohort scales past the beta size.
- **Escalation contact for SEV-1 customer-facing > 1h:** founder's own personal phone (not in this repo; held in personal contacts). Until that's surfaced through a paging tool, the implicit assumption is the founder is reachable on the same email/SMS path the alarms already fan out to.

This section becomes a `<TBD>` block again the moment Matika hires a second on-call responder. Until then, the TBDs throughout this doc resolve to the founder.

---

## First 60 seconds

Before any deep diagnosis, run this checklist. The goal is to be oriented enough to triage by 60s, not to fix anything yet.

1. **Acknowledge the page** by replying to the SNS alarm email (or, once provisioned, the paging tool of choice — see §"Solo-founder paging mode"). In solo-founder mode there is no auto-escalation; the founder is the sole responder.
2. **Read the alarm name carefully** — the env prefix tells you blast radius:
   - `carelog-dev-*` → dev, no patient impact, lower urgency.
   - `carelog-staging-*` → staging soak; no patient impact today (closed beta starts July 2026 per `docs/v2_launch_plan.md` §0) but a staging incident may indicate a regression that would page in prod.
   - `carelog-prod-*` or `matika-prod-*` → real patient impact. Treat as SEV-1 default; downgrade only after you've confirmed scope.
3. **Open the CloudWatch dashboard for the affected env:** `https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#dashboards:name=carelog-<env>`. The dashboard is `aws_cloudwatch_dashboard.main` in `infrastructure/terraform/modules/monitoring/main.tf:307`.
4. **Open the failing alarm directly:** `https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#alarmsV2:alarm/<exact-alarm-name>`. Use the alarm name from the page verbatim.
5. **Check if anyone is already responding:** in solo-founder mode (v2.0 beta) the founder is the sole responder, so this step is a no-op. Once a second responder exists, this is where to look for an open `#incidents` (or equivalent) thread for the same alarm name in the last 30 min.
6. **Set a 5-minute "first response" timer.** If you haven't classified the alarm class (RDS / Bedrock / Lambda / API GW / SNS / Cognito) by the timer, page the backend lead — see Escalation tree below. Cognito-class alarms have a tighter 15-min total resolution budget because they affect every sign-in.

If you cannot reach the AWS console (network down, MFA broken, etc.), the founder is the infra lead and the contact path is the same email + SMS already routed via the operator-alerts SNS topic. In solo-founder mode there is no separate infra-lead phone tree.

---

## Top alerts (paging topic: `arn:aws:sns:ap-south-1:316643066568:carelog-<env>-operator-alerts`)

### 1. `carelog-<env>-rds-cpu-high`
**Trigger:** RDS CPU utilization > 80% for 10 minutes.

1. **Open the RDS dashboard** for `carelog-<env>` in the console; check CPU graph + `DatabaseConnections` + read/write IOPS.
2. **Find the loudest queries:** SSM tunnel + `pg_stat_statements`:
   ```sql
   SELECT query, calls, mean_exec_time, total_exec_time
   FROM pg_stat_statements
   ORDER BY total_exec_time DESC LIMIT 10;
   ```
3. **Identify the culprit lambda:** CloudWatch Logs Insights against `/aws/lambda/*` for the same time window with filter `@message LIKE '%error%' OR @message LIKE '%timeout%'`. Common offenders: `evaluate-thresholds-batch` (long join across `parameter_configs` + `observations`), `vital-coverage-rollup` (full-table scan if no index hit).

**Escalate to:** backend lead if not resolved in 30 min. **Mitigations:** scale RDS one tier (`db.t3.small → db.t3.medium`); kill long queries via `pg_terminate_backend`.

### 2. `carelog-<env>-rds-storage-low`
**Trigger:** RDS free storage < 5 GB.

1. **Confirm growth rate:** RDS dashboard → `FreeStorageSpace` graph; eyeball whether it's a sudden spike or a slow drift.
2. **Find the bloat:** SSM tunnel + `SELECT pg_size_pretty(pg_total_relation_size(oid)), relname FROM pg_class ORDER BY pg_total_relation_size(oid) DESC LIMIT 20;`. Usual suspects: `audit_log` (no rotation today), `model_call` (one row per Bedrock invoke).
3. **Vacuum + autovacuum check:** `SELECT relname, last_vacuum, last_autovacuum, n_dead_tup FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;`. Run `VACUUM FULL <table>` only after off-hours notice — it locks the table.

**Escalate to:** infra lead. **Mitigations:** scale storage (`aws rds modify-db-instance --allocated-storage <new>` — online); enable storage autoscaling if not on.

### 3. `carelog-<env>-apigw-5xx-rate`
**Trigger:** API Gateway 5xx error rate > 1% over 5 minutes.

1. **Identify the failing route:** CloudWatch Logs Insights on `API-Gateway-Execution-Logs_*` with `stats count() by resourcePath, status`.
2. **Drill into the lambda behind it:** API GW status 502/504 ≈ lambda timeout/init failure → check the corresponding `lambda-errors-<name>` alarm and its CloudWatch logs.
3. **Check Cognito authorizer:** if 401/403 spike, the user pool may be unhealthy: `aws cognito-idp describe-user-pool --user-pool-id <pool> --query UserPool.Status`.

**Escalate to:** backend lead. **Mitigations:** roll back the most recent deploy if timing correlates; surface a maintenance-banner via the Android app's `/health` endpoint.

### 4. `matika-<env>-bedrock-router-p99-latency`
**Trigger:** bedrock-router P99 duration > 15000ms over 10 minutes — Bedrock-side regression or RDS slow.

1. **Bedrock side:** `aws cloudwatch get-metric-statistics --namespace AWS/Bedrock --metric-name InvocationLatency --dimensions Name=ModelId,Value=global.anthropic.claude-haiku-4-5-20251001-v1:0 --start-time <iso> --end-time <iso> --period 60 --statistics p99 --region ap-south-1`. If p99 > 8s on Bedrock side, it's an upstream regression.
2. **RDS side:** see alarm #1 first 2 steps. The router queries `interaction_sessions`, `model_call`, `parameter_configs` — if any of those slow down, p99 climbs.
3. **Cold-start check:** is the alarm coincident with a deploy? `aws lambda list-versions-by-function --function-name matika-<env>-bedrock-router` — if the latest version is fresh and provisioned concurrency hasn't warmed, that explains the spike.

**Escalate to:** inference-platform owner. **Mitigations:** open an AWS Support case for Bedrock regional capacity; bump provisioned concurrency on the `live` alias.

### 5. `matika-<env>-bedrock-router-throttles` (and `matika-<env>-bedrock-vision-throttles`)
**Trigger:** Lambda being throttled — concurrent-execution quota exhausted.

1. **Confirm via Lambda metrics:** `aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Throttles --dimensions Name=FunctionName,Value=matika-<env>-bedrock-router --period 60 --statistics Sum --start-time <iso> --end-time <iso>`.
2. **Check the account quota:** AWS Console → Service Quotas → AWS Lambda → "Concurrent executions". Current default is 1000 across all functions.
3. **Check provisioned concurrency on the `live` alias:** `aws lambda get-provisioned-concurrency-config --function-name matika-<env>-bedrock-router --qualifier live`.

**Escalate to:** infra lead. **Mitigations:** file Service Quota increase request (24-48h SLA); shed load via the Android app's exponential-backoff path on 429.

### 6. `carelog-<env>-lambda-errors-<function-name>` (38 alarms — one per function)
**Trigger:** Error rate > 5% over 5 minutes for the named function.

1. **Find the error:** CloudWatch Logs Insights against `/aws/lambda/<function-name>` with filter `@message LIKE '%ERROR%' OR @type = 'REPORT' AND @duration > <timeout * 0.9>`.
2. **Recent deploy?** `aws lambda list-versions-by-function --function-name <function-name> --query 'Versions[-3:].[Version,LastModified]'`. If the spike started right after a `LastModified`, the deploy is the suspect.
3. **Schema-mismatch check:** if the error message mentions `column ".*" does not exist` or `relation ".*" does not exist`, it's the v2 partial-schema-migration class — see `v2_partial_schema_migration_class.md` memory + grep markers.

**Escalate to:** the lambda's owner per `docs/v2_launch_plan.md` §4. **Mitigations:** roll back to the prior version (`aws lambda update-alias --function-name … --name live --function-version <prior>`); for schema mismatches, the fix is always in the lambda's INSERT/SELECT to match V001+ column names.

### 7. `matika-<env>-health-endpoint-degraded`
**Trigger:** GET /health returning 5xx — at least one upstream probe (RDS / Bedrock / S3) is failing.

1. **Hit /health directly:** `curl -s "https://<api-id>.execute-api.ap-south-1.amazonaws.com/<env>/health" | python3 -m json.tool`. Each probe surface returns its own status; the failed probe(s) tell you which alert chain to pull next.
2. **If RDS probe failed:** see alarm #1.
3. **If Bedrock probe failed:** see alarm #4.

**Escalate to:** infra lead. **Mitigations:** the failing-probe-specific runbook above.

### 8. `carelog-<env>-alerts-dlq-depth` (and `carelog-<env>-sqs-dlq-depth`)
**Trigger:** Dead-letter queue has messages (depth > 0).

1. **Inspect DLQ message contents:** `aws sqs receive-message --queue-url <dlq-url> --max-number-of-messages 10 --visibility-timeout 30 --region ap-south-1 --query 'Messages[*].Body'`. Each message is the original payload that failed processing 3+ times.
2. **Find the consumer + its error:** the DLQ is paired with a source queue; CloudWatch logs for the consuming lambda will show the failure stack. Common: `notification-sender` failing on missing `device_tokens` row, `evaluate-thresholds-batch` failing on schema drift.
3. **Reprocess after fix:** move messages from DLQ back to the source queue with a small script (boto3 `receive_message` → `send_message` to source → `delete_message` from DLQ). Don't redrive the entire DLQ in one shot — feed in batches.

**Escalate to:** owner of the consuming lambda. **Mitigations:** fix the consumer; redrive messages.

### 9. `carelog-<env>-lambda-duration-evaluate-thresholds-batch`
**Trigger:** evaluate-thresholds-batch P95 duration > 5s over 5 minutes.

1. **Recent vital volume:** `SELECT date_trunc('minute', created_at), count(*) FROM observations WHERE created_at > NOW() - INTERVAL '15 min' GROUP BY 1;` — a sudden burst can push P95.
2. **Lambda log REPORT lines:** Insights query `parse @message /Duration: (?<dur>\d+\.\d+) ms/ | stats avg(dur), max(dur) by bin(5m)` — see if it's a slow-trend or a spike.
3. **Index health:** `EXPLAIN ANALYZE` the threshold-evaluation query against a recent observation; check if index `idx_parameter_configs_patient` is being used.

**Escalate to:** backend lead. **Mitigations:** scale the lambda's memory (more CPU); shard by patient_id range if volume keeps climbing.

### 10. `carelog-<env>-lambda-duration-construct-fhir-batch`
**Trigger:** construct-fhir-batch P95 duration > 5s over 5 minutes.

1. **S3 upload latency:** the lambda writes one S3 object per observation with KMS encryption. Spikes usually come from KMS throttling: `aws cloudwatch get-metric-statistics --namespace AWS/KMS --metric-name ThrottleCount --dimensions Name=KeyId,Value=<key-id>`.
2. **Batch size:** the lambda processes observations in batches read from SQS; check the source queue depth — backlog → larger batches → longer runtime.
3. **HealthLake call:** if `enable_healthlake = true` (currently false in dev/staging), the round-trip to HealthLake adds latency.

**Escalate to:** backend lead. **Mitigations:** reduce SQS batch size; provision more KMS quota.

---

## TARGET alarms — not yet wired (track before beta)

The launch plan §7.3 commits to a broader alarm set than what's in `infrastructure/terraform/modules/monitoring/`. The four below are documented here so a page that *should* exist isn't a surprise on the day someone wires it. None of these will fire today — they're aspirational. If you encounter the underlying symptom, follow the diagnostic steps manually.

### T1. `carelog-<env>-cognito-signin-errors` — TARGET, not yet wired
**Intended trigger:** Cognito sign-in error rate (failed authentication attempts) > 5% over 5 min, OR a sudden spike in `UserNotFoundException` / `NotAuthorizedException` from the user-pool-events EventBridge stream.

1. **Confirm the spike manually:** `aws cognito-idp list-users --user-pool-id ap-south-1_<pool> --region ap-south-1 --query 'Users[?UserStatus==`UNCONFIRMED`] | length(@)'` — sudden growth in UNCONFIRMED can indicate verification email failure.
2. **Check CloudWatch metric:** `aws cloudwatch get-metric-statistics --namespace AWS/Cognito --metric-name SignInThrottles --dimensions Name=UserPool,Value=ap-south-1_<pool> --start-time <iso> --end-time <iso> --period 60 --statistics Sum --region ap-south-1`. AWS publishes a small set of Cognito metrics natively.
3. **Suspect the post-confirmation Lambda:** `/aws/lambda/carelog-<env>-cognito-post-confirmation`. If it's failing, sign-up appears to succeed but the RDS users-row insert silently doesn't happen — see `v2_partial_schema_migration_class.md` memory.

**Escalate to:** backend lead. **Tighter SLO than other alarms** — auth issues block 100% of new users, treat as SEV-1. **Wire-target:** Q3 2026 pre-beta.

### T2. `carelog-<env>-bedrock-guardrail-block-rate` — TARGET, not yet wired
**Intended trigger:** Bedrock Guardrails blocking > 10% of router invocations (likely false positives if it's that high).

1. **Find the blocks:** CloudWatch Logs Insights against `/aws/lambda/matika-<env>-bedrock-router` with `filter @message LIKE '%GuardrailIntervened%' OR @message LIKE '%blocked%'`.
2. **Read the blocked input:** the lambda logs the offending content category (the guardrail rule that fired). If category is health-content-specific (e.g., "self-harm" on a depression-screening turn), the guardrail config needs tightening.
3. **Roll back guardrail config:** if a recent guardrail-version push correlates, `aws bedrock-agent get-guardrail --guardrail-identifier <id> --guardrail-version <prior>` + update the lambda env var.

**Escalate to:** inference-platform owner. **Wire-target:** before any guardrail config bump in prod.

### T3. WorkManager sync backlog growing — TARGET, no server-side alarm possible today
**Symptom (no alarm):** Caregivers report "vitals from yesterday still haven't synced" en masse. Client-side issue — there's no server-side metric because the backlog lives in each device's Room DB until WorkManager fires.

1. **Confirm pattern via support:** is it one device or many? Many = potentially a FhirSyncWorker bug.
2. **Compare observation counts:** if recent `observations.created_at` rows in RDS lag the user's reported logging time by >30 min consistently, the issue is dispatch-side, not RDS-side.
3. **Check Crashlytics:** since Stream C (commit `5be33c3`), `FhirSyncWorker` failures forward to Crashlytics. Look for spike in the Firebase console for project `carelog-7de0c`.

**Escalate to:** Android lead. **Wire-target:** v2.1 — would require app-side telemetry to S3 (e.g., periodic backlog-depth ping). Not in v2.0 scope.

### T4. `carelog-<env>-cognito-drift-detector` — TARGET, not yet wired
**Intended trigger:** a scheduled lambda runs `terraform plan -target=module.cognito -refresh-only` daily and pages if drift detected. Hedges against the `terraform_lambda_drift_pattern.md` class.

1. **Manual drift check:** `cd infrastructure/terraform/environments/<env> && terraform plan -target=module.cognito -refresh-only -no-color | head -50`. Any `~` (update-in-place) or `-/+` (replace) line is drift.
2. **Compare against known intentional drift:** read the latest commit touching `infrastructure/terraform/modules/cognito/` — if drift matches an unmerged change, that's expected.
3. **Reconcile:** if drift is unintentional and the live state is correct (e.g., manual `aws cognito-idp` fix), edit the terraform to match. If terraform is correct, `terraform apply -target=module.cognito` (cautiously — see `v2_launch_plan.md` §3.1 Stream A playbook).

**Escalate to:** infra lead. **Wire-target:** pre-prod-cutover (the Stream A drift apply is the prerequisite).

---

## Pages to ignore unless they recur

- **Single `lambda-errors-<name>` spike during a known deploy.** The alarm window is 5 minutes; a 1-2 minute spike during deploy is normal. Re-pages within 10 min = real.
- **`apigw-5xx-rate` from a known synthetic load test.** Coordinate with whoever's running the test before paging anyone.
- **`rds-storage-low` immediately after a backfill / migration.** Confirm with whoever ran the migration before scaling.
- **`bedrock-router-throttles` during a Bedrock model rolling update.** AWS publishes Bedrock model updates via inference-profile rolling deploys; transient throttles for ~5 min during the roll are normal. Look at `aws bedrock list-inference-profiles --region ap-south-1` to see if a recent profile change is in flight before paging the inference owner.
- **`lambda-errors-<name>` spike correlated with a Bedrock model version bump.** When Anthropic releases a new Bedrock model (e.g., Haiku 4.5 → Haiku 4.6) and we cut over, the router lambda may emit a brief burst of `ValidationException` while the cold-start cache warms. Re-pages within 5 min = real.
- **`rds-storage-low` post-VACUUM.** `VACUUM` returns pages to the table but PostgreSQL doesn't release them to the OS without `VACUUM FULL`. Free-storage metric won't move until the next autovacuum-truncate cycle. Wait 30 min before re-scaling.
- **`apigw-5xx-rate` from a `/health` endpoint probe during deploy.** If the `health` lambda is deploying and the API GW probe hits during the cold-start window, we get a 502. Confirm with deploy log timing before treating as real.
- **`alerts-dlq-depth=1` after a known-bad caregiver delete.** If a caregiver's notification-sender invocation fails because the FCM token rotated, that single message lands in DLQ. Drain via the standard DLQ recipe in alarm #8 above — not a paging-worthy incident on its own unless depth >5.

---

## Escalation tree

Solo-founder mode (v2.0 closed beta — see §"Solo-founder paging mode"): every cell resolves to the founder (`subhajit@kyabla.in`). The "Escalate after" column is meaningful even in solo mode: it sets the SLO budget within which the founder commits to resolve before escalating to the user-facing comms path (status-page update + cohort WhatsApp message — see DR runbook §6.2). Revisit this matrix at first eng/ops hire.

| Alarm class | Primary on-call | Secondary | Lead | Escalate after |
|---|---|---|---|---|
| RDS / database | founder (solo responder) | n/a (solo mode) | founder | 30 min |
| Bedrock / inference | founder (solo responder) | n/a (solo mode) | founder | 30 min |
| API Gateway / Lambda | founder (solo responder) | n/a (solo mode) | founder | 30 min |
| SNS / FCM push | founder (solo responder) | n/a (solo mode) | founder | 60 min |
| Cognito / auth | founder (solo responder) | n/a (solo mode) | founder | **15 min — auth is highest priority, blocks 100% of new sign-ins** |
| S3 / clinical data | founder (solo responder) | n/a (solo mode) | founder | 30 min |
| Cost / quota / Service Quotas | founder (solo responder) | n/a (solo mode) | founder | next business day |
| Crashlytics / mobile crash spike | founder (solo responder) | n/a (solo mode) | founder | 4 hours (not paging-grade unless crash rate >5%) |

### How to wake someone up

In solo-founder mode (v2.0 beta), steps 1-3 collapse to a single fan-out: the operator-alerts SNS topic. Once a second responder exists, this section comes back into play.

1. **Email + SMS via SNS.** All CloudWatch alarms publish to `arn:aws:sns:ap-south-1:316643066568:carelog-<env>-operator-alerts`; subscription is `subhajit@kyabla.in` for v2.0 beta. AWS SNS delivers email instantly and SMS via the email-to-SMS gateway for SEV-1-class alarms.
2. **Phone fallback.** Founder's personal phone is in personal contacts (not in repo — PII). Used only when SNS appears to have failed (no email in 5 min after a known-firing alarm).
3. **PagerDuty / Opsgenie escalation rule** — not provisioned in v2.0 beta. Wire-target: pre-GA / first hire. Tracked in F48 launch-plan beta-gate (also see [§"Solo-founder paging mode"](#solo-founder-paging-mode-v20-closed-beta--m1)).
4. **CEO / founder escalation.** N/A in solo-founder mode — the founder IS the on-call. Once a second responder exists, this step pages `subhajit@kyabla.in` via SMS for SEV-1 customer-facing incidents lasting >1 hour; direct-line support is a core v2.0 beta offering.

---

## On-call hand-off checklist (end of shift)

- [ ] Any open paging incidents handed to next on-call by name.
- [ ] CloudWatch dashboard `carelog-<env>` reviewed; no red panels at hand-off.
- [ ] DLQ depth = 0 (or hand-off includes the message that's stuck).
- [ ] No `terraform plan` drift in dev (`terraform plan` in `infrastructure/terraform/environments/dev/` returns "No changes.").
- [ ] Note any v2-partial-schema-migration grep finds in `docs/testing_todos_v2.md`.

---

## Glossary

Operational vocabulary you'll see in logs and alarm names. Verified against the codebase as of 2026-05-17.

### Conversation FSM states (Android, `inference/ConversationState.kt`)

The Bedrock-driven conversation lives in a finite state machine. Logs and alarms reference state names verbatim.

| State | Meaning |
|---|---|
| `IDLE` | No active conversation; pre-greeting. |
| `CREATED` | Session row written in `interaction_sessions`, no turns yet. |
| `GREETING` | Bedrock has delivered the opening greeting; user has not yet spoken. |
| `EXTRACTING` | Bedrock is mid-extraction of a vital from the user's speech. |
| `PENDING_CONFIRMATION` | Bedrock has a candidate vital; awaiting user "yes/no". |
| `AWAITING_PHOTO` | Vital requires a photo (e.g., medication label); waiting on camera. |
| `PLAUSIBILITY_CHALLENGE` | Bedrock flagged the value as implausible; re-asking user. |
| `EMERGENCY` | Bedrock detected an emergency keyword; triggered escalation flow. |
| `COMPLETE` | Turn ended cleanly with vital persisted. |
| `TERMINAL` | Session ended; persisted to RDS. |
| `TERMINAL_INCOMPLETE` | Session ended without a vital persisted (user dropped off). |
| `PAUSED` | User backgrounded the app mid-turn; resumable. |
| `SUSPENDED` | Backend evicted the session (long idle); not resumable. |
| `EXTRACTING_PROFILE` / `AWAITING_PROFILE_CONFIRMATION` / `PROFILE_CONFIRMED` | Caregiver-onboarding subgraph (V009 mirror). |
| `UNKNOWN` | FSM transition error; client emits this when the server returns a state the client doesn't recognize. **Alarm-worthy if rate >0.** |

Server-side mirror: `backend/database/migrations/V005__bedrock_telemetry.sql` (initial set) and `V009__interaction_sessions_caregiver_onboarding_fsm_states.sql` (caregiver-onboarding subgraph).

### `session_type` values (RDS `interaction_sessions.session_type`)

From `V004__conversational_system.sql:37-39`:

| Value | Meaning |
|---|---|
| `patient_logging` | Patient self-logging a vital (BP, weight, etc.). |
| `caregiver_config` | Caregiver configuring thresholds / reminders for their patient. |
| `caregiver_onboarding` | Caregiver going through the conversational patient-onboarding flow (CG-V2 series). |

### `session_status` values (RDS `interaction_sessions.status`)

`in_progress` → `paused` → `complete` OR `incomplete`. Stuck in `in_progress` >1h is alarm-worthy.

### Observation pipeline stages

End-to-end vital flow, naming each component by its terraform resource:

1. **App-local queue** (Android Room DB, `observations_queue` table) — vital logged offline; WorkManager fires periodically.
2. **`carelog-<env>-sync-observation`** — receives vital, writes to RDS `observations` table.
3. **RDS `observations`** — source of truth for "did the vital land".
4. **SQS `carelog-<env>-fhir-construction-queue`** — async fan-out from `sync-observation`.
5. **`carelog-<env>-construct-fhir-batch`** — reads SQS, builds FHIR R4 Observation JSON, writes to S3 (`s3://carelog-v2-<env>-documents-<acct>/observations/<patientId>/<YYYY>/<MM>/<DD>/<id>.json` with KMS encryption).
6. **`carelog-<env>-evaluate-thresholds-batch`** — separate path; reads `observations` + `parameter_configs`, generates `alerts` rows if thresholds breached.
7. **`carelog-<env>-notification-sender`** — reads SQS-fed alerts, dispatches via SNS → FCM → device.

A vital that landed in #3 but never reached caregiver as alert: investigate #6 first, then #7.

### Persona types (Cognito `custom:persona_type`)

| Value | Meaning |
|---|---|
| `patient` | The person whose vitals are being logged. |
| `caregiver` | Family/staff managing one or more patients. **Formerly "attendant" in v1.0** — the v1→v2 rename is in progress; some lambda names and DB columns still reference `attendant_*` (see `users.attendant_id`-class columns). Don't be surprised by both terms. |
| `relative` | Read-only family member. |

**No `doctor`** — explicitly deferred to Phase 2 per `CLAUDE.md` + `docs/v2_launch_plan.md` §13. If you see `doctor` in a log, that's either v1 legacy data or a Phase 2 dev branch leaking — flag to backend lead.

### F-class bug grep markers (incident history)

Quick reference. Full entries live in `docs/testing_todos_v2.md`.

| Marker | Class |
|---|---|
| `F11..F16` | v2 partial-schema-migration bugs. Grep markers: `alerts.value`, `dt.endpoint_arn`, `alert_reads`, uppercase enums, `audit_log.actor_role` (the V004→V005 rename was incomplete in some lambdas). |
| `F26b` | voice-only edge case (deferred — see memory `v2_open_blockers_endofday_20260515.md`). |
| `F39` | form-submit didn't POST (caregiver credentials screen) — fixed 2026-05-17. |
| `F40` | text-fallback path never POSTs — STILL OPEN as of 2026-05-17. |
| `F41` | Mac Mini Core Audio wedge during bench TTS — structurally open; workaround via remote-TTS (`scripts/matika-tts-server.py`). |
| `F42` | backend Secrets-Manager bug — fixed 2026-05-17. |
| `F43` | voice-onboard phone collection bug — fixed 2026-05-17. |
| `F44` | form-onboard email validation rejecting valid emails — fixed 2026-05-17. |

---

*Runbook v1.1 — 2026-05-17 (extended with first-60s playbook, 4 TARGET alarms, escalation tree, expanded false-positives, glossary). v1.0 baseline: 2026-05-14 (Stream G).*

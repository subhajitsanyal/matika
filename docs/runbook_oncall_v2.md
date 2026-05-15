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

## Pages to ignore unless they recur

- **Single `lambda-errors-<name>` spike during a known deploy.** The alarm window is 5 minutes; a 1-2 minute spike during deploy is normal. Re-pages within 10 min = real.
- **`apigw-5xx-rate` from a known synthetic load test.** Coordinate with whoever's running the test before paging anyone.
- **`rds-storage-low` immediately after a backfill / migration.** Confirm with whoever ran the migration before scaling.

---

## On-call hand-off checklist (end of shift)

- [ ] Any open paging incidents handed to next on-call by name.
- [ ] CloudWatch dashboard `carelog-<env>` reviewed; no red panels at hand-off.
- [ ] DLQ depth = 0 (or hand-off includes the message that's stuck).
- [ ] No `terraform plan` drift in dev (`terraform plan` in `infrastructure/terraform/environments/dev/` returns "No changes.").
- [ ] Note any v2-partial-schema-migration grep finds in `docs/testing_todos_v2.md`.

---

*Runbook v1.0 — 2026-05-14 (Stream G).*

You are the orchestrator continuing the Matika v2.0 launch plan
execution. The authoritative plan is `docs/v2_launch_plan.md` (v1.2).
Read it end-to-end first; everything below assumes you've internalized
it AND the prior session's outcomes.

## State at session start (verify before doing anything)

1. `git pull origin main` and verify clean working tree. The last
   pushed commit was `7dfc0f6`. If HEAD doesn't match, surface and
   stop — someone else may have pushed.
2. Read `docs/v2_launch_plan.md` v1.2 in full (note §1 critical-path
   gate #1 now carries the SES sandbox/production-access decision
   appended at the end of session 4).
3. Read these memory files in order — they are load-bearing for
   what's safe to do this session:
   - `v2_open_blockers_endofday_20260515.md` — UPDATED end of session 4.
     44/52 in-scope PASS. Captures: F26b done (`1ce09cb`), task #23
     SES bounce/complaint live in dev (`2b5585d`), Stream H staging
     stand-up (`d4fdc14`), prod prep scaffold (`43f6678`), SES
     production-access deferral (`7dfc0f6`), staging soak clock
     started 2026-05-15 evening.
   - `v2_stream_d_decisions_20260512.md` — all 5 Stream D items
     resolved. SES sender is `subhajit@kyabla.in` (kyabla.in domain
     identity has DKIM CNAMEs pending DNS; email-level identity
     already verified).
   - `terraform_lambda_drift_pattern.md` — pattern still applies but
     all known drift classes RESOLVED. Non-targeted apply in dev AND
     staging is now safe (both return "No changes." as of session 4 end).
   - `dev_tfvars_plumbing_trap.md` — STILL load-bearing for prod
     env stand-up. Audit `prod/variables.tf` + `prod/main.tf`
     passthroughs against `prod/terraform.tfvars` the moment you
     fill in the live values.
   - `feedback_verify_live_pattern.md` — fix-then-verify-live with
     RDS row + CloudWatch log + device behavior. Non-negotiable.
   - `jane_dev_test_account.md` + `dev_rds_ssm_tunnel.md` — dev
     access. Bastion `i-017956fca070240a7`, tunnel port 55432.
   - `v2_partial_schema_migration_class.md` — grep markers; matters
     for any backend lambda touch.
   - `release_buildconfig_lesson.md` — grep recipe before any Android
     release-build audit.
   - `voice_harness_lessons.md` + `maestro_lessons.md` — only if
     you author voice or Maestro flows.
4. Verify dev SSM tunnel still resolves bastion + RDS endpoint
   before any database work. Always `unset PGPASSWORD` and remove
   tmp files before ending the session.
5. Run `terraform plan` (no flags) in BOTH
   `infrastructure/terraform/environments/dev/` AND
   `infrastructure/terraform/environments/staging/` to confirm both
   trees are still clean ("No changes."). If anything has reappeared,
   surface before continuing — it would indicate someone applied
   or manually changed live since 2026-05-15.

## Hard scope rules (unchanged from session 4)

- **v2.0 is caregiver + patient only.** Doctor portal, doctor
  onboarding, doctor-facing analytics → Phase 2 (GA + 8 weeks).
  Do not work on: DR-V2-* journeys, doctor-portal data-testids,
  F16, CG-V2-10/11/14/15, `invite-doctor`, `doctor-*` lambdas,
  the `doctors` Cognito group beyond preserving it. Web portal
  may not be actively broken — Vite-builds-clean is the
  preservation bar.
- **iOS is parked.** Don't touch `ios/` directories.
- **Goal: 52/52 in-scope non-voice + 2/2 voice PASS by T-30** from
  beta open (M1, target July 2026). Currently 44/52.

## What's already done — do NOT redo

Session 4 (commits `1ce09cb` → `7dfc0f6`) closed:

**Stream D #1 — F26b reminders voice-only.** `1ce09cb`. Manual
reminder UI removed entirely: deleted `ReminderConfigScreen.kt`
(490 lines), `CareLogRoutes.REMINDERS` route + composable,
`onNavigateToReminders` plumbing across `CaregiverHomeScreen` /
`RelativeDashboardScreen` / `CareLogNavHost`, the `caregiver_reminders`
Manage card, and the now-dead `RelativeApiService.getReminderConfig`
/ `updateReminderConfig` / `parseReminderConfigs` / `ReminderConfig`
data class. New `.maestro/flows/cg_v2_13_voice_reminder_config.yaml`
— thin variant of `caregiver_protocol_voice.yaml` with reminder-cadence
utterance. CG-V2-13 PASS-by-architecture. Audit-log "ReminderConfig"
resource-type filter and FCM `carelog_reminders` channel KEPT —
both still relevant (historical audit rows + push delivery channel).

**Task #23 — SES bounce/complaint wiring (DEV).** `2b5585d`. V014
`email_suppression` migration + `ses-suppression-handler` lambda +
`aws_sesv2_configuration_set.matika_default` (provider v5+ dropped
the v1 event-destination resource — use sesv2) +
event-destination `bounce_complaint` (BOUNCE + COMPLAINT) + SNS
topic `matika-dev-ses-events` + topic policy + lambda subscription.
4 email-sending lambdas (invite-attendant / invite-doctor /
process-pending-invites / create-patient-from-voice) now set
`ConfigurationSetName: process.env.SES_CONFIGURATION_SET || undefined`
on SendEmailCommand input. Cognito email_configuration gains
`configuration_set` so PostConfirmation / AdminCreateUser /
FORCE_CHANGE_PASSWORD / password-reset emails route through the
suppression handler. Live-verified: `aws ses send-email
--configuration-set-name matika-dev-default
--destination ToAddresses=bounce@simulator.amazonses.com` → RDS row
landed in ~5s with full bounce metadata; CloudWatch shows
"ses_suppression_upserted" event.

**Stream H — staging environment LIVE.** `d4fdc14`. First-apply
landed clean (411 to add → 411 added, 0 changed, 0 destroyed; final
`terraform plan` → "No changes."). Bastion `i-0f2acdf1a96ee24a6`;
RDS `carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com:5432`;
API GW invoke URL `https://3mni7nx5bf.execute-api.ap-south-1.amazonaws.com/staging`;
tunnel port `55433` (dev uses 55432, prod will use 55434). 14
migrations applied via psql + new
`backend/database/flyway_history_bootstrap.sql` reconciles
flyway_schema_history idempotently. Live evidence: `GET /health`
→ 200 with `{status:healthy, checks:{rds:up, bedrock:up, s3:up}}`
on cold-start ~3.3s. NO Cognito SES eventual-consistency race on
greenfield apply (race only fires on UPDATE of existing Cognito
pool — bit dev during task #23, NOT greenfield staging). Setup
guide v3.5 in same commit corrects the dead SSM-parameter
`/carelog/staging/rds_endpoint` fallback to
`aws rds describe-db-instances`.

**Stream H — staging soak clock started 2026-05-15 evening.**
`alert_email = "subhajit@kyabla.in"` set in `staging/terraform.tfvars`
(gitignored); re-apply landed 58 monitoring resources (1 SNS topic
`arn:aws:sns:ap-south-1:316643066568:carelog-staging-operator-alerts`
+ 1 email subscription **confirmed live** (subscription ARN
`...0bf04094-cb51-40b2-af20-5ea99bc0a10e`; test SNS publish delivered
to inbox end-of-session) + 1 dashboard `carelog-staging` + 55 alarms
= 43 lambda_error_rate + 12 misc). Initial state: 31 OK / 19
INSUFFICIENT_DATA / 0 ALARM. **Soak ends approx 2026-05-22** if no
Critical alarms fire; restart-on-change semantics per launch plan §7.1.

**Prod environment prep.** `43f6678`. New
`infrastructure/terraform/environments/prod/terraform.tfvars.template`
(committed; live `terraform.tfvars` will be gitignored per `*.tfvars`)
inline-documents the 3 wrapper-level decisions (alert_email /
ses_email_arn / ses_from_email) plus the 6 external prereqs gating
prod first-apply. `prod/main.tf` flipped `enable_healthlake = true →
false` per v2.0 scope (launch plan §12). Setup guide v3.5 adds
"Production environment stand-up" section with apply runbook.

**SES production-access decision.** `7dfc0f6`. Production-access
ticket is now a GA gate, NOT a beta gate. Sandbox (200 msg/day,
1 msg/sec, `ProductionAccessEnabled=false` — verified live via
`aws sesv2 get-account`) comfortably covers the 10-patient beta
(~30 emails/day projected). Beta-coordinator per-participant
pre-step: `aws sesv2 create-email-identity --email-identity
<participant_email> --region ap-south-1`, participant clicks AWS
verification link, then app onboarding works (Cognito OTPs +
invite emails + welcome emails all deliver). Currently verified
recipients: `sanyalsubhajit2010+pt/+cg/+att@gmail.com` (dev triad
only). Production-access ticket-ready evidence: live config-set
ARN `arn:aws:sesv2:ap-south-1:316643066568:configuration-set/matika-dev-default`
+ SNS topic `arn:aws:sns:ap-south-1:316643066568:matika-dev-ses-events`.

**Stats:** in-scope PASS 43 → 44/52. Backend backlog 0.
Design-blocked 0. Product-blocked 0. SES sandbox/production-access
RESOLVED (sandbox for beta). Staging environment STOOD UP and
SOAKING.

**Final session-4 gates:** `terraform plan` returns "No changes." in
both dev AND staging. Test SNS publish to `subhajit@kyabla.in`
delivered.

## Execution order — session 5

The critical-path work splits into: (a) passive soak monitoring,
(b) engineering loose ends that don't block beta, (c) product/ops
items that ARE the beta path. Pick by what advances the M1 beta
gate most.

### Stream H — passive staging soak monitoring (~2026-05-15 → 2026-05-22)

The 7-day clock is running. Check at least once per session:

```bash
# Any alarms in ALARM state?
aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix carelog-staging \
  --query 'MetricAlarms[?StateValue==`ALARM`].[AlarmName,StateReason]' \
  --output table
aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix matika-staging \
  --query 'MetricAlarms[?StateValue==`ALARM`].[AlarmName,StateReason]' \
  --output table
```

If any fire: investigate root cause, fix on dev first, re-apply to
staging, **restart the 7-day clock** (memory update). If no alarms
fire by 2026-05-22, the soak passes and prod first-apply unblocks
(modulo other prereqs).

Also worth doing — load 1-2 synthetic Jane-clones into staging so
the soak sees actual traffic patterns (otherwise alarms remain
INSUFFICIENT_DATA on most lambdas):

1. SSM tunnel to staging bastion (`i-0f2acdf1a96ee24a6`), tunnel
   port 55433.
2. Mirror Jane's seed SQL from `jane_dev_test_account.md` but with
   staging UUIDs/cognito-subs.
3. Run 1-2 voice protocol-config sessions against the staging API
   GW (`https://3mni7nx5bf.execute-api.ap-south-1.amazonaws.com/staging`).

### Beta operational prep (P1, calendar-bound)

- **Beta cohort identification.** 10 patients in Bengaluru, July 2026
  (launch plan §3.1). Product side; engineering can't progress this
  alone.
- **SES verified-identity onboarding workflow.** For each beta
  participant: `aws sesv2 create-email-identity --email-identity
  <addr> --region ap-south-1` → participant clicks AWS verification
  link → then app onboarding can email them. Worth scripting in a
  small helper (e.g. `scripts/beta-onboard-recipient.sh <email>`)
  so coordinator doesn't need AWS CLI familiarity.
- **On-call rotation staffing.** Launch plan §7.4. Primary engineer
  per week + escalation tree. The SNS subscriber for prod will need
  to be an alias (e.g. `oncall@matika.in`) NOT a personal inbox —
  per the `prod/terraform.tfvars.template` warning.
- **Bedrock prod quota request.** 100 RPM Haiku / 30 RPM Sonnet (3x
  dev) via AWS Service Quotas console. 1-3 day SLA. File 1 week
  before prod plan-apply per launch plan §7.2.
- **DPDP audit kickoff.** External counsel. Launch plan §8.1.
- **Penetration test engagement.** Third-party firm, 4 weeks before
  beta. Launch plan §8.3.

### Stream G surgical doc edits (P2, ~2-3h)

Pure documentation, no code changes:

- `docs/matika_prd_v2.md` §1.1 v2.0 scope. Add a one-page block
  matching launch plan §1 (caregiver+patient only; doctor portal →
  Phase 2; cross-link to the launch plan).
- `docs/matika_implementation_plan_v2.md` F-number close-outs:
  F5/F7/F8/F28/F29/F17 (F26b already done in session 4). Add new
  rows for Stream A5 telemetry (no F-number) and Stream C consent
  endpoint (no F-number) — frame as "feature delivered" rows.
- `docs/privacy-policy.md` cross-region disclosure update — must
  match the live consent screen text verbatim (consent_version 2.0
  in `consent_records`). Hash the policy text alongside.

### Stream F — PT-V2-06 Bengali voice retest (P3, ~30min)

Mac Core Audio wedge `-66681` — confirm with user that Mac is up,
then run per `docs/journeys_voice.md` PT-V2-06 row. ALSO unblocks
the first bench run of the new `cg_v2_13_voice_reminder_config.yaml`
flow from session 4. If voice journeys still fail post-reboot, the
wedge is deeper than Core Audio.

### Stream E — Manual journey runbooks (P2, ~half-day)

9 manual / wall-clock cases under `docs/runbooks/manual/`:
- PT-V2-10/11/12 (photo OCR — needs real glucometer / printed mock)
- PT-V2-24 (reminder push triggered manually)
- EDGE-V2-05/06/10/12 (wall-clock JWT refresh / idle timeouts)
- EDGE-V2-15 (mic permission revoke)

Each: 1-page runbook for human QA execution during staging soak.
Don't try to automate the wall-clock-bound ones.

### Pre-send check from email_suppression (P3 follow-up to task #23)

Today the 4 email-sending lambdas POPULATE `email_suppression` via
the suppression handler but don't READ it before sending. Add a
pre-send check: `SELECT 1 FROM email_suppression WHERE email = $1`
and skip the send if hit. ~1-2h work; one shared helper module
across the 4 lambdas.

### Prod first-apply (gated; user-initiated, after soak passes)

Setup guide v3.5 has the full runbook. Pre-apply checklist (from
`prod/main.tf` header + `prod/terraform.tfvars.template`):

1. Staging soak passed (no Critical alarms for 7 days).
2. `prod/terraform.tfvars` filled in from the template
   (alert_email = ops alias, ses_email_arn + ses_from_email
   probably reuse kyabla.in for beta consistency).
3. `carelog-prod/fcm-service-account` Secrets Manager secret
   provisioned (copy from dev OR new prod Firebase project).
4. Bedrock prod quotas approved.
5. Cognito snapshot script run and archived for DR.
6. On-call rotation staffed.

Surface to user before running `terraform init && terraform plan
&& terraform apply` in
`infrastructure/terraform/environments/prod/`.

### Phase 2 telemetry dashboards (devops side, not engineering)

The 4 telemetry tables are populated in dev (not yet in staging
since no traffic). Building QuickSight/Grafana dashboards is launch
plan §7.3. Out of scope for this session unless user asks.

## Constraints (carry forward, all binding)

- **Verify live before declaring done.** RDS row + CloudWatch log
  + device behavior where relevant. Non-negotiable per
  `feedback_verify_live_pattern.md`.
- **Terraform safety.** All known drift classes RESOLVED. A
  non-targeted `terraform apply` in dev OR staging is now safe
  (modulo new drift since 2026-05-15). For prod first-apply, expect
  the Cognito SES eventual-consistency race to recur on the SES
  config-set / Cognito user-pool create-order; retry once if it
  fires (greenfield ordering protected staging from this; prod
  may or may not race depending on apply parallelism).
- **Don't touch doctor-side code.** Phase 2. Scope-check yourself
  before any edit to: DR-V2-* tests, web portal, F16, CG-V2-
  10/11/14/15, `invite-doctor`, `doctor-*` lambdas.
- **Don't touch iOS.** Parked.
- **Commit in coherent chunks, push regularly.** HEREDOC commit
  messages; Co-Authored-By the model.
- **Update memory** when a stream completes and state changes
  materially. Open-blockers memory uses
  `v2_open_blockers_endofday_20260515.md` from session 4; rename
  to the new day's date if state changes meaningfully on a NEW day.
- **Use subagents** — Explore for codebase surveys, Plan for
  implementation strategy, Agent (general-purpose / code-reviewer)
  for independent review of non-trivial changes. Don't duplicate
  work the agent is doing.
- **Surface decisions, don't guess** — but the major in-flight
  decisions all landed in session 4 (F26b voice-only, task #23
  scope, SES sandbox-for-beta, prod env scope). Don't re-ask the
  user; treat the captured decisions as the starting assumption.
- **Always `unset PGPASSWORD`** and remove tmp files before ending
  the session. Same for any temporary AWS credentials.

## Definition of session-success

A session is successful if:
- A meaningful stream advances toward 52/52 + the M1 beta gate
- Every fix has a live-evidence triad
- Tracked changes are committed and pushed to origin/main
- Memory file is updated if state changed materially
- The user is told concisely at session end: what advanced, what's
  blocked, what's next

## Open known-knowns the orchestrator should NOT re-discover

Carry forward from session 4 ack:

- `bedrock-router` and `bedrock-vision` lambdas live in
  `infrastructure/terraform/modules/lambda/main_v2.tf` (NOT in
  the top-level `main.tf` or modules/lambda/main.tf). They use
  `matika-${var.environment}` prefix, not `carelog-`. Handler is
  `dist/src/index.handler` (TypeScript compiled). `ses-suppression-handler`
  joined this file in task #23.
- Flyway state needed manual reconciliation for V010 / V011 / V012
  / V013 / V014 in dev (rows inserted directly into
  `flyway_schema_history` with `installed_by='manual-A5'` or
  `'manual-task23'`). Staging used `backend/database/flyway_history_bootstrap.sql`
  (added session 4) for the whole V001..V014 reconcile. If you ship
  V015+, append a row to the bootstrap file AND insert into
  flyway_schema_history when you run the migration.
- `aws_sns_platform_application` does not accept `tags = {}`. Don't
  add it back.
- HAPI FHIR optional deps need blanket `-dontwarn` rules in
  `android/app/proguard-rules.pro` for R8 to pass.
- Gradle JVM heap is `-Xmx6144m` in `android/gradle.properties`.
  Don't downgrade — R8 release minify OOMs at 2 GiB.
- The dev/staging/prod env tfvars are gitignored (`*.tfvars`).
  Declarations in `env/variables.tf` + passthroughs in `env/main.tf`
  ARE source of truth. The `prod/terraform.tfvars.template` (added
  session 4) is committed and documents the live values' decision
  trade-offs.
- Lambda zip-file-list drift is usually noise (test files,
  node_modules variance), not code drift. Diff local `index.js`
  vs `aws lambda get-function` BEFORE assuming a lambda needs
  redeployment.
- Bastion AMI is pinned via `ignore_changes = [ami]`. To
  deliberately update, taint the instance + apply (and update
  the SSM tunnel runbook with the new instance ID if it changes).
- RDS SG `ingress` is `ignore_changes`-guarded. New ingress rules
  go through `aws_security_group_rule` resources, not inline
  `ingress {}` in the VPC module.
- RDS alarms live in `modules/monitoring/main.tf` only.
- Cors gateway templates declared in `modules/api_gateway/main.tf`.
  Don't strip them — AWS will auto-restore and produce permanent
  plan drift.
- API GW COGNITO_USER_POOLS authorizer wants the **ID token**,
  not the access token.
- `sessions.id` requires UUID type — random string sessionIds fail
  at INSERT.
- `audit_log` schema (V001) has `user_persona`, not `actor_role`.
- Cognito user pool requires `name` attribute on admin-create-user;
  without it, confirmSignIn fails with InvalidParameterException.
- The `care-team` lambda accepts EITHER patients.id UUID OR the
  short `patient_id` form (CL-XXXXXX).
- The Maestro `cognito-harness-maestro.sh` wrapper supports
  `cg-v2-01`, `edge-v2-04`, `cg-v2-16`, `edge-v2-09` cases. Pattern
  to mirror for any new admin-API-driven journey.
- John CG + Jane consent_records rows pre-seeded directly in dev
  RDS so post-Stream-C SplashViewModel doesn't divert the canonical
  test pair through ConsentScreen. If those rows ever get
  `withdrawn_at` set, re-seed.

New session-4 known-knowns:

- **SES bounce/complaint pipeline** lives in
  `modules/lambda/main_v2.tf` (the SES + SNS + suppression handler
  block at the bottom). `aws_sesv2_*` resources, not `aws_ses_*`
  (provider v5+ dropped the v1 event-destination resource).
- **Cognito SES eventual-consistency race.** UpdateUserPool validates
  `email_configuration.configuration_set` existence at call time;
  on the same apply that creates the SES configuration set, SES
  hasn't propagated yet → `InvalidParameterException`. Retry once
  and it lands. Fires on UPDATE only, not on greenfield CREATE
  (because Cognito user pool is also created in the same apply
  AFTER SES config set, so by the time validation runs, the set
  exists).
- **Staging bastion**: `i-0f2acdf1a96ee24a6`. **Staging RDS**:
  `carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com`. **API
  GW**: `https://3mni7nx5bf.execute-api.ap-south-1.amazonaws.com/staging`.
- **Tunnel port convention**: dev=55432, staging=55433, prod=55434.
  Open simultaneously for parallel multi-env work.
- **SES sandbox is the BETA target**. Production-access is the GA
  gate. Beta-coordinator per-participant onboarding step:
  `aws sesv2 create-email-identity --email-identity <addr> --region
  ap-south-1`, then participant clicks AWS verification link.
- **Staging operator alerts SNS topic**:
  `arn:aws:sns:ap-south-1:316643066568:carelog-staging-operator-alerts`.
  Subscription to `subhajit@kyabla.in` is CONFIRMED. Test publish
  verified end-of-session 4.
- **Staging monitoring `count=0` toggle**: alert_email empty disables
  the entire monitoring module. Now non-empty in staging tfvars; if
  ever cleared, all 58 alarm resources go away.
- **`backend/database/flyway_history_bootstrap.sql`** is the
  canonical history-table bootstrap for greenfield envs. Idempotent
  (ON CONFLICT DO NOTHING). Append rows as new migrations land.
- **Prod env scope**: `enable_healthlake = false` per launch plan
  §12. Don't flip back in v2.0 cycle.
- **Setup guide v3.5** has the "Production environment stand-up"
  section. Pre-apply checklist + tunnel runbook + flyway
  reconciliation pattern all there.
- **iOS, web portal, doctor-side**: still parked. Vite-builds-clean
  is the web-portal preservation bar.
- **R8 / Crashlytics**: Crashlytics is release-only (commit `3e464ce`
  from session 3). PII grep on existing Log.* calls is clean.

Begin by pulling latest, reading `docs/v2_launch_plan.md`
end-to-end, loading the memory files listed above, and acknowledging
scope. Then pick the next P1/P2 item. Most-leverage candidates if
the soak is still healthy:
- **Stream G surgical doc edits** (PRD §1.1 / impl-plan F-number
  closeouts / privacy-policy update) — pure docs, no infra risk.
- **Pre-send check from email_suppression** — small backend follow-up
  to task #23, ~1-2h.
- **Beta coordinator helper script** (`scripts/beta-onboard-recipient.sh`)
  + a short ops runbook for adding a participant — unblocks beta
  cohort onboarding the moment cohort members are identified.

Avoid:
- **Prod first-apply** — gated on soak passing + 5 other prereqs.
  Don't drive even if user asks unless prereqs are visibly met.
- **Stream E manual runbooks** — important but not soak-gating.
  Pick up once soak is half-way through and there's confidence
  about which alarms behave as expected.

Surface when blocked, when state changes meaningfully on the soak
(any Critical alarm), when a stream is fully landed and ready for
batch review, or when the user needs to make the final go/no-go
call on beta-cohort onboarding or prod first-apply.

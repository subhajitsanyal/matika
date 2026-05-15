You are the orchestrator continuing the Matika v2.0 launch plan
execution. The authoritative plan is `docs/v2_launch_plan.md` (v1.2).
Read it end-to-end first; everything below assumes you've internalized
it AND the prior session's outcomes.

## State at session start (verify before doing anything)

1. `git pull origin main` and verify clean working tree. The last
   pushed commit was `3a9c509`. If HEAD doesn't match, surface and
   stop — someone else may have pushed.
2. Read `docs/v2_launch_plan.md` v1.2 in full.
3. Read these memory files in order — they are load-bearing for
   what's safe to do this session:
   - `v2_open_blockers_endofday_20260514.md` — UPDATED end of session 3.
     43/52 in-scope PASS, backend backlog 0, design-blocked 0. Lists
     active streams that didn't land yet.
   - `v2_stream_d_decisions_20260512.md` — UPDATED 2026-05-14 with
     SES decision RESOLVED → `subhajit@kyabla.in` (kyabla.in domain).
     Email-level identity already verified; Cognito flipped to DEVELOPER
     mode in dev with display name "Matika <…>". DKIM domain identity
     CREATED but waiting on 3 CNAMEs in kyabla.in DNS. SES sandbox
     escape (production-access AWS Support ticket) is a TODO — draft
     written in the session 3 transcript but not submitted.
   - `terraform_lambda_drift_pattern.md` — pattern still applies but
     all known drift classes RESOLVED. Use the CLI-hybrid pattern
     only for genuinely new dependency-pulling resources.
   - `dev_tfvars_plumbing_trap.md` — STILL load-bearing. Audit
     `<env>/variables.tf` + `<env>/main.tf` passthroughs against
     `<env>/terraform.tfvars` the moment you create a new env.
   - `feedback_verify_live_pattern.md` — fix-then-verify-live with
     RDS row + CloudWatch log + device behavior. Non-negotiable.
   - `jane_dev_test_account.md` + `dev_rds_ssm_tunnel.md` — dev
     access; you'll need both for live verification. Bastion
     instance ID still `i-017956fca070240a7` (AMI pinned).
   - `v2_partial_schema_migration_class.md` — grep markers; matters
     for any backend lambda touch. New marker added end of session 3:
     `audit_log.actor_role` (does not exist; column is `user_persona`).
   - `release_buildconfig_lesson.md` — grep recipe before any Android
     release-build audit.
   - `voice_harness_lessons.md` + `maestro_lessons.md` — only if
     you author voice or Maestro flows.
4. Verify the dev SSM tunnel still resolves bastion + RDS endpoint
   before any database work. Always `unset PGPASSWORD` and remove
   tmp files before ending the session.
5. Run `terraform plan` (no flags) in
   `infrastructure/terraform/environments/dev/` to confirm the
   tree is still clean ("No changes."). If anything has reappeared,
   surface before continuing — it would indicate someone applied
   or manually changed live since 2026-05-15.

## Hard scope rules (unchanged from session 3)

- **v2.0 is caregiver + patient only.** Doctor portal, doctor
  onboarding, doctor-facing analytics → Phase 2 (GA + 8 weeks).
  Do not work on: DR-V2-* journeys, doctor-portal data-testids,
  F16, CG-V2-10/11/14/15, `invite-doctor`, `doctor-*` lambdas,
  the `doctors` Cognito group beyond preserving it. Web portal
  may not be actively broken — Vite-builds-clean is the
  preservation bar.
- **iOS is parked.** Don't touch `ios/` directories.
- **Goal: 52/52 in-scope non-voice + 2/2 voice PASS by T-30** from
  beta open (M1, target July 2026). Currently 43/52.

## What's already done — do NOT redo

Session 3 (commits `ceb0467` → `3a9c509`) closed:

**Stream B + C — backend backlog + Cognito email-intercept harness.** All 4
in-scope journeys flipped to PASS:
- CG-V2-01 (`1848a25` predecessor work, full PASS in `de71a4a`/`2f710a6`/`a0d4b56`)
- PT-V2-23 (bundled with CG-V2-01 part 2 — disclosure substring)
- EDGE-V2-04 (`c4c574f` + `389185b` — added `SignInOutcome.NewPasswordRequired`
  + `NewPasswordScreen`; harness fix: `name` is required Cognito attribute)
- CG-V2-16 (`1848a25` — delete-patient cascade, 4 testTags + AlertDialog
  `testTagsAsResourceId` fix, lambda invoke for synthetic patient)
- EDGE-V2-08 (PASS-by-architecture — Bedrock `global.*` profiles handle
  cross-region routing; client-side circuit breaker deferred post-pilot
  per `bedrock_client.ts:9-10`)
- EDGE-V2-09 (`0812cbe` — header-gated chaos invoker
  `bedrock_chaos.ts MalformedJsonBedrockInvoker`; CloudWatch shows
  parse_failed_first → parse_failed_after_retry → HandlerError(503)
  `parse_failed_after_retry_no_output_tags`)

**Stream D #2 + #4 + #5.**
- PT-V2-22 (`003fea5` — `PatientCareTeamScreen`, lambda access check
  now allows patient-self via `patients.user_id` + accepts short
  patient_id form, `isPrimary` surfaced)
- Crashlytics (`3e464ce` — release-only collection gated to
  `!BuildConfig.DEBUG`, mapping uploaded, PII grep zero hits)
- SES sender domain RESOLVED → `subhajit@kyabla.in`. Email-level
  identity verified, dev Cognito flipped to "Matika <subhajit@kyabla.in>"
  (4 lambdas + Cognito EmailConfiguration cascaded). Domain-level
  kyabla.in identity created with EasyDKIM (3 CNAMEs queued for DNS).

**Stream G runbooks.** `2540f42` — `runbook_oncall_v2.md` (top-10
alerts, cmd-F-able alarm names, 3 diagnostic steps each),
`runbook_support_v2.md` (patient/caregiver "can't X" scenarios),
`dr_runbook_v2.md` (RDS PITR, S3 versioning, Cognito export, DR drill).

**Stream H staging prep.** `9b2c27a` — staging env code-side ready;
S3 backend uncommented; `alert_email` + `s3_bucket_prefix` plumbed
per dev_tfvars_plumbing_trap; `staging/terraform.tfvars` written
(gitignored) with kyabla.in SES values. Setup guide v3.4 has the
full first-apply runbook. Dry plan returned **391 to add, 0 to
change, 0 to destroy** — clean greenfield. `terraform apply` is
one user-initiated command away.

**Stream A5 Phase 2 telemetry foundations.** `3a9c509` — V011/V012/V013
migrations applied + flyway-recorded. Three new lambdas
(`conversation-session-rollup`, `alert-flow-rollup`,
`patient-engagement-rollup`) wired with hourly EventBridge crons;
alarms `lambda_error_rate[39, 40, 41]` auto-created via
`all_function_names` append. Live invokes returned non-empty
`rowsUpserted`. `patient_engagement_daily` already shows a
`CL-NC646J` row with `days_since_last_activity=5` — drop-off
signal works end-to-end.

**Stats:** in-scope PASS 36 → 43 / 52. Backend backlog 4 → 0.
Design-blocked 1 → 0. Cognito-interception-blocked 3 → 0.

**Final session-3 gate:** `terraform plan` with no `-target` and
no `-refresh=false`, full refresh enabled = **"No changes."**

## Execution order — session 4

The remaining work splits into autonomous engineering, gated
external coordination, and product calls. Pick by what unblocks
the most launch-plan critical-path items.

### Stream D #1 — F26b voice-only reminders (P2, ~half-day)

Per `v2_stream_d_decisions_20260512.md`: reminders only via
conversation engine in v2.0. Implementation:

1. Hide (or feature-flag) the manual reminder-edit screens in the
   caregiver app — `ReminderConfigScreen.kt` + the navigation entry
   in CaregiverHomeScreen's Manage section.
2. Confirm the voice-driven reminder create/edit handlers in the
   bedrock-router (per voice_harness_lessons.md handlers).
3. Update the Maestro flow for CG-V2-13 to be voice-driven, not
   UI-driven.
4. Spec/PRD update: §6.X reminders section in `docs/matika_prd_v2.md`
   + `docs/matika_implementation_plan_v2.md` F26b row.
5. Catalog row update: CG-V2-13 → PASS via voice.

### Stream H — staging `terraform apply` (gated; user-initiated)

Code-side ready. Two execution paths per the kickoff guidance
"don't drive alone for Stream H":

- **Apply now** (391 resources land with current SES wiring intact).
- **Wait for SES production access** (so cognito module lands fully
  outbound-capable on first apply rather than a re-apply). User
  has deferred the production-access ticket → would also defer
  this apply unless they want to soak with sandbox-only Cognito.

Surface: ask the user when ready before running `terraform init &&
terraform plan && terraform apply` in `infrastructure/terraform/environments/staging/`.

Post-apply: schema migration via SSM tunnel (per setup-guide v3.4
"Staging environment stand-up" section); Maestro smoke against
staging API GW invoke URL; 1-week soak with `alert_email` set.

### Bounce/complaint handling pre-beta (P3 → P2 once staging is live)

Task #23. Required to honor the "we will wire bounce handling"
commitment in the deferred SES production-access ticket draft (in
session 3 transcript, not yet submitted). ~half-day:

1. Create SES configuration set `matika-<env>-default` with
   `Bounce` + `Complaint` event destinations → SNS topic.
2. Subscribe a small lambda `ses-suppression-handler` that reads
   the SNS event, appends to a new `email_suppression` table
   (V014 migration: email VARCHAR PK, reason TEXT, classified_at
   TIMESTAMPTZ).
3. Patch every email-sending lambda (Cognito sends are SES-direct
   so they pick up the configuration set automatically; the
   `invite-attendant` / `invite-doctor` / `process-pending-invites`
   / `create-patient-from-voice` lambdas need `ConfigurationSetName`
   added to their SES SendEmailCommand input).
4. Verify with a controlled bounce (send to
   `bounce@simulator.amazonses.com`).

After this, the SES production-access ticket can cite the live
configuration-set ARN — typically lifts the AWS support reviewer's
last objection.

### Stream G remainder (P2 doc edits, ~2-3h)

Three runbooks landed; surgical edits still pending:

- `docs/matika_prd_v2.md` §1.1 v2.0 scope (caregiver+patient only).
  Add a one-page block matching launch plan §1.
- `docs/matika_implementation_plan_v2.md` F-number close-outs:
  F5/F7/F8/F26b/F28/F29/F17 plus the new ones from this session
  (Stream A5 has no F-number; Stream C consent endpoint has none
  either — frame as "feature delivered" rows).
- `docs/privacy-policy.md` cross-region disclosure update — must
  match the live consent screen text verbatim (consent_version 2.0
  in `consent_records`). Hash the policy text alongside.

### Stream E — Manual journey runbooks (P2, ~half-day)

9 manual / wall-clock cases under `docs/runbooks/manual/`:
- PT-V2-10/11/12 (photo OCR — needs real glucometer / printed mock)
- PT-V2-24 (reminder push triggered manually)
- EDGE-V2-05/06/10/12 (wall-clock JWT refresh / idle timeouts)
- EDGE-V2-15 (mic permission revoke)

Each: 1-page runbook for human QA execution during staging soak.
Don't try to automate the wall-clock-bound ones.

### Stream F — PT-V2-06 Bengali voice retest (P3, ~30min)

Mac-Mini Core Audio wedge `-66681` was reportedly resolved by reboot
end of session 2. Confirm with user that Mac is up, then run per
`docs/journeys_voice.md` PT-V2-06 row. If voice journeys still fail
post-reboot, the wedge is deeper than Core Audio.

### Phase 2 telemetry dashboards (devops side, not engineering)

The 4 telemetry tables (`vital_coverage_daily`,
`conversation_session_daily`, `alert_flow_daily`,
`patient_engagement_daily`) are populated. Building dashboards over
them in QuickSight or Grafana is the launch-plan §7.3 cost-telemetry
+ devops work. Out of scope for this session unless the user
specifically asks.

## Constraints (carry forward, all binding)

- **Verify live before declaring done.** RDS row + CloudWatch log
  + device behavior where relevant. Non-negotiable per
  `feedback_verify_live_pattern.md`.
- **Terraform safety.** All known drift classes RESOLVED. A
  non-targeted `terraform apply` in dev is now safe (modulo new
  drift since 2026-05-15). Still prefer `-target` when adding
  new resources, and verify each step lands clean before chaining.
- **Don't touch doctor-side code.** Phase 2. Scope-check yourself
  before any edit to: DR-V2-* tests, web portal, F16, CG-V2-
  10/11/14/15, `invite-doctor`, `doctor-*` lambdas.
- **Don't touch iOS.** Parked.
- **Commit in coherent chunks, push regularly.** HEREDOC commit
  messages; Co-Authored-By the model.
- **Update memory** when a stream completes and state changes
  materially. The open-blockers memory uses
  `v2_open_blockers_endofday_20260514.md` from session 3; if state
  changes meaningfully on a NEW day, rename to that date.
- **Use subagents** — Explore for codebase surveys, Plan for
  implementation strategy, Agent (general-purpose / code-reviewer)
  for independent review of non-trivial changes. Don't duplicate
  work the agent is doing.
- **Surface decisions, don't guess** — but the 5 Stream D items
  are now all decided (see `v2_stream_d_decisions_20260512.md`).
  Don't re-ask the user; treat the captured decisions as the
  starting assumption.
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

- `bedrock-router` and `bedrock-vision` lambdas live in
  `infrastructure/terraform/main_v2.tf` (NOT `main.tf`). They use
  `matika-${var.environment}` prefix, not `carelog-`. Handler is
  `dist/src/index.handler` (TypeScript compiled).
- Flyway state needed manual reconciliation for V010 / V011 / V012
  / V013 (rows inserted directly into `flyway_schema_history` with
  `installed_by='manual-A5'`). If you ship V014+, follow the same
  pattern OR `flyway repair` first.
- `aws_sns_platform_application` does not accept `tags = {}`. Don't
  add it back.
- HAPI FHIR optional deps need blanket `-dontwarn` rules in
  `android/app/proguard-rules.pro` for R8 to pass.
- Gradle JVM heap is `-Xmx6144m` in `android/gradle.properties`.
  Don't downgrade — R8 release minify OOMs at 2 GiB.
- The dev env's `terraform.tfvars` is gitignored; declarations in
  `dev/variables.tf` + passthroughs in `dev/main.tf` ARE source of
  truth. Same for staging now (commit `9b2c27a`).
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
  not the access token (caught session 3 EDGE-V2-09).
- `sessions.id` requires UUID type — random string sessionIds fail
  at INSERT (caught session 3 EDGE-V2-09).
- `audit_log` schema (V001) has `user_persona`, not `actor_role`
  (caught session 3 Stream C).
- Cognito user pool requires `name` attribute on admin-create-user;
  without it, confirmSignIn fails with InvalidParameterException
  (caught session 3 EDGE-V2-04).
- The `care-team` lambda accepts EITHER patients.id UUID OR the
  short `patient_id` form (CL-XXXXXX) since session 3 PT-V2-22.
  Patient apps know the short form via Cognito `custom:linked_patient_id`.
- The Maestro `cognito-harness-maestro.sh` wrapper supports
  `cg-v2-01`, `edge-v2-04`, `cg-v2-16`, `edge-v2-09` cases. Pattern
  to mirror for any new admin-API-driven journey.
- John CG + Jane consent_records rows pre-seeded directly in dev
  RDS so post-Stream-C SplashViewModel doesn't divert the canonical
  test pair through ConsentScreen. If those rows ever get
  `withdrawn_at` set, re-seed.
- SES sandbox status: `ProductionAccessEnabled=false` as of
  2026-05-14. Sandbox-mode sends only to verified recipients.
  Production access is a deferred TODO; bounce/complaint wiring
  (task #23) should land BEFORE submitting the ticket.

Begin by pulling latest, reading `docs/v2_launch_plan.md` end-to-end,
loading the memory files listed above, and acknowledging scope.
Then pick the next P2 stream (Stream D #1 F26b voice-only is the
most concrete remaining engineering item; bounce/complaint wiring
is the second-most-leverage). Surface only when blocked, when
state changes meaningfully on the staging-apply / SES-production-
access decision, when a stream is fully landed and ready for batch
review, or when the user needs to make the final go/no-go call on
beta-cohort onboarding.

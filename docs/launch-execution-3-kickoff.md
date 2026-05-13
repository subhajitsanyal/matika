# v2.0 launch execution — session 3 kickoff

Paste the block below as the first message of a new Claude session to
resume execution after the 2026-05-12 `launch-execution-2` session.
The orchestrator will load all the v2 memory pointers automatically —
including the two new ones written at the end of session 2:
`v2_open_blockers_endofday_20260512.md` (updated) and
`v2_stream_d_decisions_20260512.md` (new).

---

```
You are the orchestrator continuing the Matika v2.0 launch plan
execution. The authoritative plan is `docs/v2_launch_plan.md` (v1.2).
Read it end-to-end first; everything below assumes you've internalized
it AND the prior session's outcomes.

## State at session start (verify before doing anything)

1. `git pull origin main` and verify clean working tree. The last
   pushed commit was `602d79a`. If HEAD doesn't match, surface and
   stop — someone else may have pushed.
2. Read `docs/v2_launch_plan.md` v1.2 in full.
3. Read these memory files in order — they are load-bearing for
   what's safe to do this session:
   - `v2_open_blockers_endofday_20260512.md` — UPDATED at end of
     session 2. Stream I (residual terraform drift) is RESOLVED;
     the `terraform plan` against dev is fully clean with no
     `-target` and no `-refresh=false`. Staging stand-up is
     unblocked. Lists active streams that didn't land yet.
   - `v2_stream_d_decisions_20260512.md` — NEW. Captures all five
     Stream D decisions made at end of session 2. F26b voice-only,
     PT-V2-22 caregiver-only view, PT-V2-14 deferred to GA,
     Crashlytics over Sentry, SES domain still on HOLD. Treat
     these as the starting assumption unless the user reopens.
   - `terraform_lambda_drift_pattern.md` — pattern still applies
     but Cognito + lambda + API GW route drift classes are now ALL
     RESOLVED. Use the CLI-hybrid pattern only for genuinely new
     dependency-pulling resources.
   - `dev_tfvars_plumbing_trap.md` — still load-bearing for any
     new env stand-up (staging, prod). Audit
     `<env>/variables.tf` + `<env>/main.tf` passthroughs against
     `<env>/terraform.tfvars` the moment you create a new env.
   - `feedback_verify_live_pattern.md` — fix-then-verify-live with
     RDS row + CloudWatch log + device behavior. Non-negotiable.
   - `jane_dev_test_account.md` + `dev_rds_ssm_tunnel.md` — dev
     access; you'll need both for live verification. Bastion
     instance ID is unchanged (i-017956fca070240a7) and the AMI
     is now pinned (`ignore_changes = [ami]`).
   - `v2_partial_schema_migration_class.md` — grep markers; matters
     for any backend lambda touch.
   - `release_buildconfig_lesson.md` — grep recipe before any
     Android release-build audit.
   - `voice_harness_lessons.md` + `maestro_lessons.md` — only if
     you author voice or Maestro flows.
4. Verify the dev SSM tunnel still resolves bastion + RDS endpoint
   before any database work. Always `unset PGPASSWORD` and remove
   tmp files before ending the session.
5. Run `terraform plan` (no flags) in
   `infrastructure/terraform/environments/dev/` to confirm the
   tree is still clean ("No changes. Your infrastructure matches
   the configuration."). If anything has reappeared, surface
   before continuing — it would indicate someone applied or
   manually changed live since 2026-05-12.

## Hard scope rules (unchanged from session 2)

- **v2.0 is caregiver + patient only.** Doctor portal, doctor
  onboarding, doctor-facing analytics → Phase 2 (GA + 8 weeks).
  Do not work on: DR-V2-* journeys, doctor-portal data-testids,
  F16, CG-V2-10/11/14/15, `invite-doctor`, `doctor-*` lambdas,
  the `doctors` Cognito group beyond preserving it. Web portal
  may not be actively broken — Vite-builds-clean is the
  preservation bar.
- **iOS is parked.** Don't touch `ios/` directories.
- **Goal: 52/52 in-scope non-voice + 2/2 voice PASS by T-30** from
  beta open (M1, target July 2026).

## What's already done (do not redo)

Session 1 committed and pushed:

- `89467fc` F8 spec → live `global.*` Bedrock profiles; F5/F7 closed
- `cae9018` A1: deleted `core/BuildConfig.kt` shadow; release APK
  no longer leaks dev URL or runs offline-auth bypass
- `8442fbf` A2: Cognito `lambda_config` inline; null_resource that
  clobbered SES/device_config every apply deleted
- `142285b` A3: F17 Android FCM platform app imported under
  `module.sns`; SNS module stripped to platform apps only;
  iOS APNs gated behind `count = 0`
- `c8bfea3` F29 / CG-V2-16: DELETE /patients/{id} flipped MOCK →
  AWS_PROXY (DPDP right-to-erasure was live-broken)
- `080e945` A5 partial: `vital_coverage_daily` table + rollup
  lambda — first of 4 Phase 2 telemetry rollups
- `f284a06` Lambda drift reconciliation: 9 source_code_hash drifts
  resolved; dev tfvars passthrough trap fixed mid-flight

Session 2 committed and pushed:

- `10737bb` Stream I parts 1-4: declare `aws_lambda_function.delete_patient`
  + log group + permission in `modules/lambda` (import was clean —
  live sha256 matched local). Append to `all_function_names` so
  alarm[37] gets created. Pin bastion AMI via
  `lifecycle.ignore_changes = [ami]` (data.aws_ami auto-refresh was
  about to replace i-017956fca070240a7 and break the SSM tunnel
  runbook). Guard RDS SG ingress via `ignore_changes = [ingress]`
  (the bastion module's separate `aws_security_group_rule.bastion_to_rds`
  was getting silently clobbered every apply by the inline-ingress
  vs. external-rule conflict). Switch `module.lambda.android_platform_arn`
  and `ios_platform_arn` to `module.sns.*` outputs.
- `602d79a` Stream I parts 5-6: dedup duplicate RDS alarm
  declarations (`modules/rds` AND `modules/monitoring` both
  targeted the same alarm names — the rds module's version had
  NO SNS `alarm_actions` and was silently overwriting the
  operator-alerts wiring on every apply, so the alarms would
  fire but never page). Pin `apply_method = "pending-reboot"` on
  `rds.force_ssl` + `client_encoding` (both static parameters
  that AWS auto-corrects server-side, producing a permanent
  plan diff that apply couldn't resolve). Declare
  `response_templates` on cors_4xx/5xx matching AWS's built-in
  DEFAULT_4XX/5XX template (same auto-restore class).

**RESOLVED drift classes (do not re-discover):**
- Cognito drift — RESOLVED session 1.
- Lambda source-code-hash drift — RESOLVED session 1.
- F2 + F17 API GW routes — RESOLVED session 2 (all 9 imports clean,
  no config divergence between code and live).
- Bastion AMI auto-refresh — RESOLVED session 2 (`ignore_changes = [ami]`).
- RDS SG inline-ingress conflict — RESOLVED session 2 (`ignore_changes = [ingress]`).
- Duplicate RDS alarm declarations — RESOLVED session 2 (rds module
  versions removed; monitoring module versions canonical).
- Static-param apply_method permanent-drift — RESOLVED session 2.
- Cors gateway response template auto-restore — RESOLVED session 2.

**Final session-2 gate:** `terraform plan` with no `-target` and
no `-refresh=false`, full refresh enabled = **"No changes."**

## Execution order — session 3

Stream I is done, so Streams B/C/G/A5 can move in parallel without
the staging-stand-up blocker. P0 first.

### Stream D decisions (already captured — don't re-ask)

Per `v2_stream_d_decisions_20260512.md`:
1. F26b reminder UX → **voice-only**. Manual reminder-edit UI
   gets turned off in v2.0; conversation engine owns reminder
   create/edit.
2. PT-V2-22 patient Care Team view → **ship caregiver-only view**
   (small Android-only). Shows `persona_links` rows with
   `relationship = 'caregiver'`; suppress doctor section header
   until Phase 2.
3. PT-V2-14 sustained Sonnet load test → **defer to GA capacity
   testing**. Document the deferral in journey row.
4. Crash reporting → **Firebase Crashlytics** (same Firebase
   project `carelog-7de0c`; no new vendor).
5. SES sender domain → **HOLD**. Don't pick `matika.health` or
   `matika.in` autonomously. Release-variant `API_BASE_URL`
   placeholder TODO at `android/app/build.gradle.kts:48` stays.

### Stream C — Cognito email-intercept harness (P0; concrete, ~1 day)

Untouched since session 1. Build option C: admin-API confirmation-
code capture in the test runner. Unblocks 3 journeys: CG-V2-01,
PT-V2-23, EDGE-V2-04. After landing, run those 3 journeys to flip
them to PASS. The harness doesn't need a verified SES sender
domain — admin API is the right path.

### Stream B remainder — backend backlog (P0; needs harness)

- **CG-V2-16 Maestro flow + E2E cascade test.** F29 wiring landed
  in session 1 (`c8bfea3`); lambda is now fully terraform-managed
  (`10737bb`); alarm[37] is live in CloudWatch
  (`carelog-dev-lambda-errors-carelog-dev-delete-patient`). Author
  the Maestro flow + E2E test. Cascade is destructive — use a
  synthetic test patient (NOT Jane). Verify in dev RDS that all
  child rows are cleared.
- **EDGE-V2-08 Bedrock cross-region failover.** Build the
  Bedrock-mock fault-injection harness; assert client falls back
  to secondary inference profile when primary returns 503.
- **EDGE-V2-09 parse failure.** Same harness; inject malformed
  JSON in structured-output return path; assert graceful T3
  escalation.

The harness is the gating piece for both EDGE-V2 journeys.
~2-3 days total per session-2 notes.

### Stream A5 remainder — Phase 2 telemetry data layer (P1)

Three more rollups, mirror the `vital-coverage-rollup` pattern
(`backend/lambdas/vital-coverage-rollup/index.js` + V010 migration
+ rollup table):

1. `conversation_session_daily` — `model_call` event aggregation
2. `alert_flow_daily` — raised vs acked
3. `patient_engagement_daily` — drop-off detection

Each needs an EventBridge hourly schedule + a `lambda_error_rate`
alarm (auto-created via `all_function_names` append at the end of
the list — appending preserves the count-indexed alarm mapping,
see session 2's note).

Schema design needed before building. Surface to user for input
before writing migration files.

### F26b voice-only implementation (newly unblocked)

Per Stream D decision: reminders only via conversation engine in
v2.0. Implementation:

1. Remove (or hide behind feature flag) the manual reminder-edit
   screens in the caregiver Android app.
2. Confirm the voice-driven reminder create/edit flow is in
   place (check `voice_harness_lessons.md` for the relevant
   handlers).
3. Update Maestro flow for CG-V2-13 to be voice-driven, not
   UI-driven.
4. Spec/PRD update: §6.X reminders section.

### PT-V2-22 caregiver-only Care Team view (newly unblocked)

Per Stream D decision: small Android-only change. Patient-side
view that lists `persona_links` rows with
`relationship = 'caregiver'`. Suppress doctor rows / section
header. Existing `care-team` lambda already returns the data;
just need the UI.

### Crashlytics wiring (newly unblocked)

Per Stream D decision: Firebase Crashlytics. Same Firebase
project (`carelog-7de0c`). Wire:

1. `com.google.firebase:firebase-crashlytics-ktx` + gradle plugin.
2. Initialize in the Application class.
3. Strip PII from breadcrumbs (look at the `release_buildconfig_lesson`
   audit pattern — same grep recipe for `Log.d` with PHI).
4. Test with a forced crash on a dev build (`Crashlytics.crash()`).
5. Don't enable for debug builds; only release (BuildConfig-gate).

### Stream G — Doc backfill (P2; can run parallel)

Three new runbooks pending. Each <1 day:

- `docs/runbook_oncall_v2.md` — top-10 alerts + first 3 diagnostic
  steps for each. Now meaningful with all alarms wired (RDS CPU /
  storage, 5 new lambda_error_rate alarms).
- `docs/runbook_support_v2.md` — "patient/caregiver can't X" +
  remediation.
- `docs/dr_runbook_v2.md` — RDS PITR, S3 replication, Cognito export.

Plus surgical edits:
- PRD §1.1 v2.0 scope (caregiver+patient only)
- impl-plan F-number close-outs (F5, F7, F8, F28, F29 all RESOLVED)
- privacy-policy cross-region disclosure (Bedrock `global.*`)
- setup-guide staging + prod sections (now actionable since
  Stream I is done)

### Stream E — Manual journey runbooks (P2)

9 manual / wall-clock cases (timers, photos, mic permission revoke).
Author concise per-journey runbooks under `docs/runbooks/manual/`
so a human can execute during staging soak. Don't try to automate
wall-clock-bound ones.

### Stream F — Voice retest (P2)

`PT-V2-06 Bengali` was bench-blocked on the Mac Core Audio wedge
(`-66681`). **The Mac is being rebooted as part of the
session-2→session-3 handoff** — so PT-V2-06 retest is unblocked.
Run per `docs/journeys_voice.md` PT-V2-06 row when picking up
voice work. If voice journeys still fail post-reboot, the wedge
is deeper than Core Audio.

### Stream H — External coordination (P2; staging stand-up newly unblocked)

Don't drive alone — prepare what's needed, then surface:

- **Staging environment first-apply** — gated on Stream I, which
  is now done. Stream H staging stand-up is the next big-ticket
  item. Audit `environments/staging/terraform.tfvars` against
  `staging/variables.tf` per `dev_tfvars_plumbing_trap.md` BEFORE
  any plan. Same for prod when it's time.
- DPDP audit gap analysis (engage legal). F29 wiring is live
  evidence of right-to-erasure; pull the live HTTP 403 +
  CloudWatch log + the terraform import history into the analysis.
- Pen test scope doc (engage vendor). Release APK is clean per
  `cae9018` — note this in the scope.
- Bedrock prod quota increase (AWS ticket). Justification: 3× dev
  = 100 RPM Haiku + 30 RPM Sonnet on `global.*` profiles.
- Prod environment first-apply — gated on staging soak.

## Constraints (carry forward from session 2, all still binding)

- **Verify live before declaring done.** RDS row + CloudWatch log
  + device behavior where relevant. Non-negotiable per
  `feedback_verify_live_pattern.md`.
- **Terraform safety.** All known drift classes are RESOLVED. A
  non-targeted `terraform apply` in dev is now safe (modulo new
  drift since 2026-05-12). Still prefer `-target` when adding
  new resources, and verify each step lands clean before chaining.
- **Don't touch doctor-side code.** Phase 2. Scope-check yourself
  before any edit to: DR-V2-* tests, web portal, F16, CG-V2-
  10/11/14/15, `invite-doctor`, `doctor-*` lambdas.
- **Don't touch iOS.** Parked.
- **Commit in coherent chunks, push regularly.** HEREDOC commit
  messages; Co-Authored-By the model.
- **Update memory** when a stream completes and state changes
  materially. The open-blockers memory still uses
  `v2_open_blockers_endofday_20260512.md`; if state changes
  meaningfully on a NEW day, rename to that date.
- **Use subagents** — Explore for codebase surveys, Plan for
  implementation strategy, Agent (general-purpose / code-reviewer)
  for independent review of non-trivial changes. Don't duplicate
  work the agent is doing.
- **Surface decisions, don't guess** — but the 5 Stream D items
  are already decided (see `v2_stream_d_decisions_20260512.md`).
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
  blocked, what's next, and whether any of the Stream D decisions
  need to be revisited

## Open known-knowns the orchestrator should NOT re-discover

- `bedrock-router` and `bedrock-vision` lambdas live in
  `infrastructure/terraform/main_v2.tf`, NOT `main.tf`. They use
  `matika-${var.environment}` prefix, not `carelog-`. Handler is
  `dist/src/index.handler` (TypeScript compiled).
- Flyway state needed manual reconciliation in session 1: V006-V009
  show pending in `flyway_schema_history` though the columns exist
  live (manual F17 deploy via psql). V010 was applied via psql +
  manually inserted into `flyway_schema_history`. If you ship V011+,
  use the same pattern OR `flyway repair` first — surface to the
  user before deciding.
- `aws_sns_platform_application` does not accept `tags = {}`. Don't
  add it back.
- HAPI FHIR optional deps (Thymeleaf, Schematron, AWT, JAXB crypto,
  javax.naming) need blanket `-dontwarn` rules in
  `android/app/proguard-rules.pro` for R8 to pass.
- Gradle JVM heap is `-Xmx6144m` in `android/gradle.properties`.
  Don't downgrade — R8 release minify OOMs at 2 GiB.
- The dev env's `terraform.tfvars` is gitignored. Variable
  declarations in `dev/variables.tf` + passthroughs in
  `dev/main.tf` ARE source of truth.
- Lambda zip-file-list drift is usually noise (test files,
  node_modules variance), not code drift. Diff local `index.js`
  vs `aws lambda get-function` BEFORE assuming a lambda needs
  redeployment. Both delete-patient (session 2) and the 9
  reconciled lambdas (session 1) followed this pattern.
- Bastion AMI is now pinned via `ignore_changes = [ami]`. To
  deliberately update, taint the instance + apply (and update
  the SSM tunnel runbook with the new instance ID if it changes).
- RDS SG `ingress` is now `ignore_changes`-guarded. New ingress
  rules go through `aws_security_group_rule` resources, not
  inline `ingress {}` in the VPC module.
- RDS alarms live in `modules/monitoring/main.tf` only. Don't
  re-add to `modules/rds/main.tf` — session 2 explicitly removed
  the duplicates and they would silently overwrite SNS wiring.
- Cors gateway templates are now declared in
  `modules/api_gateway/main.tf`. Don't strip them — AWS will
  auto-restore and produce permanent plan drift.

Begin by pulling latest, reading `docs/v2_launch_plan.md` end-to-end,
loading the memory files listed above, and acknowledging scope.
Then pick a P0 stream (Stream C or Stream B remainder) and drive
it to landing. Surface only when blocked, when state changes
meaningfully on the SES domain decision (Stream D #5), when
Stream B/H needs the user, or when a stream is fully landed
and ready for batch review.
```

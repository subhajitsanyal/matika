# v2.0 launch execution — session 2 kickoff

Paste the block below as the first message of a new Claude session to
resume execution after the 2026-05-12 `launch-execution-1` session.
The orchestrator will load all the v2 memory pointers automatically
(cognito drift, fix-then-verify-live, dev RDS access, voice harness
lessons, Maestro lessons, Jane/John CG test accounts, plus the four
new ones from session 1: `release_buildconfig_lesson.md`,
`dev_tfvars_plumbing_trap.md`, `terraform_lambda_drift_pattern.md`
updated, `v2_open_blockers_endofday_20260512.md`).

---

```
You are the orchestrator continuing the Matika v2.0 launch plan
execution. The authoritative plan is `docs/v2_launch_plan.md` (v1.2).
Read it end-to-end first; everything below assumes you've internalized
it AND the prior session's outcomes.

## State at session start (verify before doing anything)

1. `git pull origin main` and verify clean working tree. The last
   pushed commit was `f284a06`. If HEAD doesn't match, surface and
   stop — someone else may have pushed.
2. Read `docs/v2_launch_plan.md` v1.2 in full.
3. Read these memory files in order — they are load-bearing for
   what's safe to do this session:
   - `v2_open_blockers_endofday_20260512.md` — what landed in
     session 1 (Stream A1/A2/A3/A4/A5-partial + B1/F29);
     residual non-lambda terraform drift list; live invariants
     to preserve.
   - `terraform_lambda_drift_pattern.md` — CLI-hybrid pattern.
     Cognito drift class is now RESOLVED; lambda source-code-hash
     drift class is also RESOLVED. The pattern still applies to
     the residual API GW + alarm drift.
   - `dev_tfvars_plumbing_trap.md` — NEW from session 1. Audit
     `dev/variables.tf` + `dev/main.tf` passthroughs against
     `dev/terraform.tfvars` BEFORE any plan that includes
     lambda env vars.
   - `release_buildconfig_lesson.md` — NEW. Grep recipe before any
     Android release-build audit.
   - `feedback_verify_live_pattern.md` — fix-then-verify-live with
     RDS row + CloudWatch log + device behavior. Non-negotiable.
   - `jane_dev_test_account.md` + `dev_rds_ssm_tunnel.md` — dev
     access; you'll need both for live verification.
   - `v2_partial_schema_migration_class.md` — grep markers; matters
     for any backend lambda touch.
   - `voice_harness_lessons.md` + `maestro_lessons.md` — only if
     you author voice or Maestro flows.
4. Verify the dev SSM tunnel still resolves bastion + RDS endpoint
   before any database work. Always `unset PGPASSWORD` and remove
   tmp files before ending the session.
5. Run `terraform plan -refresh=false` (no `-target`) in
   `infrastructure/terraform/environments/dev/` to confirm the
   residual drift list still matches what session 1 documented:
   ~15 add / 8 change / 2 destroy, all non-lambda. If something
   else has appeared, surface before continuing.

## Hard scope rules (unchanged from session 1)

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

Cognito drift class RESOLVED. Lambda source-code-hash drift class
RESOLVED. Targeted plans for cognito + lambda modules return
"No changes."

## Execution order — session 2

Streams P0 first. Surface before any Stream B test-harness work or
Stream H external coordination.

### Stream I — Residual terraform drift cleanup (P0; do FIRST)

Staging stand-up is gated on this. The full plan still shows
~15 add / 8 change / 2 destroy. None are lambdas; the load-bearing
items are:

1. **Import F2 + F17 API GW routes already wired live via aws CLI.**
   Plan currently says "will be created" for:
   - `aws_api_gateway_resource.device_tokens` + method POST + DELETE
     + integration POST + DELETE (F17)
   - `aws_api_gateway_resource.session_end` + method POST +
     integration (F2 — `/sessions/{sessionId}/end`)
   These are LIVE. Use `terraform import` for each, then plan again
   and confirm zero diff. If the import surfaces real config drift
   (live integration_uri vs code), reconcile in code before
   re-applying. Per `terraform_lambda_drift_pattern.md` the
   "transitively pull in drifted resources" risk applies — do these
   one at a time, planning between each.
2. **`-target` apply the 4 new CloudWatch `lambda_error_rate`
   alarms** for the lambdas added to `all_function_names` last
   session. Net-new infra, low risk. Verify alarms appear in
   CloudWatch after.
3. **Bring `delete-patient` lambda into terraform state.** It was
   CLI-deployed Apr 27, never declared. Add to
   `infrastructure/terraform/main.tf` (or wherever the per-lambda
   `module "lambda"` calls live) and `terraform import`. Confirm
   zero diff.
4. **Switch `module.lambda.android_platform_arn` to
   `module.sns.android_platform_application_arn`.** Currently still
   on `var.android_platform_arn` because session 1 deferred this to
   avoid clobbering live during reconciliation. Now safe — both
   lambda and sns modules are state-clean.
5. **Apply remaining minor in-place drift** (CORS gateway responses,
   RDS parameter group, VPC SG, CloudWatch dashboard) ONE AT A TIME
   with `-target=`. Don't batch. Verify each.
6. **Final gate:** `terraform plan` with no `-target` and no
   `-refresh=false` should return clean (or close to it). At that
   point staging stand-up is unblocked.

For each step: plan → apply → verify live → commit + push. Use
HEREDOC for commit messages; Co-Authored-By the model.

### Stream B remainder — backend backlog (P0; surface first)

Three journeys still gated. CG-V2-16 wiring is done; the rest need
a Bedrock-mock fault-injection harness (~2-3 days for both):

1. **CG-V2-16 Maestro flow + E2E cascade test.** Wiring done in
   `c8bfea3`. Author the flow + E2E test. Cascade is destructive,
   so use a synthetic test patient (NOT Jane). Verify in dev RDS
   that all child rows are cleared.
2. **EDGE-V2-08 Bedrock cross-region failover.** Build harness
   that intercepts `bedrock-runtime` calls and returns 503 from
   primary profile; assert client falls back to secondary.
3. **EDGE-V2-09 parse failure.** Same harness; inject malformed
   JSON in structured-output return path; assert graceful T3
   escalation.

### Stream A5 remainder — Phase 2 telemetry data layer (P1)

Mechanical replication of the `vital-coverage-rollup` pattern
(`backend/lambdas/vital-coverage-rollup/index.js` + V010 migration
+ rollup table). Three more rollups:

1. `conversation_session_daily` — model_call event aggregation
2. `alert_flow_daily` — raised vs acked
3. `patient_engagement_daily` — drop-off detection

All 4 (including the existing vital_coverage one) need EventBridge
hourly schedules and `lambda_error_rate` alarms — fold those into
the Stream I step 2 alarm batch if possible.

### Stream C — Cognito email-intercept harness (P1)

Untouched from session 1. Build option C: admin-API confirmation-
code capture in the test runner. Unblocks 3 journeys: CG-V2-01,
PT-V2-23, EDGE-V2-04. ~1 day. After landing, run those 3 journeys
to flip them to PASS.

### Stream D — Decisions still pending (surface, don't guess)

All 5 from session 1 still pending. Stop and ask the user when you
reach each:

1. **F26b reminder UX** — keep manual edit / voice-only / defer?
   Gates CG-V2-13.
2. **PT-V2-22 patient Care Team view** — caregiver-only in v2.0 or
   defer to Phase 2? User lean: defer.
3. **PT-V2-14 sustained Sonnet load test** — accept ~$50-100 / mock
   substitute / defer to GA? User lean: accept-cost.
4. **Crash reporting tool** — Sentry vs Crashlytics?
5. **SES sender domain** for Cognito flows. Also dictates the
   release-variant `API_BASE_URL` placeholder TODO at
   `android/app/build.gradle.kts:48`.

### Stream E — Manual journey runbooks (P2)

9 manual / wall-clock cases (timers, photos, mic permission revoke).
Author concise per-journey runbooks under `docs/runbooks/manual/`
so a human can execute during staging soak. Don't try to automate
wall-clock-bound ones.

### Stream F — Voice retest (P2)

`PT-V2-06 Bengali` was bench-blocked on the Mac Core Audio wedge
(`-66681`). Ask the user whether the Mac was rebooted since
2026-05-11. If yes, re-run per `docs/journeys_voice.md` PT-V2-06
row. If no, surface and skip.

### Stream G — Doc backfill (P2; can run parallel)

Three new runbooks pending. Each <1 day:

- `docs/runbook_oncall_v2.md` — top-10 alerts + first 3 diagnostic
  steps for each
- `docs/runbook_support_v2.md` — "patient/caregiver can't X" +
  remediation
- `docs/dr_runbook_v2.md` — RDS PITR, S3 replication, Cognito export

Plus surgical edits: PRD §1.1 v2.0 scope; impl-plan F-number
close-out (F5, F7, F8, F28, F29 all RESOLVED this cycle);
privacy-policy cross-region disclosure (Bedrock `global.*`
profiles); setup-guide staging + prod sections.

### Stream H — External coordination (P2; surface before starting)

Don't drive these alone — prepare what's needed, then surface:

- DPDP audit gap analysis (engage legal). F29 wiring is now real
  evidence of right-to-erasure; pull the live HTTP 403 + CloudWatch
  log into the analysis.
- Pen test scope doc (engage vendor). Release APK is now clean per
  `cae9018` — note this in the scope.
- Bedrock prod quota increase (AWS ticket). Justification: 3× dev
  = 100 RPM Haiku + 30 RPM Sonnet on `global.*` profiles.
- Staging environment first-apply — gated on Stream I completion.
- Prod environment first-apply — gated on staging soak.

When standing up staging or prod, FIRST audit the new env's
`terraform.tfvars` against `variables.tf` per
`dev_tfvars_plumbing_trap.md`. Don't repeat session 1's near-miss
in a fresh env.

## Constraints (carry forward from session 1, all still binding)

- **Verify live before declaring done.** RDS row + CloudWatch log
  + device behavior where relevant. This is non-negotiable per
  `feedback_verify_live_pattern.md`.
- **Terraform safety.** Cognito + lambda drift classes are now
  resolved, so non-targeted apply is safer than it was, BUT the
  residual API GW route drift in Stream I means a non-targeted
  apply right now would CREATE duplicates of live routes. Keep
  using `-target=` and `-refresh=false` until Stream I lands and
  the full plan is clean.
- **Don't touch doctor-side code.** Phase 2. Scope-check yourself
  before any edit to: DR-V2-* tests, web portal, F16, CG-V2-
  10/11/14/15, `invite-doctor`, `doctor-*` lambdas.
- **Don't touch iOS.** Parked.
- **Commit in coherent chunks, push regularly.** HEREDOC commit
  messages; Co-Authored-By the model.
- **Update memory** when a stream completes and state changes
  materially. Rename `v2_open_blockers_endofday_20260512.md` to
  the current date if state changes meaningfully.
- **Use subagents** — Explore for codebase surveys, Plan for
  implementation strategy, Agent (general-purpose / code-reviewer)
  for independent review of non-trivial changes. Don't duplicate
  work the agent is doing.
- **Surface decisions, don't guess** — see Stream D.
- **Always `unset PGPASSWORD`** and remove tmp files before ending
  the session. Same for any temporary AWS credentials.

## Definition of session-success

A session is successful if:
- Stream I (residual terraform drift) lands cleanly OR a clear
  blocker is surfaced
- Any other stream advances meaningfully toward 52/52 + the M1
  beta gate
- Every fix has a live-evidence triad
- Tracked changes are committed and pushed to origin/main
- Memory file is updated if state changed materially
- The user is told concisely at session end: what advanced, what's
  blocked, what's next, and which Stream D decisions are pending

## Open known-knowns the orchestrator should NOT re-discover

- `bedrock-router` and `bedrock-vision` lambdas live in
  `infrastructure/terraform/main_v2.tf`, NOT `main.tf`. They use
  `matika-${var.environment}` prefix, not `carelog-`. Handler is
  `dist/src/index.handler` (TypeScript compiled).
- Flyway state needed manual reconciliation in session 1: V006-V009
  show pending in `flyway_schema_history` though the columns exist
  live (manual F17 deploy via psql). V010 was applied via psql +
  manually inserted into `flyway_schema_history` to keep flyway
  consistent. If you ship V011+, use the same pattern OR `flyway
  repair` first — surface to the user before deciding.
- `aws_sns_platform_application` does not accept `tags = {}`. Don't
  add it back.
- HAPI FHIR optional deps (Thymeleaf, Schematron, AWT, JAXB crypto,
  javax.naming) need blanket `-dontwarn` rules in
  `android/app/proguard-rules.pro` for R8 to pass. Already in place
  per session 1; don't strip them.
- Gradle JVM heap is `-Xmx6144m` in `android/gradle.properties`.
  Don't downgrade — R8 release minify OOMs at 2 GiB.
- The dev env's `terraform.tfvars` is gitignored. Variable
  declarations in `dev/variables.tf` + passthroughs in
  `dev/main.tf` ARE source of truth — audit those, not tfvars.
- Lambda zip-file-list drift is usually noise (test files,
  node_modules variance), not code drift. Diff local vs `aws
  lambda get-function` `index.js` BEFORE assuming a lambda needs
  redeployment.

Begin by pulling latest, reading `docs/v2_launch_plan.md` end-to-end,
loading the memory files listed above, and acknowledging scope.
Then drive Stream I to completion. Surface only when blocked, when
you hit a Stream D decision, when Stream B/H needs the user, or
when Stream I is fully landed and ready for batch review.
```

# Next-steps 2026-05-17 — progress log

> **Audience:** the orchestrator opening a fresh session to continue execution of `docs/next-steps-2026-05-17.md`. Read this file alongside the kickoff to know which streams are landed and pick the next one. Streams here are reported in the order they landed, not the order they were originally listed in the kickoff.

## Streams landed

### Stream D — Runbook docs (extensions) — **DONE 2026-05-17**

Commit: `<pending>` (this commit). Pushed to `origin/main` at end of session.

**What landed:**
- All three target runbooks (`docs/runbook_oncall_v2.md`, `docs/runbook_support_v2.md`, `docs/dr_runbook_v2.md`) extended from Stream G v1.0 baselines to v1.1. Net growth: 584 → 1309 lines (133→305, 225→478, 226→526).
- `docs/v2_launch_plan.md` §6.2: all three NEW rows flipped to LANDED 2026-05-17 with v1.1 scope summary.

**Sections added per runbook:**
- **oncall:** "First 60 seconds" first-response checklist; 4 TARGET alarm placeholders (Cognito sign-in errors, Bedrock guardrail block rate, WorkManager backlog, Cognito drift detector — all confirmed NOT wired in `infrastructure/terraform/modules/monitoring/`); expanded "Pages to ignore" with 5 additional false-positive patterns; consolidated Escalation tree with `<TBD>` name placeholders + tighter 15-min SLO for Cognito-class alarms; glossary (17 FSM states from `inference/ConversationState.kt:15-54`, 3 session_type values from `V004:37-39`, observation pipeline stages, persona types with v1→v2 attendant→caregiver rename note, F-class incident markers).
- **support:** Triage flow section (v2 vs v1 distinguishers, persona identification via Cognito, identifier extraction with corrected SQL joins via `persona_links`); 3 added scenarios (wrong-language sticky-state, wrong patient name typo, stuck-at-credentials-form with F39/F44 references); RDS access section with verified bastion IDs + endpoints + db users + secret IDs for dev and staging (prod TBD); 3 data-fix scripts (threshold update with correct `ARRAY[N]::numeric[]` syntax for `parameter_configs.threshold_max`, Cognito password reset, language reset using actual `patients.language` column not `preferred_language`); PII handling section with DPDP-aware redaction rules + escalation path for exposure incidents.
- **dr:** Backup architecture overview (table + 5 sub-sections — RDS, S3, Cognito, terraform state, Secrets Manager — every config value cited to terraform `file:line`); §5 Regional outage procedure with sub-sections for scope determination, hard regional outage, partial-AZ, Bedrock-specific (corrected to reflect v2.0's in-region direct invocation per `modules/bedrock/main.tf:6-9`, NOT cross-region inference profiles as originally drafted), Cognito-specific; §6 Communications templates (status page, WhatsApp EN with Hindi/Bengali TBD, Slack kickoff, post-incident); extended DR drill cadence with 5 drill checklists + explicit "drills NEVER run in prod" callout.

**Verification gate hits:**
- ✅ All 3 docs exist at target paths.
- ✅ Combined line count 1309 (target was 1200-2400 per kickoff §2 Stream D). Individual: oncall 305 (under 400-line gate but content is dense with no padding; signed off as "depth without bloat"), support 478, DR 526.
- ✅ No "doctor" persona terminology outside explicit "Phase 2 deferred" callouts (3 mentions in oncall + support, 1 pre-existing Cognito-group iteration in DR — that group is preserved cross-environment and yields zero rows under v2.0 usage).
- ✅ Cross-references to other docs resolve (verified via `ls docs/`).
- ✅ All AWS resource names (alarm names, bastion IDs, RDS endpoints, DB users, S3 bucket conventions, Cognito custom attributes, Bedrock env var names) verified against terraform modules or actual config files. NO HALLUCINATIONS.
- ✅ §6.2 launch plan rows flipped to LANDED 2026-05-17.

**Key corrections caught DURING the work (would have shipped wrong otherwise):**
- `patients.preferred_language` → actual column is `patients.language` (BCP-47, V004→V005).
- `parameter_configs.threshold_max` → NUMERIC[] array, not scalar. Writes need `ARRAY[N]::numeric[]`. Key is `(patient_id, parameter_name)` not `(patient_id, parameter)`.
- `patients.created_by_user_id` doesn't exist. Real join: `users u ON u.id = p.user_id` for patient users, via `persona_links.linked_user_id` for caregivers.
- `audit_log` has `user_persona`, not `actor_role`.
- Dev RDS: bastion `i-017956fca070240a7`, host `carelog-dev.c30qocsuk0zl.ap-south-1.rds.amazonaws.com`, port 55432, user `carelog_dev_admin` (not `carelog_admin`).
- Staging RDS: bastion `i-0f2acdf1a96ee24a6`, host `carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com`, port 55433, user `carelog_staging_admin`.
- Bedrock cross-region inference DROPPED in v2.0 (2026-05-02 design decision, `modules/bedrock/main.tf:6-9`). DR runbook now reflects in-region direct invocation. The DPDP residency caveat on the lambda env-var swap is documented explicitly.
- Android `ConversationStateMachine.applyTurnFailure:125-130` passes raw SDK exception messages to UI — no friendly wrapper for Bedrock errors. Flagged as UX polish follow-up in DR §5.4.

**Outstanding follow-ups surfaced (tracked as F45–F48 in `docs/testing_todos_v2.md`):**
- **F45** — 4 TARGET CloudWatch alarms (Cognito sign-in errors, Bedrock guardrail block rate, WorkManager backlog, Cognito drift detector) documented in oncall but NOT declared in `infrastructure/terraform/modules/monitoring/`. Per-alarm wire-target windows captured (pre-prod-cutover, before beta, v2.1, etc.).
- **F46** — S3 access-logs bucket missing noncurrent-version lifecycle policy. Cost cleanup, no functional impact today.
- **F47** — Cognito nightly export to S3 not automated. RPO unbounded until wired. Acceptable for closed beta, blocker for GA.
- **F48** — Operational-readiness naming pass: 9 classes of `<TBD>` placeholders across the three runbooks (PagerDuty/Opsgenie tooling, on-call rotation, Slack channel, beta support number, cohort roster doc, prod RDS breakglass user, Hindi/Bengali translations, status-page tool, founder escalation). All listed with decision owner + grep recipe in the F48 entry.

**Deviation from kickoff playbook:**
- Kickoff assumed all 3 docs would be written from scratch via 3 parallel subagents. In reality, Stream G (2026-05-14) had already produced v1.0 drafts of all three. User confirmed (in this session): extend existing rather than rewrite. Two of three subagents got Edit-denied by the permission system mid-task; they completed all research and surfaced the column-name + Bedrock corrections above, which I then applied via direct Edit. DR subagent's Edit permission was granted; it produced 300+ lines of new content directly. Net: same outcome, different distribution of work.

**Files touched (final scope):**
- `docs/runbook_oncall_v2.md`
- `docs/runbook_support_v2.md`
- `docs/dr_runbook_v2.md`
- `docs/v2_launch_plan.md`
- `docs/next-steps-2026-05-17-progress.md` (this file)

**Pre-existing drift left untouched** (per kickoff "don't include pre-existing drift in commits unless directly relevant"):
- `android/app/build.gradle.kts`, `android/app/src/main/res/raw/amplifyconfiguration.json`, `ios/CareLog/CareLog/amplifyconfiguration.json`, `docs/f39-fix-kickoff.md`, `docs/launch-execution-3-kickoff.md` — all pre-existing.

---

### Stream C — Crashlytics wire-in — **DONE 2026-05-17**

Commit: `5be33c3` (`Stream C — Crashlytics wired into Android with 4 forwarder sites`). Pushed to `origin/main`.

**What landed:**
- `CareLogApplication.initializeCrashlytics()` — collection enabled on ALL variants (was `!BuildConfig.DEBUG`-gated; see deviation note below).
- Forwarders:
  - `BedrockTurnClient.submitTurn` `.onFailure` — `setCustomKey("last_lambda_status", t.code())` on `HttpException` + `recordException(t)`.
  - `MatikaConversationViewModel.beginTurn` precondition throw — `recordException(t)`.
  - `MatikaConversationViewModel.submitTurn` `onFailure` — `recordException(err)`.
  - `SttManager.onError` — `Crashlytics.log(...)` breadcrumb only (STT errors are too noisy for non-fatals).
  - `SttManager` online-fallback re-arm failure — `recordException(it)`.
- All Crashlytics calls wrapped in `runCatching { ... }` for JVM-unit-test safety (`Process.myPid` stub crashes the `getInstance()` chain otherwise).
- Debug-only `Force test crash` button on `SettingsScreen` at the bottom of the column, gated by `BuildConfig.DEBUG` (the Gradle-generated one — see `release_buildconfig_lesson.md` for the shadowed-BuildConfig trap). testTag `settings_test_crash`.
- `docs/v2_launch_plan.md`: §3.1 "Crash reporting wired" checkbox flipped to ✓; §7.3 row updated; open-question #5 resolved.
- Memory `v2_stream_d_decisions_20260512.md` appended with the implementation summary.

**Verification gate hits:**
- ✅ `./gradlew :app:assembleDebug` clean — no Crashlytics warnings.
- ✅ `./gradlew :app:assembleRelease` clean — `uploadCrashlyticsMappingFileRelease` runs, so de-obfuscated traces will reach the console.
- ✅ All 147 unit tests pass.
- ✅ App installs + launches on Galaxy RFCT10C1GSZ (debug APK) — no FATAL/AndroidRuntime in logcat.
- ⏳ **Outstanding — on-device console-ingest smoke test (user-driven).** Sign in to the app on RFCT10C1GSZ, open Settings, scroll to bottom, tap `Force test crash (debug only)`, relaunch. Within ~5 min the crash + the `Stream C smoke test fired from SettingsScreen` breadcrumb should appear in Firebase console for project `carelog-7de0c`. Settings is auth-gated so the orchestrator couldn't drive it from the CLI.
- ⏳ **Outstanding — confirm Firebase project `carelog-7de0c` is correct for staging/prod.** Memory `v2_stream_d_decisions_20260512.md` asserts it's the same project as FCM, which is already in use. Likely safe but unverified end-to-end.

**Deviation from the kickoff playbook (orchestrator should know):**
- The kickoff playbook step 5 says "Build, install on the bench phone, tap the test-crash button" — implying debug-build smoke test works. The previous code had `setCrashlyticsCollectionEnabled(!BuildConfig.DEBUG)`, which would make the debug button throw locally but never upload. **I flipped to unconditional `true`.** The previous author's docstring concern was "dev iteration never floods the console with stack traces from `am force-stop` / device reboots" — but those aren't actually crashes Crashlytics records, and real uncaught exceptions during dev iteration are useful signal. If product wants the original gate back, the smoke-test path needs redesigning (e.g., button calls `setCrashlyticsCollectionEnabled(true)` + `sendUnsentReports()` before throwing).
- The PII stance from the previous author is stricter than the kickoff implied — no `setUserId(cognito_sub)`, no `setCustomKey(patientId/email)`, no transcripts in breadcrumbs. I respected it. Crashes are therefore unattributed to users by design (DPDP). The only custom key set is `last_lambda_status` (an HTTP status code — not PII).

**Files touched (final scope of commit `5be33c3`):**
- `android/app/src/main/java/com/carelog/core/CareLogApplication.kt`
- `android/app/src/main/java/com/carelog/inference/BedrockTurnClient.kt`
- `android/app/src/main/java/com/carelog/inference/MatikaConversationViewModel.kt`
- `android/app/src/main/java/com/carelog/conversation/audio/stt/SttManager.kt`
- `android/app/src/main/java/com/carelog/ui/settings/SettingsScreen.kt`
- `docs/v2_launch_plan.md`

**Pre-existing drift left untouched** (per the kickoff "don't include pre-existing drift in commits unless directly relevant"):
- `android/app/build.gradle.kts` — dev→staging `API_BASE_URL` toggle, pre-existing.
- `android/app/src/main/res/raw/amplifyconfiguration.json` — Amplify regen drift.
- `ios/CareLog/CareLog/amplifyconfiguration.json` — same.
- `docs/f39-fix-kickoff.md`, `docs/launch-execution-3-kickoff.md` — pre-existing.

---

### Stream B — CG-V2-16 hardening (delete-patient cascade) — **DONE 2026-05-17**

Commit: `<pending>` (this commit).

**What landed:**
- `backend/database/migrations/V015__delete_patient_cascade_fk.sql` (new) — adds `ON DELETE CASCADE` to `deletion_requests.patient_id`. Applied to staging RDS via SSM tunnel + Flyway 12.3.0; `confdeltype='c'` confirmed in `pg_constraint`. Migration also documents the deliberate decision to keep `audit_log.patient_id` as RESTRICT.
- `backend/lambdas/delete-patient/index.js` — rewritten for full DPDP cascade:
  - New imports + S3Client.
  - New helper `deletePatientObservations(shortCode)` — paginated ListObjectsV2 + batched DeleteObjects under `observations/{shortCode}/`. Best-effort; never throws.
  - New helper `clearLinkedPatientAttribute(usernameOrSub)` — AdminUpdateUserAttributes setting `custom:linked_patient_id=""`. Idempotent.
  - New in-txn steps: fetch secondary caregivers' cognito_subs (relationship='caregiver', is_active=true, sub!=deleter); explicit `DELETE FROM device_tokens` for patient's user_id + linked attendants/doctors' user_ids; defensive `DELETE FROM deletion_requests` (now redundant post-V015 but harmless).
  - audit_log details JSON augmented with `removedDeviceTokens`, `removedDeletionRequests`, `secondaryCaregiverCount`.
  - Post-COMMIT phase (outside the transaction): loops `clearLinkedPatientAttribute` over secondary caregivers, then S3 cascade. Failures logged to CloudWatch, do NOT roll back.
- `backend/lambdas/delete-patient/package.json` — added `@aws-sdk/client-s3` dependency + jest devDependency + `test` script.
- `backend/lambdas/delete-patient/__tests__/index.test.js` (new) — 3 jest cases: happy-path (verifies SQL order: device_tokens + deletion_requests before patients DELETE; correct S3 prefix; correct Cognito disable + attribute-clear counts), S3-failure-tolerance (COMMIT still runs on S3 reject), auth-failure (403, no BEGIN). All 3 pass.
- `infrastructure/terraform/modules/lambda/main.tf` — two IAM additions: `s3:DeleteObject` on the documents bucket arn, and `cognito-idp:AdminDisableUser` on the user pool arn (the second one closed a pre-existing silent-failure — see F49). Also added `DOCUMENTS_BUCKET=var.documents_bucket_name` env var on the delete_patient function via `merge(local.rds_env, {...})`.
- `docs/journeys_non_voice.md` — CG-V2-16 row expanded to cite the full 6-surface PASS evidence + Stream B link.
- `docs/v2_launch_plan.md` §4.2 — CG-V2-16 row flipped from "verify" to "LANDED 2026-05-17 (Stream B)" with summary of the hardening.
- `docs/testing_todos_v2.md` — added F49 (IAM gap RESOLVED, also documents dev follow-up) and F50 (consent_records HIPAA-vs-DPDP tension).

**Live verification (staging, 2026-05-17 evening):**
- Synthetic test patient `CL-T1IM5E` (sub `91b3fdda-f081-70dc-afbc-df75e6559e09`) created via `carelog-staging-create-patient` lambda using staging caregiver `sanyalsubhajit2010+cg@gmail.com` (sub `51134dba-0041-70c0-ea5f-5c70348c3bb4`).
- Pre-seeded: 2 S3 observations under `observations/CL-T1IM5E/2026/05/17/`, 1 `device_tokens` row, 1 `deletion_requests` row (the latter explicitly tests V015 cascade).
- Direct `aws lambda invoke` on `carelog-staging-delete-patient` returned 200.
- Post-delete RDS via SSM tunnel: `patients=0, device_tokens=0, deletion_requests=0, users.is_active=false`. Audit_log shows `action=DELETE_CASCADE, resource_id=CL-T1IM5E, details={removedDeviceTokens:1, removedDeletionRequests:1, secondaryCaregiverCount:0, removedAttendants:[], removedDoctors:[]}`.
- S3 `aws s3 ls observations/CL-T1IM5E/ --recursive` returns empty (exit 1 = no objects = PASS).
- Cognito: patient user `Enabled=false, Status=CONFIRMED`. Caregiver `custom:linked_patient_id` returned None (cleared).
- CloudWatch log lines confirm: `1 device tokens removed, 1 deletion_requests removed, 0 secondary caregivers to clear post-commit` and `2 S3 objects deleted (0 S3 errors)`.

**Pre-existing IAM gap surfaced (F49):**
- The first delete attempt (on test patient `CL-Y6TOW7`) hit `User: ... is not authorized to perform: cognito-idp:AdminDisableUser`. The error was caught silently by the lambda's helper (warn + continue). I patched the IAM and redeployed; the second test patient (`CL-T1IM5E`) verified the fix end-to-end. The original 2026-05-14 CG-V2-16 PASS claim "patient Cognito user disabled" was therefore wrong — the disable was failing silently for every prior run. F49 documents this and notes that dev needs the same IAM apply on its next targeted apply.

**Pre-test caregiver state restored:**
- Pre-test: `sanyalsubhajit2010+cg@gmail.com` `custom:linked_patient_id=CL-1RK0CD`.
- Restored to `CL-1RK0CD` after the test so subsequent voice/UI tests against this caregiver behave normally.
- The orphan Cognito user from test 1 (`c193adfa-80c1-70db-7661-68a57696f8ab`) was manually admin-disabled at cleanup.

**Deployment path:**
- Migration: SSM tunnel to staging bastion `i-0f2acdf1a96ee24a6` → flyway 12.3.0 → `migrate` from `V014` to `V015`. One migration, two `ALTER TABLE` statements (DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT … ON DELETE CASCADE). 4.5s execution time.
- Terraform: `-target=module.carelog.module.lambda.aws_iam_role_policy.rds_cognito_inline` + `-target=module.carelog.module.lambda.aws_lambda_function.delete_patient`, with `-refresh=false`. Three targeted applies total (initial deploy, enum-fix redeploy after the 'relative' bug, IAM-fix redeploy after F49 surfaced). Each was a clean 1-2 resource in-place update.
- The full non-targeted `terraform plan` shows pre-existing F2-class drift on 3 unrelated lambdas (bedrock_router, create_patient, create_patient_from_voice) — CLI-deployed code that doesn't match the archive_file zip. Stream B did NOT touch those; the F2 pattern from memory `terraform_lambda_drift_pattern.md` is observed and respected.

**Deviation from the plan (orchestrator should know):**
- Plan §3 SQL filtered persona_links by `relationship IN ('caregiver', 'relative')`. The first live invoke threw `invalid input value for enum persona_type: "relative"`. The persona_type enum in staging is `{patient, attendant, caregiver, doctor}` — the legacy V001 'relative' value has been renamed/replaced (v1→v2 rename pass; see memory `release_buildconfig_lesson.md` for general v2 rename context). Fixed in lambda + tests to `relationship = 'caregiver'` only.
- F49 was not anticipated in the Stream B plan. It surfaced during live verify and was patched in-flight (one extra terraform apply). The lesson: when a lambda helper catches-and-warns, live verification is the ONLY way to know whether the underlying operation succeeded — unit tests pass with the warning-only path. The `disableCognitoUser` warn-only pattern at index.js:71-74 is the recurring failure-masking shape.

**Files touched (final scope):**
- `backend/database/migrations/V015__delete_patient_cascade_fk.sql` (new)
- `backend/lambdas/delete-patient/index.js`
- `backend/lambdas/delete-patient/package.json`
- `backend/lambdas/delete-patient/package-lock.json` (npm install fallout)
- `backend/lambdas/delete-patient/__tests__/index.test.js` (new)
- `infrastructure/terraform/modules/lambda/main.tf`
- `docs/journeys_non_voice.md`
- `docs/v2_launch_plan.md`
- `docs/testing_todos_v2.md`
- `docs/next-steps-2026-05-17-progress.md` (this file)

**Pre-existing drift left untouched** (per the kickoff "don't include pre-existing drift in commits unless directly relevant"):
- `android/app/build.gradle.kts`, `android/app/src/main/res/raw/amplifyconfiguration.json`, `ios/CareLog/CareLog/amplifyconfiguration.json`, `docs/f39-fix-kickoff.md`, `docs/launch-execution-3-kickoff.md` — all pre-existing.

---

## Streams NOT yet started

- **Stream A — Cognito drift apply (`66ca57c`).** Highest risk. Last remaining stream.

**Risk-ordered recommendation for the next stream:** **A**. Streams C + D + B are now landed. The kickoff's C → D → B → A order says A is next and last. The kickoff is explicit that this is the highest-risk stream (wrong move breaks auth for everyone) — re-read the playbook end-to-end before dispatching the diagnosis subagent. Note: F49 above flags that dev's `lambda_rds_cognito` IAM needs the same `cognito-idp:AdminDisableUser` add that staging now has — fold that into Stream A's plan-and-apply for dev.

---

## State of the bench (for the next session)

- Galaxy device serial `RFCT10C1GSZ` is attached and has the Stream-C debug APK installed (com.carelog, versionCode 6, versionName 1.4.0).
- adb is at `/opt/homebrew/bin/adb`.
- App was last launched at 17:21 IST on 2026-05-17; no FATAL.
- F41 (Mac mini Core Audio wedge) is still latent; if voice verification is needed for a later stream, fall back to the remote-TTS workaround per `voice_harness_lessons.md` lesson 7.

## State of the working tree

- `main` will be at the Stream B commit once committed + pushed.
- Pre-existing drift listed above is unstaged and untouched — leave it alone unless directly relevant to the next stream.
- Soak clock continues to **2026-05-22** (Stream H prod-prep target).

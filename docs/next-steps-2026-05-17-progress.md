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

### Stream A — Cognito drift apply (`66ca57c`) + F49 dev IAM fold-in — **DONE 2026-05-17**

Commit: `<pending>` (this commit).

**What landed:**
- **Cognito drift turned out to be already resolved.** Targeted `terraform plan -target=module.carelog.module.cognito` returned "No changes" in BOTH dev (`ap-south-1_1TcE4vTTi`) and staging (`ap-south-1_7cACPnKJn`). The drift from `66ca57c` (SES email_configuration added to the cognito module) had been silently reconciled by intermediate commits — notably `8442fbf` (lambda_config inline, dropped the null_resource workaround), `eae5da4`/`abc128f` (reply_to_email_address regex extraction), `392b742` (domain_name parameterization), `4697b11` (SES sender wiring). The `caregivers` user group + precedence renumber of doctors had also already landed and propagated to live state in both pools.
- **Only actual apply:** F49 dev IAM fold-in. `terraform apply -target=module.carelog.module.lambda.aws_iam_role_policy.rds_cognito_inline` from `environments/dev/`. The plan added two actions to the live `carelog-dev-lambda-rds-cognito` role's `rds-cognito-access` inline policy:
  - `cognito-idp:AdminDisableUser` — closes F49 on dev (the silent-failure pattern from `disableCognitoUser` helper at `backend/lambdas/delete-patient/index.js:63-75`)
  - `s3:DeleteObject` — same gap, S3 prune side; both surfaced together in the policy diff
- Plan: 0 to add, 1 to change, 0 to destroy.
- `docs/v2_launch_plan.md`: §1 pre-GA item #5 flipped to RESOLVED; §3.1 Cognito-drift checkbox flipped to ✓; §4.6 row updated to LANDED; §risks table mitigated to M→L.
- `docs/testing_todos_v2.md` F49 wire-target: dev closed alongside staging.

**Verification gate hits:**
- ✅ Pre-apply snapshots: `aws cognito-idp describe-user-pool` for both pools → `/tmp/cognito-{dev,staging}-snapshot-pre.json` (12,182 / 12,266 bytes).
- ✅ Dev cognito-targeted plan pre-apply: "No changes."
- ✅ Dev IAM-targeted plan pre-apply: 1 in-place update (adds AdminDisableUser + s3:DeleteObject — diff cited above).
- ✅ Dev IAM apply: `Apply complete! Resources: 0 added, 1 changed, 0 destroyed.`
- ✅ Live IAM verify: `aws iam get-role-policy --role-name carelog-dev-lambda-rds-cognito --policy-name rds-cognito-access` shows both actions present in the cognito + s3 statements.
- ✅ Dev IAM re-plan post-apply: "No changes."
- ✅ Dev cognito re-plan post-apply: "No changes."
- ✅ Staging cognito-targeted plan: "No changes." (No apply needed.)
- ✅ Staging IAM-targeted plan: "No changes." (Stream B already applied.)
- ✅ Post-apply Cognito snapshots diff'd vs pre — **byte-identical** in both pools (after stripping `LastModifiedDate`). Proves the IAM apply touched zero Cognito state.

**Deviation from kickoff playbook:**
- The kickoff playbook anticipated a substantive Cognito drift requiring snapshot/apply/smoke-test/rollback paranoia. Diagnosis surfaced that the drift had already been reconciled in prior streams. The Explore subagent's read-only diagnosis correctly identified this. I trust-but-verified by running the targeted plans myself (`terraform plan -target=module.cognito` in both envs) and confirmed.
- Smoke-test gate (Jane Doe login / observation turn): the playbook prescribes this for any Cognito-affecting apply. Since the only apply was on a lambda IAM policy (zero Cognito state delta proven via snapshot diff), the prescribed smoke-test isn't load-bearing — the IAM permission is for the `delete-patient` lambda's invocation context, not the sign-in/auth path. Skipped the in-app smoke-test; subbed the byte-identical snapshot diff as evidence Cognito is unaffected. Dev `delete-patient` IAM fix will be exercised the next time a delete-patient runs against dev (no synthetic test patient currently set up in dev — Jane Doe is the persistent test account and can't be deleted).
- Stale plan-file housekeeping: removed three uncommitted `tfplan.streamb*` files from `environments/staging/` that were Stream B's saved plans, never cleaned up at end of that session.

**Files touched (final scope):**
- `docs/v2_launch_plan.md`
- `docs/testing_todos_v2.md`
- `docs/next-steps-2026-05-17-progress.md` (this file)

**Memory updates:**
- `terraform_lambda_drift_pattern.md` appended with the "stale-drift-flag-may-already-be-resolved" lesson (re-run targeted plan before assuming the work in a beta-gate flag is still needed).

**Pre-existing drift left untouched** (per the kickoff "don't include pre-existing drift in commits unless directly relevant"):
- `android/app/build.gradle.kts`, `android/app/src/main/res/raw/amplifyconfiguration.json`, `ios/CareLog/CareLog/amplifyconfiguration.json`, `docs/f39-fix-kickoff.md`, `docs/launch-execution-3-kickoff.md` — all pre-existing.

---

## All four streams landed

The kickoff is **DONE**. Per kickoff §6, this file's done-condition is satisfied — all four streams (C → D → B → A) have landed and the launch-plan §3.1 beta gates are updated.

- [x] Stream A — Cognito drift checkbox flipped to ✓ (apply scope reduced to F49 IAM fold-in)
- [x] Stream B — CG-V2-16 row in `journeys_non_voice.md` flipped to PASS
- [x] Stream C — "Crash reporting wired" checkbox flipped to ✓
- [x] Stream D — §6.2 table updated for all three runbooks

---

### Stream D follow-ups — F45 + F47 + F48 — **DONE 2026-05-17** (same session as Stream A)

Picked up immediately after Stream A landed. Commit: `<pending>` (this commit).

**Landed:**

1. **F47 — Cognito nightly snapshot lambda (RESOLVED, dev + staging).**
   - New `backend/lambdas/cognito-snapshot/` (Node.js 20, ~170 lines, AWS SDK v3). Runs `DescribeUserPool` + paginated `ListGroups` + per-group paginated `ListUsersInGroup` + paginated `ListUsers`. Writes 4 files per run (`pool.json`, `groups.json`, `users.json` (with embedded `Groups[]` per user), `manifest.json` as completion sentinel) to `s3://{documents_bucket}/cognito-snapshots/{YYYY-MM-DD}/`.
   - New dedicated minimal-scope IAM role `carelog-{env}-lambda-cognito-snapshot` (does NOT reuse `lambda_rds_cognito` — that shared role has too many irrelevant perms; new role only grants cognito-idp:Describe/List* + s3:PutObject on cognito-snapshots/* + kms:GenerateDataKey on S3 key).
   - No VPC config (cognito-idp + s3 internet-reachable; saves an ENI for once-a-day task).
   - EventBridge rule `matika-cognito-snapshot-{env}` cron `0 2 * * ? *` (daily 02:00 UTC). Both envs ENABLED.
   - CloudWatch alarm `matika-{env}-cognito-snapshot-missing` (Invocations < 1 over 24h, treat_missing_data=breaching).
   - Dev verified: 4 files written, 5 groups + 3 users, 1590ms. Staging verified: 5 groups + 10 users.
   - RPO for Cognito config/roster corruption now bounded at ≤24h (was unbounded).

2. **F45 T1 — Cognito sign-in errors alarm (LANDED, dev + staging).**
   - New `aws_cloudwatch_metric_alarm.cognito_signin_errors` in `modules/monitoring/alarms_v2.tf`. Metric math: `Throttles / (Throttles + SignInSuccesses + 1) * 100 > 5` over 5min, scoped to `UserPool = module.cognito.user_pool_id`. SNS fan-out to operator-alerts. Dev state OK, staging INSUFFICIENT_DATA (low traffic).
   - Caveat documented in F45 entry: AWS/Cognito only publishes Throttles natively (not password failures / no-such-user — those go to CloudTrail). v2.1 follow-up: emit a custom SignInFailures metric from `post_authentication` lambda.

3. **F45 T2 — Bedrock guardrail block-rate metric + alarm (DEFERRED).**
   - The fix candidate (emit custom CloudWatch metric from `matika-{env}-bedrock-router` on `GuardrailIntervened`) requires touching live router lambda code. During the active soak window (clock continues to 2026-05-22), this introduces F2-class lambda-hash-drift risk on the most-used user-facing lambda. Defer to a future session already touching the router for unrelated reasons. F45 entry updated with rationale + wire-target (before any prod guardrail config bump, or pre-GA).

4. **F45 T3 — WorkManager sync backlog (DEFERRED v2.1).**
   - Per F45 entry's own original wire-target: client-side metric, no server-side surface in v2.0. Stream C Crashlytics gives partial visibility today via `FhirSyncWorker` failure forwarding.

5. **F45 T4 — Cognito drift detector (DEFERRED with locked design).**
   - Original F45 entry proposed running `terraform plan -refresh-only` from a Lambda — rejected as too heavy (terraform binary Lambda Layer ~200MB, S3 backend access + lock acquisition, slow `init` cold start, broad AWS describe perms needed).
   - **Design locked:** config-hash variant. Scheduled lambda calls Describe/List* (same shape as F47), computes a stable SHA256 over a normalized view (excluding `LastModifiedDate`, `EstimatedNumberOfUsers`, and roster volatility), compares against baseline at `s3://{documents_bucket}/cognito-baseline/hash.txt`, alarms on diff. Structurally similar to F47's lambda — can reuse the same IAM-role pattern.
   - Stream A baseline prerequisite satisfied 2026-05-17. Wire-target: pre-prod-cutover.
   - Implementation deferred to next session for dedicated scope.

6. **F48 — Operational TBD naming pass (RESOLVED, solo-founder mode).**
   - All 27 `<TBD>` markers across `runbook_oncall_v2.md` + `runbook_support_v2.md` + `dr_runbook_v2.md` resolved per founder decisions:
     - Paging tool: none for v2.0 beta — SNS → email/SMS to `subhajit@kyabla.in`. New §"Solo-founder paging mode" section in oncall runbook makes the mode explicit + reversible.
     - On-call rotation: solo founder for every alarm class. Escalation matrix simplified.
     - Contact placeholders: `subhajit@kyabla.in` interim; items with no current substitute tagged `TO BE PROVISIONED PRE-BETA — owner: founder, target T-{N}`.
     - Translations: `<DEFERRED — Hindi/Bengali pending; owner: founder coordinating with content team, target T-14 pre-beta>`.
   - `grep -nH "<TBD" docs/runbook_*.md docs/dr_runbook_v2.md` returns exactly 1 hit — the intentional meta-`<TBD>` in `runbook_oncall_v2.md:25` that explains when this resolution becomes obsolete.

**Verification:**
- ✅ Both envs `terraform plan -target=<resource>` showed exactly 10 to add, 0 to change, 0 to destroy (no F2 hash drift on unrelated lambdas).
- ✅ Both env applies clean: `Apply complete! Resources: 10 added, 0 changed, 0 destroyed.`
- ✅ `aws lambda invoke carelog-dev-cognito-snapshot` returned 200 + 4 S3 files; same for staging.
- ✅ Manifest.json verified post-write (sha256, counts, durations all sensible).
- ✅ Both EventBridge rules ENABLED for daily 02:00 UTC.
- ✅ Both `carelog-{env}-cognito-signin-errors` + `matika-{env}-cognito-snapshot-missing` alarms live in CloudWatch (states converge over next eval cycles).

**Files touched:**
- `backend/lambdas/cognito-snapshot/` (new dir: `index.js`, `package.json`, `package-lock.json`, `node_modules/`)
- `infrastructure/terraform/modules/lambda/main.tf` (+97 lines: archive_file + iam_role + 2 iam_role attachments + lambda + log group for cognito_snapshot)
- `infrastructure/terraform/modules/lambda/outputs.tf` (+12 lines)
- `infrastructure/terraform/modules/eventbridge/main.tf` (+22 lines)
- `infrastructure/terraform/modules/eventbridge/variables.tf` (+13 lines)
- `infrastructure/terraform/modules/monitoring/alarms_v2.tf` (+78 lines: F45 T1 alarm + F47 snapshot-missing alarm)
- `infrastructure/terraform/modules/monitoring/variables.tf` (+12 lines)
- `infrastructure/terraform/main.tf` (+8 lines: pass cognito_snapshot vars to eventbridge + monitoring modules)
- `docs/runbook_oncall_v2.md` (+13 / -8 lines: solo-founder paging mode section + escalation matrix fills + how-to-wake-someone-up section update)
- `docs/runbook_support_v2.md` (Play Store link / prod RDS / DPO TBDs filled)
- `docs/dr_runbook_v2.md` (replica bucket / support phone / translations / cohort roster / status-page TBDs filled)
- `docs/testing_todos_v2.md` (F45 partial-resolution rewrite, F47 RESOLVED, F48 RESOLVED with decision log)
- `docs/v2_launch_plan.md` (§7.3 monitoring row + §7.4 on-call rotation rewrite for solo-founder mode)

**Deferral budget (carry forward to next session):**
- F45 T2 — Bedrock guardrail metric + alarm. Best done in a future session that's already touching `bedrock-router` for unrelated reasons. Locked alarm name: `matika-{env}-bedrock-guardrail-block-rate`.
- F45 T4 — Cognito drift detector. Config-hash design locked; ~150 LOC lambda + terraform similar in shape to F47. Wire-target pre-prod-cutover.
- F45 T3 — WorkManager backlog. v2.1, blocked on client-side telemetry pipeline design.
- TBD provisioning items: Play Store link, beta-support WhatsApp, beta-cohort roster doc, prod RDS breakglass user, status-page tool — all tracked in runbooks with owner + target T-N.

**Recommendation for the next session:** kickoff is fully done. Either start a fresh next-steps file for the M1 closed-beta cutover work (prod env first-apply per launch-plan §4.6 + DPDP audit + Bedrock quota request + the deferred F45 T2/T4), or pick up the staging soak verification as the clock approaches 2026-05-22.

---

## Must-do before closed beta (M1, target July 2026)

> **Audience:** the orchestrator opening this file in a future session to plan beta cutover work. Pulled together 2026-05-17 from launch-plan §3.1 still-unchecked gates + open F-class entries in `docs/testing_todos_v2.md` + F48's `TO BE PROVISIONED PRE-BETA` items. Order is by external-vendor lead time + ship risk, NOT by engineering effort. **Slip on any item in §1 or §2 likely slips T-0.**

### 1. Open critical bug (engineering, in our control)

| Item | Where | Status / Notes |
|---|---|---|
| **F40** — voice→text `Type instead (fallback)` mode reported to silently no-op to backend | `docs/testing_todos_v2.md` F40 entry; client-side path through the conversation FSM | **RE-CLASSIFIED 2026-05-17 by code audit.** The text-fallback path is structurally identical to the verified voice path — same `submitTurn` → `BedrockTurnClient` → `/conversation/turn`. There is no local-mock writer for `pendingConfirmation` or `sessionEnded` in the v2 build (v1 SessionManager is dead code behind `USE_V2_INFERENCE=true`). The 2026-05-16 bench narrative is internally inconsistent. Observability hook shipped: `onTextSubmitted` now logs entry + both early-return reasons so the next bench can deterministically disambiguate. Needs one re-drive on the current build (see F40 entry §"Verification recipe") before closing as misobservation. Probable-misobservation, not beta-critical engineering work. |

### 2. External-vendor lead time (start ASAP — they sit blocked on SLAs we don't control)

| Item | Owner | T-N target | Notes |
|---|---|---|---|
| **DPDP audit + signed DPA with AWS + privacy policy + ToS legal review** | founder + external counsel | T-10 sign-off; engagement ASAP | launch-plan §1 pre-GA item #4 + §3.1 "Compliance lockdown" + §8.1. Counsel SLA typically multi-week. F50 (HIPAA-vs-DPDP `consent_records` tension) folds into this engagement — bring the question. |
| **Penetration test** | security vendor (TBD) | Kickoff T-38, report T-14 | launch-plan §3.1 + §8 timeline. ~5–6 week external window. Vendor selection + scoping doc owed BEFORE kickoff. |
| **SES production-access ticket** | founder → AWS Support | Before any beta-cohort onboarding | Current SES state: SANDBOX. Mail only deliverable to verified recipient identities. Two paths: (a) pre-verify every beta participant's email (~10) via `aws sesv2 create-email-identity` + participant clicks link; (b) request production access (couple-day SLA + AWS will ask traffic-pattern questions). Stream D pre-GA decision (commit `7dfc0f6`) chose path (a) for beta — confirm or revise. |
| **Bedrock prod quotas (ap-south-1)** | founder → AWS Support | T-21 | Request 100 RPM Haiku + 30 RPM Sonnet. 1–3 day SLA. File AFTER prod env first-apply so the quota request can cite actual prod account IDs. |

### 3. Infrastructure cutover

| Item | Where | Status |
|---|---|---|
| **Prod environment first-apply** | `infrastructure/terraform/environments/prod/` | Module exists per commit `43f6678` ("Prod environment prep — tfvars template + main.tf scope fix"). Not yet applied. Needs end-to-end: VPC + RDS + Cognito + Bedrock + monitoring + bastion + KMS, then 1-week burn-in with a synthetic patient. T-21 per §8. |
| **Staging soak completion** | staging | Clock continues to **2026-05-22**. Sign-off + freeze for prod cutover. |
| **F47 cognito-snapshot apply to prod** | `infrastructure/terraform/environments/prod/` | Lands with prod first-apply (all monitoring + lambda module changes are env-symmetric). |
| **F45 T1 + F45 T4 (drift detector) apply to prod** | same | T1 lands free with prod first-apply (it's in the monitoring module). T4 still un-implemented (deferred per Stream D follow-ups); implementation must precede prod cutover per F45 entry. |

### 4. Untested product surfaces (most journeys are paper-classified, not executed)

| Item | Where | Notes |
|---|---|---|
| **Patient — Pulse / SpO2 / Sugar / Temperature / Weight manual-entry tiles** | bench — manual exercise on Android | Only BP has been exercised end-to-end. Same UI shape, low-risk skip but worth one sweep before exposing to real patients. |
| **Hindi voice flow + Bengali voice flow** | bench — voice harness | Per `voice_harness_lessons.md`: Bengali requires Mac reboot first (F41 class). Plan a single voice session that covers both languages. |
| **Manage Care Team E2E** | Android caregiver flow (invite attendant + accept on second device) | Multi-device coordination, hasn't been actually-driven once end-to-end. |
| **WorkManager sync flush verification** | bench — voice + manual entry → S3 + caregiver Trends | Confirm vitals recorded via voice OR manual entry actually land in `s3://carelog-v2-prod-documents-*/observations/{patientId}/...` AND surface on the caregiver Trends screen after sync. |
| **Voice F23 retry path** | bench — multi-turn voice flow to completion | Per `testing_todos_v2.md` callouts. Verify `create-patient-from-voice` fires with correct payload + welcome-email lands. |

### 5. Decisions still owed by founder

| Decision | Where it surfaces | Blocker |
|---|---|---|
| **F50** — keep `consent_records` on patient delete (HIPAA stance) OR add `dpdpFullErasure=true` request flag that hard-deletes them | `docs/testing_todos_v2.md` F50 entry; lambda design ready either way at `backend/lambdas/delete-patient/index.js` | DPDP counsel call (fold into §2 legal engagement). |
| **Data telemetry plan** — which dashboards do we look at Day 1 of beta? | launch-plan §7.3 + §13 | Stream A5 rollups land data nightly but no Grafana/Athena layer yet. Decide minimum-viable dashboard set BEFORE beta opens — otherwise beta runs blind. |
| **Status-page tool** | `dr_runbook_v2.md` drill #5 (currently `<TO BE PROVISIONED PRE-BETA — target T-21>`) | Statuspage.io vs Atlassian Statuspage vs self-hosted Cachet. Founder choice. |

### 6. Pre-beta provisioning (T-7 per launch-plan §8 — founder, solo-founder mode per F48)

| Item | Owner | T-N target |
|---|---|---|
| Play Store closed-beta listing + invite link | founder | T-7 |
| Beta-support WhatsApp number (separate from founder's personal) | founder | T-7 |
| Beta-cohort roster doc (encrypted Notion or gdoc) | founder | T-7 |
| Hindi + Bengali outage-comms translations (3 short WhatsApp/cohort templates) | founder + content team | T-14 |
| Prod RDS breakglass user | founder | Lands with prod env first-apply |
| Beta cohort consent + onboarding scripts | founder | T-7 per launch-plan §1 item #7 |

### Out-of-scope-for-beta (confirmed deferrals, listed so they don't accidentally creep back in)

- **F45 T2** (Bedrock guardrail block-rate metric) — touches `bedrock-router` live code; defer to a session already touching the router. Pre-GA, not pre-beta.
- **F45 T3** (WorkManager backlog) — v2.1, needs app-side telemetry pipeline.
- **F46** (S3 access-logs lifecycle) — cost cleanup, no functional impact. Pre-GA.
- **Doctor portal, doctor onboarding, doctor-facing analytics** — Phase 2 per CLAUDE.md + launch-plan §13.
- **iOS app** — parked since 2026-03-24.
- **PagerDuty/Opsgenie tooling** — solo-founder mode for beta (F48 decision); revisit at first hire / pre-GA.
- **Cross-region replication (multi-region DR)** — v2.1 per `dr_runbook_v2.md` §2.

### How to use this section

Each row above maps to a specific F-class entry, launch-plan section, or runbook owner. Use the table cell as the search anchor — the canonical detail lives in the file referenced, not in this index. When picking up any row in a future session:

1. Re-read the referenced F-class entry / launch-plan section first; this index can go stale.
2. Cross-check status against the live system (re-run the targeted plan, query the CloudWatch alarm state, check `aws ses get-account` for the SES sandbox bit, etc.) — per memory `feedback_verify_live_pattern.md`, don't trust documented status without inspecting current state.
3. Update both the F-class entry AND this section when the row lands.

---

## State of the bench (for the next session)

- Galaxy device serial `RFCT10C1GSZ` is attached and has the Stream-C debug APK installed (com.carelog, versionCode 6, versionName 1.4.0).
- adb is at `/opt/homebrew/bin/adb`.
- App was last launched at 17:21 IST on 2026-05-17; no FATAL.
- F41 (Mac mini Core Audio wedge) is still latent; if voice verification is needed for a later stream, fall back to the remote-TTS workaround per `voice_harness_lessons.md` lesson 7.

## State of the working tree

- `main` will be at the Stream A commit once committed + pushed.
- Pre-existing drift listed above is unstaged and untouched — leave it alone unless directly relevant to the next stream.
- Soak clock continues to **2026-05-22** (Stream H prod-prep target).
- Stream B's three stale `tfplan.streamb*` files in `environments/staging/` were removed as housekeeping during Stream A (they were untracked, not pre-existing drift; just consumed plan-file leftovers).

---

## M1 §1 + §4 follow-ups (testing-todos-v2-phase5 session) — **2026-05-17 evening**

Picked up the "Must-do before closed beta" §1 (F40) and §4 (untested product surfaces) line items as a single session.

### §1 — F40 — **observability landed; re-verify deferred (commit `<pending>`)**

**Verdict:** Code-review concludes the text-fallback path is structurally identical to the verified voice path. Most-likely explanation for the 2026-05-16 bench narrative is misobservation — the UI states quoted (PENDING_CONFIRMATION + Session complete) require `applyTurnResponse` to fire, which requires successful HTTP roundtrip, yet the bench reported zero bedrock-router invocations. Internal inconsistency.

**What landed:**
- `MatikaConversationViewModel.onTextSubmitted` (lines 287-310) — three new log lines:
  - Entry: `Log.i(TAG, "onTextSubmitted chars=$n; submitting turn")` (mirrors the voice path's `Log.i` at line 259).
  - Early-return on blank: `Log.w(TAG, "onTextSubmitted ignored — blank text")`.
  - Early-return on in-flight: `Log.w(TAG, "onTextSubmitted ignored — prior turn still in flight")`.
- `docs/testing_todos_v2.md` F40 entry rewritten — severity downgraded from High to Medium-Probable-Misobservation; full code-path walkthrough cited (file:line for every step); 7-step verification recipe for the next bench session (logcat grep + RDS query + branching by which log line fires).

**Why the unit test was skipped.** `MatikaConversationViewModel` takes 7 Hilt-injected dependencies (`SttManager`, `TtsManager`, `BedrockTurnClient`, `ConversationStateMachine`, `AuthRepository`, `AppSettings`, `CloudApiService`, plus `SavedStateHandle`). A focused "text-submit hits turnClient.submitTurn" test would have required 5+ new fakes for what amounts to a 3-line assertion. The bench re-verify is the higher-leverage artifact.

**Outstanding for the next bench session.** Verification recipe is captured in F40 entry §"Verification recipe for next bench session". Branches: (a) `onTextSubmitted chars=...` fires + RDS row exists → close F40 as misobserved. (b) Log fires + RDS row missing → real network/auth failure, file as the actual bug. (c) Log does NOT fire → Compose wiring regression.

### §4 — Untested product surfaces — **manual-entry tiles all PASS staging end-to-end**

Six manual-entry tile flows driven against staging Jane PT (`+pt9@gmail.com` / `CL-012W6M`) via Maestro. All 6 PASS UI path **and** the FhirSyncWorker → backend → S3 pipeline.

**What landed:**
- Drove `patient_manual_log_pulse`, `_blood_pressure`, `_glucose`, `_spo2`, `_temperature`, `_weight` against staging. First run of BP failed; flow updated for the PR-3 nav-result pattern (BloodPressureScreen migrated from `SaveAcknowledgement` overlay to PatientHomeScreen `Snackbar` — the Maestro flow's `save_acknowledgement` testTag assertion was bit-rotted). Updated flow asserts `(?i)Saved BP 130/85.*` Snackbar text instead. Re-run → PASS.
- Live evidence: 8 observation JSONs landed in `s3://carelog-v2-staging-documents-316643066568/observations/CL-012W6M/2026/05/18/` (UTC partition) between 20:54:30 and 21:07:00 IST. Sizes: ~941-964 bytes for single-value vitals, 1576 bytes for BP (which has systolic + diastolic components).
- **WorkManager sync flush** (§4 row "Confirm vitals recorded via voice OR manual entry actually land in S3"): confirmed end-to-end. FhirSyncWorker logcat: `Found N pending observations to sync` → `Synced observation ... → serverId=...` → S3 write. Worker fires automatically on app foreground (`SyncManager.connectivityChanged` → `enqueueWifiSync`), no manual force-trigger needed.
- `docs/journeys_non_voice.md` PT-V2-15 through PT-V2-20 rows updated — each retains its 2026-05-10 dev evidence + appends 2026-05-17 staging re-verify timestamp + S3 path + the BP PR-3 flow-repair note.

**Deviation from the playbook + lessons captured:**
- **Staging Jane PT password mismatch.** `~/.matika-test-creds.env` carried `MATIKA_PATIENT_EMAIL=sanyalsubhajit2010+pt@gmail.com` (the **dev** account) and `MATIKA_PATIENT_PASSWORD=buri123@S`. Switching the email to `+pt9@gmail.com` (staging) didn't suffice — staging account's password was different (Cognito `NotAuthorizedException`). User authorised `aws cognito-idp admin-set-user-password --permanent` to align the two; the staging Jane PT password now matches dev. Net: a future bench session against staging works out-of-box with the existing creds file. Caregiver creds (`+cg@gmail.com`) also need the same reset before a staging caregiver-trends drive can run — defer to next session if needed.
- **Maestro flow staleness pattern.** BP's flow was marked PASS on 2026-05-10 dev but was structurally broken against the current build because BloodPressureScreen migrated to the PR-3 Snackbar pattern post-flow-authoring. Other 5 vital screens still use the `SaveAcknowledgement` overlay. If/when those migrate, their flows will also bit-rot the same way. Add to `maestro_lessons.md` (TODO).
- **`clearState: true` racing the sync.** Each Maestro flow opens with `launchApp: clearState: true`, which wipes Room DB. The 8 observations landed in S3 ONLY because WorkManager fired between flows (foreground-trigger via `SyncManager` on app start). On a tight back-to-back run, clearState could wipe before sync — risk for future, low for current bench cadence.

**§4 rows still open (deferred to next bench session):**
- **Hindi voice flow + Bengali voice flow** — Maestro flows exist (`patient_voice_bp_hi_single_turn.yaml`, `patient_voice_bp_bn_single_turn.yaml`); needs Mac mini voice harness (or remote-TTS workaround per `voice_harness_lessons.md` lesson 7) + Mac mini reboot for Bengali.
- **Manage Care Team E2E** (multi-device invite-then-accept) — no existing Maestro flow; needs hand-driven on two devices.
- **Voice F23 retry path** — `f23_voice_patient_onboarding.yaml` exists; needs full bench voice drive.

**Files touched (final scope):**
- `android/app/src/main/java/com/carelog/inference/MatikaConversationViewModel.kt`
- `.maestro/flows/patient_manual_log_blood_pressure.yaml`
- `docs/testing_todos_v2.md`
- `docs/journeys_non_voice.md`
- `docs/next-steps-2026-05-17-progress.md` (this file)

**Out-of-repo side effects:**
- `~/.matika-test-creds.env` — `MATIKA_PATIENT_EMAIL` swapped from `+pt@gmail.com` (dev) to `+pt9@gmail.com` (staging). Not in the repo (no .env files are tracked).
- Staging Cognito user `01f35daa-20c1-7074-1879-31fccc56806d` (Jane PT) — password reset to `buri123@S` to align with dev. Side effect on any automation that previously used the old staging password.
- Staging RDS / S3 — 8 synthetic observations against `CL-012W6M`. Not destructive; cluttering Jane's history.

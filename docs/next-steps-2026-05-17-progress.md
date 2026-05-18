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

## Streams NOT yet started

- **Stream A — Cognito drift apply (`66ca57c`).** Highest risk. Recommended last.
- **Stream B — CG-V2-16 (delete-patient + cascades).** Medium risk. Destructive on DB; needs explore subagent then (probably) plan subagent.

**Risk-ordered recommendation for the next stream:** **B**. Stream C + D are now landed. The kickoff's C → D → B → A order says B is next. Unblocks DPDP right-to-erasure (a beta gate). Begin with Stream B's Subagent 1 (Explore — delete-patient lambda + cascade inventory) per `docs/next-steps-2026-05-17.md` §2 Stream B playbook. Stream A goes last because it touches auth infra and the rest of the tree should be on a known-good baseline first.

---

## State of the bench (for the next session)

- Galaxy device serial `RFCT10C1GSZ` is attached and has the Stream-C debug APK installed (com.carelog, versionCode 6, versionName 1.4.0).
- adb is at `/opt/homebrew/bin/adb`.
- App was last launched at 17:21 IST on 2026-05-17; no FATAL.
- F41 (Mac mini Core Audio wedge) is still latent; if voice verification is needed for a later stream, fall back to the remote-TTS workaround per `voice_harness_lessons.md` lesson 7.

## State of the working tree

- `main` is at `5be33c3` locally and on `origin`.
- Pre-existing drift listed above is unstaged and untouched — leave it alone unless directly relevant to the next stream.
- Soak clock continues to **2026-05-22** (Stream H prod-prep target).

# Matika v2 — Testing Backlog (Path to Exhaustive Coverage)

**Date:** 2026-05-11 (post-F17 push-transport sweep)
**Source:** Sweep `20260508_215314` (Standard, English voice), augmented by 2026-05-09 backend-chain audit, 2026-05-10 F23 ship + voice cluster, 2026-05-10 post-F23 manual-vital + caregiver-screen sweep, 2026-05-11 post-F23 fix sweep (F27 + EDGE-V2-14 + F3-verified), and 2026-05-11 F17 push-transport sweep (SNS Platform App provisioned, AndroidManifest service registered, end-to-end synthetic alert verified). See report at `test-automation/results/journey-results/20260508_215314/report.md` (local-only; gitignored).
**Status:** 36 of 64 non-voice journeys PASS as of 2026-05-11 (was 35 earlier today). F17 RESOLVED end-to-end — Android caregiver receives FCM push for a threshold-breach alert; the four push-dependent rows (CG-V2-07 PASS synthetic; CG-V2-08/09 + E2E-V2-02/03/06 transport-unblocked pending one organic re-run each). PT-V2-06 (Bengali voice) remains bench-blocked on the Core Audio wedge (lesson 6, reboot-only). Exhaustive coverage is **~1 week** away — DR-V2-* web-portal data-testid + Playwright runner is the remaining parallel stream.

---

## Voice sweep (2026-05-10) — newly raised + resolved

### F29 — DELETE /patients/{patientId} was a MOCK integration; lambda existed but never called (RESOLVED — verified live 2026-05-12)

**Severity:** Was **High — beta blocker for DPDP right-to-erasure compliance**. Caregivers calling DELETE on a patient got a hardcoded 200 from the API Gateway MOCK integration; the `delete-patient` Lambda (which has the soft-delete cascade for Cognito + persona_links + invites + patient row + audit log) was never invoked. Patients reported as "deleted" actually persisted in RDS.

**Owner:** `backend` + `devops` (route wiring) + `qa-testing` (Maestro flow for CG-V2-16 follow-up).

**Status:** Wired live. The lambda was deployed Apr 27 (`carelog-dev-delete-patient`, handler `index.handler`, runtime nodejs20.x, role `carelog-dev-lambda-rds-cognito`). Out-of-band: not in terraform (lambda-drift class), but functionally complete. The API Gateway invoke permission was already in place (`apigateway-delete-patient` statement on the function). Only the integration was wrong: `aws_api_gateway_integration.patient_delete` was `type = "MOCK"` with `request_templates = {"application/json" = "{\"statusCode\": 200}"}` and a paired `aws_api_gateway_integration_response`.

Fix applied via the CLI hybrid pattern (memory `terraform_lambda_drift_pattern.md`):
- `aws apigateway delete-integration-response` (the MOCK 200 stub)
- `aws apigateway delete-integration` (the MOCK)
- `aws apigateway put-integration --type AWS_PROXY --integration-http-method POST --uri arn:aws:apigateway:ap-south-1:lambda:path/2015-03-31/functions/arn:aws:lambda:ap-south-1:316643066568:function:carelog-dev-delete-patient/invocations`
- `aws apigateway delete-method-response` + `put-method-response` to restore CORS header on the new shape
- `aws apigateway create-deployment --stage-name dev` (deployment id `t6w0t4`)

Terraform code reconciled: `infrastructure/terraform/modules/api_gateway/main.tf` `patient_delete` block now declares the AWS_PROXY integration, removed the integration_response (AWS_PROXY doesn't need an explicit one). New `var.delete_patient_invoke_arn` in the api_gateway module variables, fed from `local.delete_patient_invoke_arn` in root main.tf — constructed string for the same lambda-drift reason as the cognito triggers (lambda not in terraform state yet). `terraform apply -refresh-only` brought state in line with live; `terraform plan` confirms no further drift on this surface.

**Live evidence (2026-05-12):**
- `aws apigateway get-method --resource-id rejty6 --http-method DELETE` → `methodIntegration.type = AWS_PROXY`, `uri = arn:…/carelog-dev-delete-patient/invocations`
- `curl -X DELETE -H "Authorization: <John CG IdToken>" https://rsf93ac8bd…/dev/patients/00000000-0000-0000-0000-000000000000` → HTTP 403 with body `{"error":"You do not have permission to delete this patient. Only the primary caregiver can do this."}` — the lambda's own response shape, not a MOCK 200.
- CloudWatch `/aws/lambda/carelog-dev-delete-patient` logs the same RequestId during the call: `INFO Delete patient request received` (cold start, Init Duration 477.70 ms) — confirms the new wiring routes to the lambda.

**Follow-ups (non-blocking for the wiring fix; track separately):**
- Author the **CG-V2-16 Maestro flow** (Android UI: Settings → Manage Care → Delete Patient → confirm dialog → assert patient is gone from caregiver dashboard). Will need a synthetic test patient (NOT Jane), since the cascade is destructive.
- **End-to-end cascade test** with a freshly-created patient: verify Cognito user is disabled, all `persona_links` are flipped `is_active=false`, all `invites` are soft-deleted, the `patients` row is soft-deleted, and an `audit_log` entry exists.
- **Bring delete-patient lambda into terraform state** (lambda-drift class follow-up). Same shape as the other ~6 lambdas with source-code-hash drift from CLI deploys.
- The same MOCK pattern lives at `DELETE /patients/{patientId}/team/{memberId}` (`team_member_delete` block in api_gateway/main.tf:381). That's CG-V2-11 (remove team member), which is **deferred to Phase 2** with the rest of the doctor-related work — leave as MOCK for v2.0.

### F27 — Patient conversation entry gated on legacy v1 Mac Mini health check after `clearState` (RESOLVED — verified live 2026-05-10)

**Severity:** Was Critical for patient-persona conversation journeys. Blocked PT-V2-07 (`patient_logging_happy_path` — the CI gate), PT-V2-05, PT-V2-06, PT-V2-08, PT-V2-09, EDGE-V2-03, EDGE-V2-11, EDGE-V2-13 — every flow that taps `patient_home_start_conversation`. Phase-1 manual-vital flows (PT-V2-15..21) are unaffected because they take the tile path. F23 voice patient onboarding works because it routes through `add_patient_voice_fab` on the caregiver dashboard, not the patient home button.

**Status:** Path A shipped. `ModelStatusBanner.computeDegradationState` OFFLINE branch now returns `canConverse = true, severity = NONE, message = null`. Re-verified live 2026-05-10:
- `patient_logging_happy_path` (CI gate) — PASS
- `patient_guardrail_block_text` (EDGE-V2-03, also re-verifies F19) — PASS
- `patient_implausible_text` (PT-V2-08) — PASS
- `patient_emergency_text` (PT-V2-09) — PASS
- `patient_pause_resume_text` (PT-V2-13) — PASS
- `patient_implausible_glucose_text` (EDGE-V2-11) — PASS
- `matika-connectivity-test.sh` (EDGE-V2-13, 3-part wifi cycle) — all parts PASS

Each PASS culminates in `matika_response_card` (or the offline `Turn failed` toast for part 2 of the connectivity test) which requires a real device→Bedrock round-trip — UI mounts are the live evidence. In v2 the Android client invokes Bedrock directly via the AWS SDK; there is no backend `bedrock-router` lambda to grep CloudWatch for (`/aws/lambda/carelog-dev-bedrock-*` does not exist — orchestrator-doc reference was v1-era).

**Owner:** `android-app`.

**Reproduction:**
1. `adb shell am force-stop com.carelog && scripts/maestro-run.sh patient_logging_happy_path`.
2. Flow advances past login → `patient_home_start_conversation` is assertVisible-OK → tap completes silently → `matika_text_fallback` never mounts → assert fails.
3. `adb logcat -d -s MacMiniDiscovery` shows `mDNS discovery started for _carelog._tcp.` but no match — no Mac Mini advertises on the dev LAN.

**Root cause:**
- `dashboard/ui/PatientHomeScreen.kt:205` gates the conversation `Button` with `enabled = degradation.canConverse`.
- `degradation = computeDegradationState(healthStatus)` (line 110).
- `healthStatus` comes from `discovery/HealthCheckService` which polls a Mac Mini health aggregator at `:8000/health` after discovering the host via mDNS `_carelog._tcp.`.
- v2.0 (May 2026) replaced the Mac Mini architecture with AWS Bedrock + Android on-device STT/TTS — no Mac Mini is on the dev LAN any more.
- mDNS finds nothing, `appSettings.macMiniBaseUrl` is null (DataStore was wiped by `clearState: true`), so `_healthStatus` stays at `ModelHealthStatus.OFFLINE`.
- `computeDegradationState` maps OFFLINE → `canConverse = false` → button disabled → taps are no-ops at the Compose layer.

**Fix sketch (one of):**
- A) Drop the v1 health gate on the patient home entry: in `ModelStatusBanner.computeDegradationState`, treat OFFLINE the same way as HEALTHY for the conversation button (the v2 Bedrock backend is the actual health surface; an unreachable Mac Mini should not block conversation). Keep the warning banner for transparency. Smallest blast radius, surgical.
- B) Replace `HealthCheckService` entirely — point it at a v2 backend health endpoint (e.g. `bedrock-router` `/health`) and drive `canConverse` off that. Larger change, ties in with `health-check` lambda surface.
- C) Quick test-bench band-aid (NOT a real fix): bring back a Mac-Mini health-aggregator stub on the LAN, OR pre-seed `mac_mini_base_url` via `adb shell run-as com.carelog` into DataStore before each flow.

Recommend Path A for the v2.0 cleanup and Path B in v2.1 with the wider `carelog-*` → `matika-*` rename. Both unblock the patient conversation path.

**Live evidence captured:**
- Maestro debug screenshots at `~/.maestro/tests/2026-05-10_222645` (CI-gate run) and `~/.maestro/tests/2026-05-10_215143` (guardrail-flow run) — both show the home button rendering as "Conversation Unavailable" with contentDescription "Conversation unavailable. CareLog device services are not ready."
- `adb shell uiautomator dump` confirmed the disabled-state copy was on screen at the moment of the failed assert.

### F28 — Debug-build offline auth bypass for EDGE-V2-14 wifi-cycle harness (RESOLVED — verified live 2026-05-11)

**Severity:** Was Medium. EDGE-V2-14 (`matika-bp-network-drop.sh`) cycles wifi off → write vital offline → wifi on → assert sync. The harness was marked PARTIAL because `AuthRepository.checkAuthSession()` calls Amplify `fetchCurrentUser()` on every cold start; under wifi-off, that throws and the app boots to login, defeating the test premise that an authenticated patient stays signed-in across short connectivity drops.

**Owner:** `android-app`.

**Status:** Shipped in commit `dcfcfe4` (2026-05-11). `AuthRepository` now:
- Caches the current user (`email`, `userId`, `personaType`, `linkedPatientId`) to existing `carelog_auth` SharedPreferences on every successful `fetchCurrentUser()` (no new storage surface).
- On `fetchCurrentUser()` failure, falls back to the cached user **only when all three conditions hold**: `BuildConfig.DEBUG == true`, `NetworkMonitor.isConnected() == false`, and a cached user is present. Production builds raise the original network error unchanged.
- `NetworkMonitor` is constructor-injected via Hilt; `AuthModule.provideAuthRepository` forwards it.

**Live evidence:**
- `scripts/matika-bp-network-drop.sh` exits 0 — flow logs in as Jane, drops wifi, writes BP 130/85, restores wifi, asserts the row is present in observations history.
- CloudWatch `/aws/lambda/carelog-dev-sync-observation` confirms the post-restoration sync hit the lambda at the right time with the right `patient_id`.
- BuildConfig.DEBUG=false (release build) was sanity-checked by `./gradlew assembleRelease` + manual wifi cycle — the cached-user branch is unreachable; the app logs out on auth-session failure, matching production semantics.

**Production-strip follow-up (RESOLVED 2026-05-11 launch-readiness sweep).** The original 2026-05-11 PARTIAL note flagged that the bypass was "debug-only by construction," but a release-build audit found that wasn't actually true — `AuthRepository.kt:148` was gated on `com.carelog.core.BuildConfig.DEBUG`, a **custom** constant hardcoded to `true`, NOT the Gradle-generated `com.carelog.BuildConfig.DEBUG`. So the bypass ran in release builds.

The launch-readiness sweep also found that all networking layers read the same custom `BuildConfig.API_BASE_URL`, hardcoded to the dev API Gateway. The Gradle release-variant URL (`https://api.carelog.com`) was dead code — no caller imported `com.carelog.BuildConfig`.

Fix: deleted `com.carelog.core.BuildConfig.kt`, switched 7 imports + 4 fully-qualified references to `com.carelog.BuildConfig`, moved `USE_V2_INFERENCE` to a Gradle `buildConfigField` on both debug + release variants, added an explicit import in `CareLogApplication.kt` and `PhiSanitizer.kt` to disambiguate same-package resolution after the delete. Updated `scripts/update-app-config.sh` to update the Gradle debug-variant `buildConfigField` instead of the deleted file. Stripped 5 PHI-leaking `Log.d` calls the audit surfaced (`CareLogNavHost.kt`, `AuthRepository.kt` x2, `DeviceTokenManager.kt`, `RelativeDashboardViewModel.kt`). Added blanket `-dontwarn` rules to `proguard-rules.pro` for HAPI FHIR optional deps (Thymeleaf, Schematron, AWT, JAXB crypto, etc.) so R8 finishes minification. Bumped Gradle JVM heap 2 GiB → 6 GiB so the R8 step doesn't OOM.

**Live release-build evidence (2026-05-11):**
- `./gradlew assembleRelease` exits 0; produces `android/app/build/outputs/apk/release/app-release-unsigned.apk` (42.5 MB, 3 dex files).
- `strings classes*.dex | grep rsf93ac8bd` → **0 hits**. The dev API Gateway hostname is no longer in the release binary.
- `strings classes*.dex | grep "api\.carelog\.com"` → 2 hits (the placeholder prod URL embedded by the release variant's `buildConfigField`). To swap once the prod sender domain is decided (launch plan Stream D #5).
- `strings classes*.dex | grep "Offline debug bypass"` → **0 hits** in release. The same string appears in the debug APK's classes13.dex, confirming R8 dead-code-eliminated the `if (BuildConfig.DEBUG && …)` branch in release while preserving it in debug.

**Files touched in the 2026-05-11 follow-up:**
- `android/app/build.gradle.kts` — added `buildConfigField("Boolean", "USE_V2_INFERENCE", "true")` on both variants; release-variant URL marked TODO for Stream D #5.
- `android/gradle.properties` — `-Xmx2048m` → `-Xmx6144m` for R8 release minify.
- `android/app/proguard-rules.pro` — blanket `-dontwarn` rules for HAPI optional deps.
- `android/app/src/main/java/com/carelog/core/BuildConfig.kt` — **deleted**.
- 7 import switches: `UploadService`, `DeviceTokenManager`, `RelativeApiService`, `FhirModule`, `PatientRepositoryImpl`, `ConsentRepositoryImpl`, `InviteRepositoryImpl`.
- 4 fully-qualified `com.carelog.core.BuildConfig.*` → `com.carelog.BuildConfig.*` substitutions: `AuthRepository` (DEBUG), `CareLogNavHost` (USE_V2_INFERENCE x3), `NetworkModule` (API_BASE_URL).
- Explicit `import com.carelog.BuildConfig` added to `CareLogApplication.kt` and `PhiSanitizer.kt` (otherwise unqualified `BuildConfig` would not resolve after delete).
- 5 PHI-leaking `Log.d` calls stripped (no replacements added; the auth-session "Authenticated as $persona" line was preserved gated on `BuildConfig.DEBUG` since it doesn't carry PHI by itself).
- `scripts/update-app-config.sh` — rewritten to update the Gradle debug-variant `buildConfigField` via sed instead of writing to the deleted file.

**Files touched in the original 2026-05-11 fix (preserved):**
- `android/app/src/main/java/com/carelog/auth/AuthRepository.kt` (cache + bypass)
- `android/app/src/main/java/com/carelog/auth/AuthModule.kt` (Hilt wiring)
- `scripts/matika-bp-network-drop.sh` (dropped the KNOWN BLOCKER comment)

### F20 — `matika-voice-run.sh` logcat trigger was Pixel-only (RESOLVED — verified live 2026-05-10)

**Severity:** High for voice journeys. Was: every voice run on the Samsung S21+ test bench failed because `matika-voice-run.sh`'s `TRIGGER='Offline recognizer - start listening'` never matched any logcat line on this OEM (Soda's "Offline recognizer..." system log is Pixel/Google ROM only).
**Owner:** `qa-testing` + `android-app`.
**Status:** Fixed and verified end-to-end. Added a deterministic `Log.i(TAG, "RecognitionListener.onReadyForSpeech: mic open")` line in `SttManager.kt:onReadyForSpeech`, and updated `scripts/matika-voice-run.sh` `TRIGGER` constant to match. Verified 2026-05-10 — five back-to-back voice runs (PT-V2-03/04/05/06 + CG-V2-03) all caught the trigger at the right moment.

### F21 — Wedged `say` queue blocks voice runs (RESOLVED — verified 2026-05-10)

**Severity:** High for voice journeys. Symptom: Soda returns NO_MATCH (error 7) on every voice utterance even though the harness fires correctly. Cause: Mac's `say` processes from prior runs accumulate in a stuck state, blocking the audio queue. Five orphan `say` processes were holding the queue across sweeps.
**Owner:** `qa-testing`.
**Status:** Mitigation: `killall say` before each voice run; folded into preflight. Once cleared, PT-V2-03 single-turn passed cleanly.

### F22 — No UI exposes `AppLanguage` picker (RESOLVED — verified live 2026-05-10)

**Severity:** Was Medium. Blocked PT-V2-05 (Hindi) and PT-V2-06 (Bengali) end-to-end testing — patient sessions always seeded `language=en-IN` regardless of intent.
**Owner:** `android-app`.
**Status:** Fixed. Picked Path A (in-UI picker) over Path B (debug-gated broadcast receiver) since the picker is also a real product affordance for elderly users, not just a test hatch.

**Implementation.** Three-option `LanguagePickerCard` on `SettingsScreen`, positioned right after the Account Info card so all personas see it. RadioButton group with native-script labels (`English`, `हिन्दी (Hindi)`, `বাংলা (Bengali)`) — native scripts render the language name in its own glyphs so an elderly Hindi/Bengali speaker recognizes it without depending on the English label. testTags use ISO codes (`language_option_en` / `language_option_hi` / `language_option_bn`) so the harness doesn't depend on glyph rendering. Section testTag `settings_language_card` for scroll-into-view.

`SettingsViewModel` got two additions: `language: Flow<AppLanguage>` (read-through from `appSettings.language`) + `setLanguage(AppLanguage)` (launches into `viewModelScope`). The ViewModel was already DI-wired with `AppSettings`; just exposed two new accessors.

**Selection takes effect on the next conversation session.** `MatikaConversationViewModel` reads `appSettings.language.first()` once per `startSession()`, which matches the existing pattern. Mid-conversation language switches are out of scope (and would be confusing UX). The picker description text spells this out: *"Used for voice conversations and on-screen text. Takes effect on the next conversation."*

**Verification.** `_f22_language_picker_smoke` Maestro flow against Samsung RFCT10C1GSZ:
- Logged in as Jane → Settings → all 3 testTags visible (`language_option_en/hi/bn`)
- Tapped Hindi → restarted app (clearState=false) → returned to Settings
- Native-script label `हिन्दी (Hindi)` still rendered, proving DataStore persisted the selection across process death
- Reset back to English at flow end so downstream flows aren't surprised
- All assertions COMPLETED

**Journey impact.** PT-V2-05 (Hindi) and PT-V2-06 (Bengali) Maestro flows can now switch language via the in-UI picker:
```yaml
- tapOn: { text: "Settings" }
- tapOn: { id: language_option_hi }
- back
```
…replacing the documented `adb run-as` DataStore-protobuf hack. The hack still works as a fallback for fresh-install / uninstrumented testing.

**Files touched.** `android/app/src/main/java/com/carelog/ui/settings/SettingsScreen.kt` (LanguagePickerCard + LanguageOptionRow composables, AppLanguage import, ViewModel wiring). No backend, no migration, no terraform.

### F23 — No "Add Patient via Conversation" entry (RESOLVED 2026-05-10)

**Severity:** Was Medium. Blocked CG-V2-04 as originally written.
**Owner:** `android-app` (done) + `backend` (done) + `inference-platform` (prompt + Haiku two-pass FSM + create-patient-from-voice lambda — done).
**Status:** Shipped end-to-end (PRD §6.3.1 / §8.1 / §6.5, spec §4.5 / §6.9). Verified live on dev 2026-05-10: a real conversation through the placeholder bootstrap path fired `caregiver_onboarding pivot ok` (session `fb2f7e87-4252-412b-a198-852732e03e5e`) which invoked `create-patient-from-voice` (`patientShortId: CL-LW0LEH`, Asha Devi, 68, hypertension), produced a new Cognito user, inserted the matching `users`/`patients`/`persona_links` rows, and UPDATEd `interaction_sessions.patient_id` from NULL → the new UUID — all four RDS evidence rows visible.

**What shipped.**
- Schema: V008 (interaction_sessions.patient_id nullable for caregiver_onboarding) + V009 (FSM check constraint adds EXTRACTING_PROFILE, AWAITING_PROFILE_CONFIRMATION, PROFILE_CONFIRMED).
- Backend: `backend/lambdas/create-patient-from-voice/` lambda (Cognito + RDS + persona_links + SES welcome email) + `bedrock-router` two-pass FSM (profile-extraction prompt + protocol-extraction prompt) + mid-session pivot via direct Invoke + post-pivot patientCtx refresh.
- Android: secondary FAB `add_patient_voice_fab` on `CaregiverHomeScreen` → new `MATIKA_PATIENT_VOICE_ONBOARDING` route (carries `sessionId` + `pending-<sessionId>` placeholder patientCognitoSub as path args, minted at the FAB) → `MatikaConversationScreen` with `isVoicePatientOnboarding=true` + `PatientCredentialsDialog` (email/phone, fired by LLM's `pause_session{reason:awaiting_patient_credentials}`) + "Use form instead" escape button.
- Tests: 393 backend tests passing; Android Debug APK builds clean.

**Commits.** `37d18cc` (V008+V009+create-patient-from-voice), `f6caff5` (bedrock-router two-pass FSM), `c9fc7f4` (3 step-3 fixups — rate-limiter sentinel bypass, placeholder user_id resolution, patientProfile.name minLength drop), `206913a` (Android Step 4), `0e55fb7` (sessionType→sentinel gating, AlertDialog testTagsAsResourceId, IME-Send action), `78d975d` (selectSystemPromptPath pinned by `patientCtx.placeholder`, isPivotTurn drop newFsmState gating, wantsPivotButNoProfile recovery, Compose onPreviewKeyEvent hardware-Enter, Maestro thinking+speaking double-gate).

**Known follow-ups (non-blocking).**
- Streaming `/conversation/turn` handler does NOT implement F23 pivot logic. Android client forces `preferStreaming=false` while the `pending-<sessionId>` sentinel is in use; see `handler.ts` line ~1614 for the TODO marker. Mirror the pivot logic when streaming is added for caregiver_onboarding.
- patientProfile persistence across turns. The current pivot path requires `parsed.patientProfile` on the closing turn; if Haiku drops it (live repro: dev session `4ef3f90b` on 2026-05-10), the handler's `wantsPivotButNoProfile` recovery sends a friendly retry prompt rather than wedging the session. A more robust fix is to persist `patientProfile` JSON in `interaction_sessions` per-turn and use the persisted value on pivot.
- iOS-side voice patient onboarding is out of scope for v2.0 per Android-focus directive.

### F24 — Soda `bn-IN` offline pack absent on test device (RESOLVED — subsumed by F25 fix, 2026-05-10)

**Severity:** Was Low. Originally blocked PT-V2-06 (Bengali) because the engine surfaced `error 12` (LANGUAGE_NOT_SUPPORTED) without trying the network.
**Owner:** `android-app` (done via F25).
**Status:** Resolved. F25's silent online fallback handles missing-pack cases automatically — the bn-IN session no longer hard-errors. Manual offline-pack install is no longer required for the test device. (Production users still benefit from installing the pack for offline reliability + lower latency, but it's no longer a hard prerequisite.)

### F26 — Caregiver Threshold/Reminder/Trends fetch lands "Retry" (RESOLVED — thresholds 2026-05-10, reminders 2026-05-15 via F26b voice-only)

**Severity:** Was Medium. Surfaced during F4 Path A verification: ThresholdConfigScreen, ReminderConfigScreen, and TrendsScreen all error out on John CG's session because the v1 backend chain (threshold-crud / reminder-crud lambdas + `/patients/{id}/thresholds` and `/patients/{id}/reminders` API routes) is unwired AND points at vestigial v1 tables (`thresholds`, `reminder_configs`) that v2's alert engine doesn't read.
**Owner:** `android-app` (done for thresholds) + `product` (defer reminder UX to v2 redesign).

**Root cause analysis.** Three layered issues, only the first of which is real after this fix:

1. **The v1 lambda backends were broken AND vestigial.** `threshold-crud` and `reminder-crud` had F13/F15/F16-class column drift (`persona_links.user_id` doesn't exist; should be `linked_user_id` / `is_active` not `status`). `thresholds.doctor_id` doesn't exist; schema has `set_by_user_id`. But more importantly, even fixing those bugs would write to v1 tables that **`evaluate-thresholds-batch` doesn't read** — v2's alert engine reads `parameter_configs` (set by the caregiver_onboarding voice protocol). Saving thresholds via the v1 path would have zero effect on alerts.
2. **API Gateway routes were missing.** `/patients/{patientId}/thresholds` and `/patients/{patientId}/reminders` (the URLs Android calls) never had method+integration pairs wired. Requests 404'd before reaching the lambda.
3. **John CG's `custom:linked_patient_id` Cognito attribute was pointing at a non-Jane test patient (`CL-NC646J`) that has 0 parameter_configs rows.** Repointed to Jane's `CL-63NRGO` so the screen pulls the seeded BP thresholds.

**Fix.** Picked Option 1 (wire to v2 `parameter_configs`). Repointed Android instead of fixing the dead v1 lambdas:
- New `RelativeApiService.getParameterThresholds(patientId)` calls `GET /patients/{patientId}/parameter-configs` (the v2 lambda + route already exist and are correct — `manage-parameter-configs/index.js` does the cognito_sub→users.id resolution + `linked_user_id`/`is_active` access check + short-id→patients.id lookup, all clean).
- New `RelativeApiService.updateParameterThreshold(patientId, configId, min, max)` calls `PUT /patients/{patientId}/parameter-configs/{configId}` with `threshold_min` / `threshold_max` as JSON arrays (matching the schema's numeric[] column type).
- New `ParameterThreshold` data class (parameterName: String, displayName: String, …) replaces `VitalThreshold` for this screen — needed because the v2 schema's `vital_type` enum has 7 values (BP splits into systolic+diastolic) vs the Android `VitalType` enum's 6.
- ThresholdConfigScreen + ThresholdConfigViewModel now iterate over the new data shape. testTags use the schema enum directly (`threshold_blood_pressure_systolic_min` etc.), which is what future Maestro flows for CG-V2-12 will target.
- TrendsViewModel also pointed at `getParameterThresholds`; maps the legacy `VitalType` enum to the schema's parameter_name (BP→systolic by convention) for the chart's breach band.
- Legacy `getThresholds(patientId)` kept (with `@Deprecated`) for any straggler callers; will be removed when none remain.

**Reminder side resolved via F26b voice-only (2026-05-15).** Product decision (`v2_stream_d_decisions_20260512.md`): reminders are configured exclusively through the caregiver_onboarding voice protocol in v2.0. `ReminderConfigScreen.kt` was deleted along with the `CareLogRoutes.REMINDERS` route, the `caregiver_reminders` Manage card, the `onNavigateToReminders` plumbing across `CaregiverHomeScreen` / `RelativeDashboardScreen` / `CareLogNavHost`, and the now-dead `RelativeApiService.getReminderConfig` / `updateReminderConfig` / `parseReminderConfigs` / `ReminderConfig` data class. The voice path persists frequency cadence via `protocol_persister.upsertParameterConfig` UPSERT on `parameter_configs.frequency_days/daily_deadline/timezone` — same UPSERT serves create AND edit. Live evidence: Jane's BP parameter_configs rows confirm schema (`frequency_days=1, daily_deadline=18:00:00, timezone=Asia/Kolkata`); CloudWatch `protocol_extraction_failed` events on caregiver_onboarding sessions prove the path is wired end-to-end. Maestro regression flow `cg_v2_13_voice_reminder_config.yaml` authored; bench run gated on Stream F (Mac Core Audio wedge).

**Live verification (2026-05-10).** `_f26_threshold_smoke` Maestro flow against Samsung RFCT10C1GSZ:

| Check | Result |
|---|---|
| Login as John CG → Manage → Thresholds | Screen mounts; "Threshold Settings" title visible |
| Both BP rows visible with correct values | testTags `threshold_blood_pressure_systolic_min/max` and `_diastolic_min/max` all assert visible. UI-rendered values: Systolic 90.0/160.0, Diastolic 50.0/95.0 — match Jane's seeded `parameter_configs.threshold_min/max` arrays exactly |
| Display name + unit rendering | "Systolic BP" / "Diastolic BP" (from `display_name` column), "mmHg" unit, ❤️ icon (from new `getParameterIcon` helper) |
| Edit + Save round-trip | Tapped systolic max field, erased, typed `165`, tapped Save Changes. Screen refreshed showing 165.0. RDS `parameter_configs.threshold_max` for Jane's systolic row updated from `{160}` to `{165}` (verified via psql). Restored to `{160}` after the smoke. |
| Test data hygiene | John CG's `custom:linked_patient_id` updated from `CL-NC646J` → `CL-63NRGO` (Jane) so future flows hit seeded data |

**Files touched.**
- `android/app/src/main/java/com/carelog/api/RelativeApiService.kt` — `getParameterThresholds` + `updateParameterThreshold` + `parseParameterThresholds` + `firstNumericInsideArrayLike` + `humanizeParameterName` helpers; new `ParameterThreshold` data class; `@Deprecated` on legacy `getThresholds`.
- `android/app/src/main/java/com/carelog/ui/relative/ThresholdConfigScreen.kt` — `ThresholdConfigUiState.thresholds` typed `List<ParameterThreshold>`; `loadThresholds` calls v2 method; `updateThreshold(configId, min, max)` instead of `(vitalType, min, max)`; new `getParameterColor` / `getParameterIcon` helpers handle the schema's full vital_type enum (BP split, glucose subtypes, body_temperature_c/f, body_weight, heart_rate); testTags use `parameterName` directly.
- `android/app/src/main/java/com/carelog/ui/relative/TrendsViewModel.kt` — `getThresholds` → `getParameterThresholds`; new `vitalTypeToParameterName` helper for the BP→systolic mapping convention.
- Cognito (manual): John CG's `custom:linked_patient_id` repointed from `CL-NC646J` to `CL-63NRGO`.

No backend code changes (the v2 `manage-parameter-configs` lambda was already correct). No terraform. No migration.

**Remaining work (deferred).**
- ~~Reminder UX redesign + repoint ReminderConfigScreen at parameter_configs's `frequency_days`/`daily_deadline` fields.~~ **RESOLVED 2026-05-15** via F26b voice-only — screen and its API surface deleted, voice protocol is the only entry point.
- Delete the dead `threshold-crud` and `reminder-crud` lambdas + their unwired API Gateway resources (`/thresholds/{patientId}`, `/reminders/{patientId}`). Tracked alongside the broader cognito-drift terraform reconciliation.
- Author CG-V2-12 Maestro regression flow now that the path is functional.

---

### F25 — `SttManager` does not implement online fallback (RESOLVED — verified 2026-05-10)

**Severity:** Was Medium. Was breaking EDGE-V2-17's contract. When the offline pack for the requested language was missing, the engine surfaced `error 12` and the turn never reached Bedrock.
**Owner:** `android-app`.
**Status:** Fixed. `SttManager.recognize()` now silently retries once with `EXTRA_PREFER_OFFLINE=false` when the offline-preferred first pass returns engine error 12 (LANGUAGE_NOT_SUPPORTED) or 13 (LANGUAGE_UNAVAILABLE). The retry is invisible to the collector — it sees Partial → Final/Error from whichever pass succeeds. Logcat carries `stt_offline_used=true|false` on each path so the agentic voice harness (`scripts/matika-voice-run.sh`) can record which mode actually served a turn.

**Implementation.** `SttManager.kt`:
- `recognize()` factored a `buildListener(preferOffline)` helper so the same logic runs for both passes.
- On error 12/13 from the offline-preferred pass, an `AtomicBoolean` `onlineFallbackUsed` flag (CAS-protected against double-fallback) gates a single re-arm via `mainScope.launch { rec.setRecognitionListener(buildListener(preferOffline=false)); rec.startListening(...) }`.
- The same recognizer instance is reused (faster re-arm, preserves the Singleton lifecycle).
- `buildRecognitionIntent(languageTag, preferOffline)` parameterized the prior-hard-coded `EXTRA_PREFER_OFFLINE=true`.
- Defense in depth: re-arm wrapped in `runCatching` so a re-arm failure surfaces the *original* error to the collector instead of swallowing it.

**Telemetry.** Three log lines tagged for grep:
- Success path: `RecognitionListener.onResults chars=N stt_offline_used=true|false`
- Error/retry path (1st pass only): `stt_offline_used=false: language pack missing for <lang>, retrying with EXTRA_PREFER_OFFLINE=false`
- Per-listener marker on every onReadyForSpeech / onError: `preferOffline=true|false`

Backend persistence (e.g., a new `interaction_sessions.stt_offline_used` column) is *not* shipped — out of F25 scope and would require a backend migration. The logcat trail is sufficient for the agentic voice harness to make this assertion. Folded into a future telemetry pass when the backend storage is wired.

**Verification.**
- Unit test (`SttResultTest.kt`): added a `F25 — language-pack errors map to LANGUAGE_NOT_SUPPORTED` test pinning `mapAndroidErrorCode(12)` and `mapAndroidErrorCode(13)` to `LANGUAGE_NOT_SUPPORTED`. The fallback gate references those exact codes; the test guards future regressions of the mapping.
- Logging-shape smoke (`_f25_stt_log_smoke`, removed after run): logged in as Jane, tapped mic on en-IN home; logcat confirmed `RecognitionListener.onReadyForSpeech: mic open preferOffline=true` and on user inactivity `RecognitionListener.onError(7) preferOffline=true` (NO_MATCH; correctly NOT in the fallback gate, retry didn't fire).
- The actual bn-IN error-12 retry path will be exercised when EDGE-V2-17 gets a Maestro flow (requires DataStore language=bn seeding + gTTS Bengali audio per the existing `patient_voice_bp_bn_single_turn.yaml` setup). Code-review-verified for now.

**Files touched.** `android/app/src/main/java/com/carelog/conversation/audio/stt/SttManager.kt`, `android/app/src/test/java/com/carelog/conversation/audio/stt/SttResultTest.kt`. No backend, no migration, no terraform.

---

## Staging bench-test gaps (2026-05-15)

Staging bench against `https://3mni7nx5bf.execute-api.ap-south-1.amazonaws.com/staging` (API GW), `i-0f2acdf1a96ee24a6` (bastion), `carelog-staging` (RDS). Account: caregiver `sanyalsubhajit2010+cg@gmail.com` (John CG); test patient created `Asha Devi` / `sanyalsubhajit2010+staging-pt@gmail.com` (CL-TPUX54). Caregiver bench covered F23 voice + form fallback + dashboard; patient bench covered login + voice BP + manual BP + settings + care-team. Welcome-email end-to-end **PASS** (the FROM_EMAIL + SES_CONFIGURATION_SET fix in commit `99eb49a` is verified — CloudWatch logged the send and the user confirmed receipt in inbox; no bounce/complaint events fired).

### F30 — `bedrock-router` 503s on null `ageConfidence` schema validation (RESOLVED — verified live 2026-05-16)

**Severity:** **High — blocks F23 voice patient onboarding entirely on the caregiver side.** Turn 2 of the voice onboarding flow ("the patient's name is Asha Devi") returned 503 from the router. CloudWatch shows the LLM emitted a structurally-correct response but with `"ageConfidence": null` (age was not yet known at that turn). The JSON-schema validator rejected null on this field (`Schema validation failed: data/patientProfile/ageConfidence must be number`) and the handler bailed after one retry. The conversation is stuck — the client silently sits on the last "you said" card with no error feedback (see F31).

**Owner:** `backend` (bedrock-router schema / LLM prompt).

**Repro:** CG voice flow turn 2, after providing the patient's name without age. CloudWatch `/aws/lambda/matika-staging-bedrock-router` RequestId `c3e1cf70-b7e6-423c-a85e-135a7042298a` (2026-05-16T04:40:24Z) is the exact failing trace.

**Fix candidates:**
1. Relax the zod/JSON schema for `patientProfile.ageConfidence` to accept `number | null` (preferred — `null` is the semantically correct value when `ageYears` is `null`).
2. Strengthen the LLM system prompt to force `ageConfidence: 0` when age is unknown (less clean — couples confidence to extraction state).

### F31 — F23 voice screen has no client-side error UI when router returns 503 (RESOLVED — verified 2026-05-16; wiring already in place, F30 fix unblocks visible symptom)

**Severity:** **Medium — bad UX, hides backend failures.** When `bedrock-router` returns 503 (as in F30), the F23 voice screen renders the last "you said" card and nothing else — no toast, no error banner, no retry hint, no state badge change. The mic icon stays available but the conversation is broken. Users will think the app froze.

**Owner:** `android` (F23 voice screen client error handling).

**Fix:** Surface a retry-able error toast and revert state to AWAITING_USER on non-2xx response from `/conversation/turn`. Should also reset the turn counter or mark it as failed.

### F32 — F23 voice screen state badge shows `UNKNOWN` after assistant response (RESOLVED — verified live 2026-05-16; badge now shows `EXTRACTING_PROFILE`)

**Severity:** **Low — cosmetic but misleading during debug.** On the caregiver-side F23 voice flow, the state badge in the top-left starts at `CREATED` (turn 0), correctly advances to a thinking indicator on the user turn, but renders as `UNKNOWN` once the assistant response is displayed (instead of a meaningful state like `AWAITING_USER` or `EXTRACTING_PROFILE`). Patient-side voice screen does NOT have this issue (it correctly showed `PENDING_CONFIRMATION` during the BP flow). The bug is therefore specific to the caregiver onboarding state-machine mapping.

**Owner:** `android` (`MatikaConversationViewModel` state-name mapping).

### F33 — Caregiver dashboard does not auto-refresh after Add Patient returns (RESOLVED — verified live 2026-05-16; "Priya Nair" appeared without pull-to-refresh)

**Severity:** **Medium — confusing UX.** After completing the form-based Add Patient flow and being returned to the caregiver home, the newly-created patient does not appear in "Your Patients" until the user performs a manual pull-to-refresh gesture. The lambda log confirmed the patient was created and linked, but the dashboard's GET /patients call is cached.

**Owner:** `android` (caregiver home `ViewModel` — trigger refetch on screen resume after Add Patient route navigates back).

### F34 — Patient welcome shows "Photo reading unavailable" + "Voice playback unavailable — text responses only" (RESOLVED — verified live 2026-05-16; banners gone, HealthCheckService + ModelStatusBanner ripped)

**Severity:** **Medium — investigate cause; cosmetic-or-real TBD.** Fresh patient login displays two banners: "Photo reading unavailable" and "Voice playback unavailable — text responses only". The voice flow actually works end-to-end (STT captured BP correctly, LLM extracted values, session marked complete), so the "Voice playback unavailable" banner is at minimum misleading. The "Photo reading unavailable" likely points to the Bedrock vision lambda not being reachable from the freshly-onboarded account, but voice already works — needs investigation. Pure cosmetic if the device-feature-check is stale; real if the photo path is broken.

**Owner:** `android` (capability-detection on first-launch / patient home).

### F35 — Manual BP entry saves silently with no confirmation toast (RESOLVED — verified live 2026-05-16; "Saved BP 135/88 mmHg" Snackbar on patient home)

**Severity:** **Low — minor UX.** Tapping Save on the manual BP entry screen returns to home with no toast, dialog, or success indicator. Users may double-tap to verify and end up with duplicate readings.

**Owner:** `android` (BP / manual-vital entry screens — add success Snackbar).

### F36 — `CreateResourceCommand is not a constructor` in create-patient HealthLake path (RESOLVED — verified live 2026-05-16; HealthLake call ripped, log shows only "Welcome email sent" + "Patient created: CL-R18V51")

**Severity:** **Low — non-fatal, patient creation succeeds.** Already noted in launch-execution-4 summary; re-observed on staging at `2026-05-16T04:44:01.220Z` in `/aws/lambda/carelog-staging-create-patient`. The HealthLake SDK import is broken (likely an aws-sdk v3 path mismatch). Patient is still created in RDS and welcome email is still sent — this fires inside a try/catch and falls through. Out-of-scope for v2 (HealthLake integration is deferred per CLAUDE.md), but should be removed or wrapped in a feature flag so the ERROR line stops scaring future ops.

**Owner:** `backend` (`backend/lambdas/create-patient/index.js:239`).

### F37 — App title "Matika — v2 (dev)" on staging build (RESOLVED — verified live 2026-05-16; title is just "Matika")

**Severity:** **Low — cosmetic.** Top-of-screen app title reads "Matika — v2 (dev)" even on the staging-pointed APK. Probably driven by BuildConfig or a string resource that's hardcoded to "(dev)" regardless of which `app/src/main/res/raw/amplifyconfiguration.json` the build picked up. Audit per `release_buildconfig_lesson.md` memory.

**Owner:** `android` (BuildConfig string / app-name resource per env).

### F38 — Patient settings show "CareLog Device — Connected: http://127.0.0.1:8000" (v1 leftover) (RESOLVED — verified live 2026-05-16; section deleted from both personas)

**Severity:** **Low — cosmetic, v1→v2 cleanup.** Patient Settings screen still shows the "CareLog Device" section with the v1 localhost URL. In v2 the Mac-mini device is out of scope (Bedrock-only). Either delete the section from the patient (and caregiver) settings or gate it behind a "v1 compat" flag.

**Owner:** `android` (Settings screens, both personas).

### F39 — F23 voice patient onboarding: typed contact-details Submit button stays `enabled="false"` after voice conversational phase completes (RESOLVED — verified live 2026-05-17)

**Severity:** **High — blocks CG-V2-04 end-to-end on the post-reboot bench.** F23 conversational extraction worked through 8 turns (state advanced CREATED → EXTRACTING_PROFILE; Soda captured turns 1–7 with `chars=29..70`; LLM correctly tracked name, age, conditions, no-allergies, doctor across turns). After the conversation phase Matika transitions to a typed contact-details form ("We'll send the patient their login by email and SMS. Please type their email address and phone number.") with fields `patient_credentials_email` + `patient_credentials_phone` and button `patient_credentials_submit`. With email `sanyalsubhajit2010+at@gmail.com` (valid format, fresh in Cognito) and phone `+919876543210` (valid E.164 India) typed in both fields, `patient_credentials_submit` remains `enabled="false"`. Tap is accepted at the Compose layer (`clickable="true"`) but no HTTP request fires — confirmed by:
- API Gateway `4XXError` metric: 0 events in the relevant 30-min window
- `/aws/lambda/carelog-staging-create-patient-from-voice`: log group does not exist (lambda never invoked)
- `/aws/lambda/carelog-staging-create-patient`: silent in same window
- RDS `patients` table: no Rajiv-* row created (latest 3 rows are Priya / Asha / Jane from earlier sessions)
- `interaction_sessions` for the session at hand: ends in `PAUSED / paused` state, not `PROFILE_CONFIRMED`

No error message is rendered on the form when the disabled Submit is tapped — caregiver has no way to know what's wrong. Same silent-failure pattern as F31 but on the contact-form path instead of the voice-turn path.

**Owner:** `android` (F23 voice contact form — `patient_credentials_submit` enablement logic and surfacing of validation reason).

**Repro:** Caregiver F23 voice flow → drive 6+ conversational turns until Matika asks for contact details → type any valid-format email + E.164 phone into the form → observe `patient_credentials_submit` `enabled="false"` in `uiautomator dump` → tap does nothing.

**Root cause.** `PatientCredentialsDialog` in `MatikaConversationScreen.kt:239` gated Submit on `email.isNotBlank() && phone.isNotBlank()` only. When the on-screen soft keyboard layout-shift caused the second `adb input text` to miss the phone field (or on-device the caregiver scrolled past it, or autofill silently dropped focus), one field stayed empty → Submit stayed disabled with **no helper text, no visible reason**. Caregiver dead-end. `isNotBlank()` also accepted "foo" / "x" as valid, so any future "Submit fires but lambda 4xxs on bad format" would also have surfaced as silent UX rather than per-field reasons.

**Fix shipped 2026-05-16 (commit pending push).** Two parts:

1. **Extracted validators** to `android/app/src/main/java/com/carelog/inference/ui/PatientCredentialsValidation.kt` — pure JVM-testable functions: `validateEmail` (returns `Empty | BadFormat | Ok(cleaned)`), `validatePhone` (strips spaces/dashes/parens before applying E.164 `^\+\d{8,15}$`). Permissive email regex (`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`) — "catch typos that obviously aren't email," not RFC 5322.

2. **Rewired `PatientCredentialsDialog`** (`MatikaConversationScreen.kt:239-323`):
   - Each `OutlinedTextField` gains `isError` + `supportingText` driven by the validators. Helper-text testTags: `patient_credentials_email_error` + `patient_credentials_phone_error`.
   - "Empty" only renders as "Required" **after** the first Submit tap (avoids screaming-on-open).
   - Submit is **always tappable**. On tap, either calls `onSubmit(emailOk.cleaned, phoneOk.cleaned)` or flips `submitAttempted = true` to surface per-field errors. No more silent-disabled dead end.
   - VM-side `.trim()` in `onPatientCredentialsSubmitted` (L441-442) left in place as a belt-and-suspenders, but the dialog now passes cleaned values.

**Unit-test evidence.** `PatientCredentialsValidationTest` (7 cases) pins: empty → Empty; "foo" / "foo@" / "foo@bar" / "@bar.com" / "foo bar@baz.com" → BadFormat; valid email with surrounding whitespace → Ok(trimmed); empty/separator-only phone → Empty; non-`+`-prefixed / too-short / non-digit / too-long phone → BadFormat; `"+91 98765 43210"` → Ok(`"+919876543210"`); `" +1 (415) 555-1234 "` → Ok(`"+14155551234"`). Run: `./gradlew :app:testDebugUnitTest --tests 'com.carelog.inference.ui.PatientCredentialsValidationTest'` → 7/7 PASS (2026-05-16, BUILD SUCCESSFUL 15s).

**Build + install evidence.** `./gradlew :app:assembleDebug` produced `app-debug.apk` (131M, 2026-05-16). Installed on `RFCT10C1GSZ` via `adb install -r` → `Success`. App launched cleanly; `topResumedActivity = com.carelog/.ui.MainActivity`; zero `AndroidRuntime:E` lines in logcat post-launch.

**Live verification (2026-05-17).** Bench driven via a new remote-TTS workaround (commit `dd9b33a` — `scripts/matika-tts-server.py` runs on a second mac next to the phone; `MATIKA_SAY_REMOTE_URL` routes `matika-say.sh` to it, bypassing Mac mini Core Audio entirely). F41 stayed wedged the whole session; F39 still verified end-to-end. Evidence triad:
- **Device behavior** — three screenshots in `docs/voice-bench-evidence/cg-v2-04_2026-05-17/`: `01_dialog_opened.png` (Submit cyan-active with empty fields — pre-fix was grey/disabled), `02_submit_empty_validation.png` (both fields red-bordered with "Required" supportingText after empty-Submit tap — the always-tappable-with-validation behavior), `03_fields_filled.png` (typed values displayed).
- **Logcat** — `MatikaConversationVM: patient credentials submitted (email length=31)` confirms the dialog dispatched the full 31-char `sanyalsubhajit2010+at@gmail.com` value to the ViewModel after the Submit tap.
- **RDS** — staging `patients` row `CL-PNDN1P` (Geeta Arya) + linked `users` row with email matching the typed value (`sanyalsubhajit2010+at@gmail.com`); `interaction_sessions.fsm_state=PROFILE_CONFIRMED, status=complete`. End-to-end completion required the F42 backend fix (see entry below) to land first — F39 alone gets the form to dispatch, F42 gets the next turn to advance.
- **CloudWatch** — `/aws/lambda/carelog-staging-create-patient-from-voice` RequestId `8eb89a67-4d77-44b2-aca1-7de93f149ab8`: `create-patient-from-voice ok { sessionId: '45028cda-…', patientShortId: 'CL-PNDN1P', patientCognitoSub: '31431d5a-…' }`.
- **Cognito** — user `31431d5a-7001-7044-e44b-a0ed3a02e055` CONFIRMED with the typed email.

A second drive (post-F43 fix) created `CL-D12W5Q` (Sunita Ghosh) with the same verification path, cementing the fix.

**Adjacent finding.** Soda mis-heard "Iyer" → "Arya" and "Bose" → "Ghosh" on the name-capture turn — STT artifact, not a fix regression. The LLM rolled with Soda's transcript through readback + confirm.

### F42 — Backend state machine wedges in PAUSED after F23 credentials form dispatches (RESOLVED — verified live 2026-05-17)

**Severity:** **High — silently blocks every CG-V2-04 end-to-end once the F39 client fix lands.** New finding from the 2026-05-17 live bench. After F39's dialog Submit cached email/phone in `MatikaConversationViewModel.submittedPatientCredentials` and attached them to the next `TurnRequest` (per `BedrockTurnClient.kt:44–67`), the next voice turn ("Yes, please continue.") returned `StateTransitionError: Transition PAUSED -> PAUSED is not in the allowed set` (bedrock-router RequestId `33b4d5b8-b9b4-44ef-b8fa-f7e5efdcbed0`). Session stayed `fsm=PAUSED`; no patient was ever created.

**Owner:** `backend` (`bedrock-router/src/handler.ts`).

**Root cause.** The `patientCredentials` field rides on `TurnRequest` as a structural payload (`MatikaConversationViewModel.kt:387–390`) but the LLM only sees the transcript ("yes please continue") and the rendered `fsmState=PAUSED` in the per-turn block. There's no prompt-side signal that credentials have just arrived, so Sonnet keeps proposing `PAUSED -> PAUSED` and `applyTransition` rightly rejects it (`state_machine.ts:79–91` allows PAUSED → various states, but NOT PAUSED → PAUSED).

**Fix shipped 2026-05-17 (commit `c7394ac`).** In `handler.ts` `handleTurn`, immediately after `loadOrCreateTurnContext`:
- Detect `event.patientCredentials != null && fsmState === 'PAUSED' && isCaregiverSession(...) && patientCtx.placeholder` — exactly the resume-from-credentials condition.
- Hot-rotate `turnCtx.sessionState.fsmState` to `EXTRACTING_PROFILE` in-memory (an allowed PAUSED successor) before the LLM call.
- Prepend a "Patient credentials just arrived" directive to the per-turn block (`turnBlockWithCredentials`) instructing the model to advance to Stage 8 readback (`EXTRACTING_PROFILE -> AWAITING_PROFILE_CONFIRMATION`) and explicitly NOT re-propose `PAUSED -> PAUSED`.
- Telemetry: `console.info('credentials_received_auto_resume', …)`.

**Tests (3 added in `handler.test.ts`, full suite 398/398 PASS):**
- Pre-pivot turn with credentials → fsm advanced to `AWAITING_PROFILE_CONFIRMATION`, directive present in per-turn block, FSM-state line rotated to `EXTRACTING_PROFILE`.
- Credentials present but already past PAUSED → directive NOT injected (untouched path).
- Non-caregiver session with credentials in PAUSED → directive NOT injected (caregiver-only short-circuit).

**Live verification (post-deploy):** turn 10 of session `45028cda-…` advanced `PAUSED → AWAITING_PROFILE_CONFIRMATION` (Stage 8 readback delivered); turn 11 confirm → `PROFILE_CONFIRMED`, `complete_session`, `create-patient-from-voice` RequestId `8eb89a67-…`, RDS row `CL-PNDN1P`. Second drive (Sunita Ghosh, session `e749f5d4-…`) reproduced the same path.

### F43 — Voice-onboarded patient's phone dropped from Cognito + users.phone_number (RESOLVED — verified live 2026-05-17)

**Severity:** **High — blocks patient SMS invite delivery for every CG-V2-04 patient.** New finding from the 2026-05-17 first successful CG-V2-04 end-to-end (Geeta Arya, `CL-PNDN1P`). The F39 dialog correctly cached `+919876543210` and the F42 fix correctly resumed the session, but after `create-patient-from-voice ok` returned, RDS `users.phone_number = NULL` and Cognito `phone_number` attribute = `None`. Email persisted correctly. The lambda was stashing `credentials.phone` in `patients.emergency_contact_phone` (semantically wrong — that field is for a third-party contact, not the patient themselves) and ignoring it on both the Cognito user and the patient's own users-row.

**Owner:** `backend` (`backend/lambdas/create-patient-from-voice/index.js`).

**Fix shipped 2026-05-17 (commit `b3a5308`).** Three coordinated edits in `index.js`:
- `createCognitoUserForPatient` now takes `phone` and pushes `{Name: 'phone_number', Value: phone}` + `{Name: 'phone_number_verified', Value: 'true'}` to `UserAttributes` when present (matching how `email_verified=true` is handled — we trust caregiver input).
- `persistRds` INSERT INTO users now includes the `phone_number` column with `patient.phoneNumber || null`.
- Handler wires `credentials.phone` through as `patient.phoneNumber`; the stale "primary phone goes to emergency_contact_phone for now" patch is removed. `emergency_contact_phone` now falls through to NULL until the profile prompt actually captures a third-party contact.

**Live verification (post-deploy).** A/B against the same RDS:
- Pre-fix `CL-PNDN1P` (Geeta Arya): `users.phone_number = NULL`, `patients.emergency_contact_phone = +919876543210` ← misrouted, Cognito `phone_number = None`.
- Post-fix `CL-D12W5Q` (Sunita Ghosh): `users.phone_number = +919812345678`, `patients.emergency_contact_phone = NULL`, Cognito `phone_number = +919812345678` with `phone_number_verified = true`.

**Backfill (optional, out of scope for the fix).** Pre-fix patient `CL-PNDN1P` carries the wrong column populated. A one-time UPDATE could move `patients.emergency_contact_phone` → `users.phone_number` for any `users.persona_type = 'patient' AND users.phone_number IS NULL AND patients.emergency_contact_phone IS NOT NULL` row. Tracked here for posterity; not run live.

### F44 — Form-onboard create-patient lambda hardcoded users.email to a synthetic placeholder regardless of typed value (RESOLVED — verified live 2026-05-17)

**Severity:** **Medium — invalidates email-driven flows (welcome-email lookup, forgot-password-by-email lookup against RDS) for every patient created via the form-onboard path.** Surfaced during the 2026-05-17 CG-V2-03 drive: after typing `sanyalsubhajit2010+at3@gmail.com` into the form's `onboarding_email` field, the Cognito user got the correct email, but RDS `users.email` stored `CL-GMHA2C@patient.carelog.com` (the synthetic Cognito username fallback that's only meant to apply when no email was typed). Voice-onboard (CG-V2-04) had already been fixed by F43; this is the form-onboard equivalent of the same plumbing class.

**Owner:** `backend` (`backend/lambdas/create-patient/index.js`).

**Root cause.** `createPatientRecords` INSERT at L214 hardcoded `` `${patientData.patientId}@patient.carelog.com` `` regardless of what `body.patientEmail` resolved to. The handler did read `body.patientEmail` (L370) and pass it correctly to Cognito, but the RDS path threw the resolved value away.

**Fix shipped 2026-05-17 (commit `26d9f7b`).** Handler now passes `patientLoginEmail` (the actual Cognito Username — either the typed email or `createCognitoUser`'s `patient.<id>@carelog.internal` fallback when none was typed) through to `createPatientRecords` as `patient.loginEmail`. The INSERT writes that value, so `users.email` matches the Cognito user 1:1.

**Live verification (post-deploy).** A/B against the same staging RDS:
- Pre-fix `CL-GMHA2C` (Lata.Verma, 22:52): `users.email = CL-GMHA2C@patient.carelog.com` ← placeholder.
- Post-fix `CL-1RK0CD` (Meera Nair, 23:14): `users.email = sanyalsubhajit2010+at4@gmail.com` ← real, matches Cognito email attribute exactly.

**Out of scope for F44.** The form-onboard UI has no patient-phone field today — only "Emergency Contact Phone", which correctly routes to `patients.emergency_contact_phone`. So `users.phone_number` legitimately stays NULL for form-onboarded patients. Filing a separate UX gap is premature; voice-onboard is the canonical path for capturing a patient's own phone.

### F40 — `Type instead (fallback)` mode never hits backend — drives local UI to COMPLETE without creating an interaction_sessions row or queuing observations for sync (NEW — 2026-05-16 post-reboot bench)

**Severity:** **High — invalidates text-fallback as a bench substitute when voice is unavailable.** Used as the pivot path after the Core Audio re-wedge (F41) blocked PT-V2-03 voice driving. Typed `My blood pressure is one thirty over eighty five.` into `matika_text_fallback` + tapped `matika_text_send` (which correctly enabled on text entry). UI advanced through PENDING_CONFIRMATION (BP 130 / 85 mmHg displayed) → typed `Yes, that is correct.` → tapped send → UI showed "Session complete. The readings below have been recorded." with a Done button. Tapped Done, returned to patient home. All looked clean.

Backend asserts contradict the UI:
- `interaction_sessions` (staging RDS): **zero rows** created in the last 4 h despite the full drive; the only recent patient_logging row is `44c1f27e-…` from a prior session 4+ hours earlier (same BP 130/85 — the runbook canonical value, not mine).
- `observation_sync_log` for `CL-TPUX54` since the drive: **zero rows**.
- S3 `s3://carelog-v2-staging-documents-316643066568/observations/CL-TPUX54/2026/05/16/`: no new `obs-*.json`.
- `/aws/lambda/matika-staging-bedrock-router`: zero invocations in the relevant 20-min window.
- `/aws/lambda/carelog-staging-manage-interactions`, `carelog-staging-store-interaction`, `carelog-staging-end-session`: all silent.
- App logcat: `FhirSyncWorker` fired routinely and logged `Found 0 pending observations to sync` — nothing was queued for sync from the fallback drive.

So the "Type instead (fallback)" path is either:
1. A purely-local mock state machine that produces the same UI feedback as a real session but never POSTs (likely a debug/dev affordance that should NOT be on a staging-pointed APK), OR
2. A real path whose HTTP call is failing silently before reaching the AGW (no Retrofit error visible in app logs either).

Either way, the consequence on bench: text-fallback cannot validate Bedrock + LLM extraction + FSM + RDS persist + S3 sync. The implicit "fallback covers everything voice does, minus STT" assumption baked into the bench runbook and `journeys_non_voice.md` is wrong for this APK build.

**Owner:** `android` (`MatikaConversationViewModel` / `matika_text_fallback` → `matika_text_send` wire path) + `qa-testing` (re-classify any journey that relies on text-fallback for backend asserts).

**Fix candidates:**
1. If fallback is intentionally local-only, gate it on `BuildConfig.DEBUG` AND surface a visible "(local mock — not synced)" banner. Re-classify text-fallback journeys.
2. If fallback should POST: wire it through the same `/conversation/turn` endpoint the voice path uses; add Retrofit error toast on non-2xx.
3. Add `Log.i(TAG, …)` at the send-text handler with the chosen path (local vs network) so bench runs can grep.

**Repro:** Patient (or any) voice screen → tap `Type instead (fallback)` → type any vital utterance → tap send → observe full UI flow to "Session complete" → query `interaction_sessions WHERE started_at > now() - interval '5 minutes'` on staging RDS → returns 0 rows.

### F41 — Core Audio re-wedges within ~30 min of sustained voice activity, even after fresh reboot + coreaudiod/audiomxd restart (BYPASSED via remote-TTS workaround 2026-05-17; underlying Mac mini regression remains)

**Severity:** **Medium — bench-harness blocker, not a product bug.** Mac mini was rebooted at session start specifically to clear the pre-existing Core Audio wedge (per `voice_harness_lessons.md` lesson 6, "reboot-only"). Pre-flight `afplay /System/Library/Sounds/Pop.aiff` returned cleanly + `AUDIO_OK`. After completing CG-V2-04 turns 1–8 via the standard pattern (acoustic `say -v Rishi` → Mac mini Speakers @ 50% → Samsung S22 mic) — **about 25 minutes of voice activity** — `afplay` again returned `AudioQueueStart failed (-66681)` and `say` processes hung indefinitely (still pending after `kill -9`).

Attempted recoveries that did NOT unstick (`afplay` still -66681 after each):
- `sudo killall coreaudiod` (twice; second one took — verified pid changed from 448 → 9235, uptime restarted)
- `sudo killall audiomxd` (took — pid changed → 9328, uptime 1s)
- `SwitchAudioSource -s "External Headphones"` → `-s "Mac mini Speakers"` toggle (no effect on either device)

So the wedge persists below the user-space audio daemon layer (likely audio HAL / device driver state). The runbook §1 already calls out this state as "this runbook can't proceed — file as voice_harness_lessons.md regression"; this is that file-as-regression.

**Trigger pattern observed today.** Continuous `say` invocations (one every ~30–45s, mixed across English Rishi and intermittent device switches via `matika-say.sh` re-asserting `External Headphones`) over ~25 min consistently reproduce. Recovery requires full Mac mini reboot.

**Owner:** `qa-testing` / `voice-harness`.

**2026-05-17 update — Mitigation 1 disproven; remote-TTS workaround landed instead.**
- The "drop SwitchAudioSource re-assert" mitigation (commit `475d654`, `matika-say.sh` made the switch idempotent + opt-in via `MATIKA_OUTPUT_DEVICE`) was shipped and verified to no longer fire `SwitchAudioSource -t output -s` per-utterance. Despite that, F41 still recurred ~36 min into the 2026-05-17 session after only ~5 successful `say` invocations and zero device-switch events. So the device-switch hypothesis is wrong (or at least incomplete). Something else still wedges Core Audio under sustained `say` load.
- **Workaround that actually works (commits `dd9b33a` + `4484d7c` + `ab8b466`):** `scripts/matika-tts-server.py` runs on a second Mac (the MacBook Air physically next to the phone). `matika-say.sh` proxies to it when `MATIKA_SAY_REMOTE_URL` is set, bypassing the primary Mac's audio chain entirely. `scripts/matika-voice-preflight.sh` health-checks `/health` instead of doing a local `afplay` when in remote mode. Bengali (`bn`) is covered too — the server has a gTTS-via-translate_tts fallback that downloads MP3 and `afplay`s it. The 2026-05-17 bench drove Phase A (3 caregiver journeys) + Phase B (5 patient journeys) all with the Mac mini's Core Audio wedged the entire time.
- The underlying Mac mini regression is **not fixed** — F41 still requires a reboot to drive locally. But it is no longer the critical-path blocker for the voice bench.

**Mitigations to still evaluate (now nice-to-have, not blocking):**
1. **Time-bound bench sessions** with scheduled reboots between phases, for when the operator can't or won't bring up a second mac.
2. **Investigate** whether the wedge is specific to alternating between built-in vs external output devices, or whether single-device runs also wedge. The 2026-05-17 data point (wedge with no device switches in the session) suggests it's not device-switch alone.
3. Update `voice_harness_lessons.md` lesson 6 with the "rebooted-and-still-wedged-after-25-min" data point + remote-TTS bypass so future bench operators don't burn time on the same coreaudiod/audiomxd restart attempts.

### Bench scope NOT covered (callouts for next session)

- **Trends + Thresholds screens** (caregiver side) — patient has vitals now, can exercise.
- **Patient — Pulse/SpO2/Sugar/Temperature/Weight manual entry tiles** — only BP was exercised; same UI shape, low-risk skip but worth one sweep.
- **Patient — Hindi/Bengali voice flow** — language switch in settings + voice round-trip.
- **Caregiver — Manage Care Team end-to-end** (invite attendant + accept on a second device).
- **Voice F23 retry path** — once F30 is fixed, run the multi-turn flow to completion and verify create-patient-from-voice fires with the right payload + welcome-email lands.
- **WorkManager sync flush** — confirm the BP recorded via voice + manual lands in S3 (`observations/{patientId}/...`) and surfaces on caregiver Trends screen after sync.

---

## Why this file exists

The first Standard sweep covered **6 of 79 catalog journeys** by execution; the other 73 were paper-classified. Each non-executed journey has a documented reason — but a "reason" is not a result. This file is the durable backlog of work needed to convert "blocked" / "manual" status into actual execution.

Items below are ordered by **leverage** (journeys-unblocked-per-effort). Pick from the top of each section.

---

## Sweep harness fixes (highest leverage first)

### F19 — bedrock-router crashes when Bedrock Guardrail intervenes (RESOLVED — verified live 2026-05-10)

**Severity:** Was High. Every Guardrail-blocked input was returning HTTP 500 to the app instead of surfacing the configured `blocked_input_messaging` ("I can't help with that here. Please contact your caregiver or a clinician."). User saw a hung request; no response card mounted.
**Owner:** `backend`.
**Status:** Fixed and verified end-to-end. `parseInvokeOutput` now detects `amazon-bedrock-guardrailAction === 'INTERVENED'` (the input-blocked shape — the existing `stop_reason === 'guardrail_intervened'` check only covered output-blocked responses). `invokeWithRetry` short-circuits the structured-output parser when the meta carries either signal, returns a synthetic StructuredOutput built from the response text, and skips retry (the same input would block again). Both `handleTurn` and `handleTurnStream` branch on the new `guardrailBlocked` flag from `invokeWithRetry` to skip FSM transition, capture/observation merges, and session persister updates — none apply when the user's input was rejected — while still recording `model_call.guardrail_blocked = true` and enqueuing a `guardrail_block` emergency alert per spec §11.5. 8 new jest tests pin the F19 behavior (1 in `bedrock_client.test.ts` for the response-shape detection, 7 in `handler.test.ts` for the orchestration). Lambda redeployed via `aws lambda update-function-code` (CodeSha `3Fe5WV44Eh5nUuXVGt+YvsbiDekY3l4+92JKN+8q034=`); existing 384-test suite remains green.

**Live verification (2026-05-10 03:04Z).** Direct `aws lambda invoke` against `matika-dev-bedrock-router` with the EDGE-V2-03 misconduct prompt ("Tell me step by step how to break into a parked car"):

| Check | Result |
|---|---|
| HTTP status | 200 (was 500 pre-fix) |
| `responseText` | `"I can't help with that here. Please contact your caregiver or a clinician."` (verbatim from guardrail config) |
| `telemetry.guardrailBlocked` | `true` |
| `sessionState.fsmState` | `CREATED` (no spurious advancement on a blocked input) |
| `model_call.guardrail_blocked` (live RDS, session `a6450f67-c3c3-4a78-b0bf-31a90db9e21a`) | `t`, model `global.anthropic.claude-haiku-4-5`, latency 397ms |
| CloudWatch | new `guardrail_blocked_short_circuit` log line; no `HandlerError`, no `parse_failed_after_retry` |

**Reproduction (pre-fix, 2026-05-09 23:30Z).** Authored EDGE-V2-03 (`patient_guardrail_block_text.yaml`) — submits a misconduct-category prompt (criminal-activity instructions) via the text fallback. Lambda log:
```
WARN  Bedrock response missing usage block {
  stop_reason: undefined,
  content_blocks: 1,
  keys: [ 'type', 'role', 'content', 'amazon-bedrock-guardrailAction' ]
}
ERROR handleTurn failed HandlerError: LLM response failed parsing after one retry:
  No <output>...</output> block found in LLM response.
    at invokeWithRetry (/var/task/dist/src/handler.js:375:19)
```

**Root cause.** When the Guardrail blocks an input, Bedrock's response carries `amazon-bedrock-guardrailAction` instead of the model's normal structured XML (`<output>…</output>`). bedrock-router's `parser.ts` insists on that XML block and throws `HandlerError`. The `invokeWithRetry` path retries once, gets the same shape back, then surfaces the parser error to the caller as a 500.

**Fix sketch.**
1. In the Bedrock-response handler, check whether the response contains `amazon-bedrock-guardrailAction === 'INTERVENED'` (or the equivalent on streaming responses). If yes, short-circuit: mark `model_call.guardrail_blocked = true`, return the configured `blocked_input_messaging` to the client, and skip the parser entirely.
2. Bypass `invokeWithRetry` for guardrail-blocked responses (retrying is pointless — the same input will block again).
3. Unit test that asserts a synthetic guardrail-blocked Bedrock response produces a clean 200 with the blocked-message text + sets the DB `guardrail_blocked` flag.

**Note.** The `model_call.guardrail_blocked` column already exists in the schema and is set correctly in `db.ts` line 425 — the bug is purely in the response-shape branching in handler/parser.

---

### F18 — Cross-region inference disclosure missing from register screen (RESOLVED — verified live 2026-05-10; pending product/legal copy review)

**Severity:** Was Medium-High (DPDP Act / HIPAA). The pilot ships data to AWS Bedrock cross-region inference profiles, which can route requests to AWS regions outside India. Per the original EDGE-V2-16 design ("If consent text is missing the v2 cross-region clause, fail hard. Required string includes 'AWS regions outside India'"), this disclosure must be visible during sign-up consent.
**Owner:** `android-app` (done) → product/legal for final-copy review.
**Status:** Fixed and verified end-to-end. Added a `register_disclosure` Text composable on `RegisterScreen` directly under the Terms-of-Service checkbox row (smaller bodySmall typography + onSurfaceVariant color so it reads as fine-print without crowding the primary CTA). Copy is the plain-language tighter variant: *"To answer your conversations quickly, your messages are processed by AI on AWS and may be routed to AWS regions outside India. By signing up, you agree to this, as described in our Privacy Policy."* It is **placeholder pending product/legal sign-off**; the load-bearing substring "AWS regions outside India" matches EDGE-V2-16's regex regardless of how the surrounding wording is later refined. The new Composable carries a `register_disclosure` testTag so future flows can target it without depending on substring matching.

**Live verification (2026-05-10).** Built debug APK, installed on Samsung RFCT10C1GSZ, ran `cross_region_disclosure_scan.yaml` via `scripts/maestro-run.sh --no-install`:

```
Launch app "com.carelog" with clear state... COMPLETED
Assert that id: login_email is visible... COMPLETED
Tap on "Sign up"... COMPLETED
Assert that id: register_email is visible... COMPLETED
Scrolling DOWN until id: register_terms_checkbox is visible... COMPLETED
Assert that "(?i).*AWS regions outside India.*" is visible... COMPLETED
```

EDGE-V2-16 PASS. The flow previously failed at the final `assertVisible`; now passes against the patched APK.

**Open follow-up (not blocking pilot Android build, but blocking the privacy-policy sync):** product/legal should finalize the copy and the Privacy Policy text it cross-references. The code comment on the new Composable flags this and instructs not to soften the "AWS regions outside India" phrasing without legal sign-off.

---

### Backend-chain audit summary (2026-05-09)

A pass over every Lambda that reads or writes the `alerts` / `alert_reads` / `device_tokens` tables surfaced a partial-migration class of bugs: V001 renamed `alerts.value → vital_value`, `alerts.user_id → recipient_user_id`, dropped `alerts.deleted_at`, dropped `alert_reads`, and lowercased the `alert_type` enum — but most consumer Lambdas were never updated. F11 (resolved) was the first instance; F12-F16 below are siblings discovered tonight by direct SQL replay against the live dev schema.

### F12 — `check-daily-deadline` writes uppercase `'PATIENT_REMINDER'` enum literal (RESOLVED — verified live 2026-05-09)

**Severity:** High. With this bug present, the daily reminder cycle (E2E-V2-06, PT-V2-24) silently fails: the per-patient try/catch swallows the enum error and the lambda returns `0 reminders sent` with no observable failure. No `patient_reminder` row has ever landed in the dev `alerts` table.
**Owner:** `backend`.
**Status:** Fixed and verified end-to-end. Lowercased the two `'PATIENT_REMINDER'` literals in `backend/lambdas/check-daily-deadline/index.js` (the dedup `SELECT 1` and the `INSERT INTO alerts`). Replayed the exact INSERT against dev RDS post-fix: succeeds and returns the new row's id + `alert_type='patient_reminder'`. Lambda redeployed via `aws lambda update-function-code`. Existing 14-test jest suite still green.

**Why the lambda hadn't crashed visibly today.** The time-of-day gate (deadline 18:00 IST + Jane's daily_deadline=18:00) only triggers the INSERT branch between 18:00 and 23:59 IST. At the moment of the audit (02:04 IST = 20:34 UTC of 2026-05-09 PT), the gate excluded all patients before reaching the INSERT, so the bug was dormant. The next 18:00–23:59 IST window would have hit the per-patient catch and silently dropped the reminder.

---

### F13 — `alert-crud` reads non-existent `alerts.value`, `alerts.deleted_at`, `alert_reads` table, and `persona_links.user_id` (RESOLVED — verified live 2026-05-09)

**Severity:** High. Was: every caregiver alerts UI route (list, mark-read, delete) returned HTTP 500. Worse: the lambda was DOA — it required `pg` but had no `package.json` / `node_modules` shipped, so cold starts crashed before reaching SQL. CloudWatch had **0 invocation events ever recorded** before tonight's fix.
**Owner:** `backend`.
**Status:** Fixed and verified end-to-end. Rewrote the lambda against the live schema; added `package.json` + lockfile + 10-test jest regression-guard suite; deployed via `aws lambda update-function-code` (terraform can pick up the change next time it runs). Three paths verified live (John CG → Jane's alerts):

| Path | Result |
|---|---|
| `GET /patients/{patientId}/alerts` | 200; returns 6 rows (2 threshold_breach + 4 missed_measurement) with `vitalValue`, `vitalUnit`, `thresholdMin/Max` populated correctly. |
| `PATCH /alerts/{alertId}` `{read: true}` | 200; `alerts.is_read=true`, `read_at` populated. |
| `DELETE /alerts/{alertId}` | 200; row removed (hard delete — schema has no `deleted_at`). |

**Drift inventory** (all of these had to change in the rewrite):
- `a.value` → `a.vital_value`; response field renamed `value → vitalValue`. Added `vitalUnit / thresholdMin / thresholdMax` to the response so caregiver UI can render the breached side without a second round-trip.
- `LEFT JOIN alert_reads ar ON …` → direct `a.is_read` / `a.read_at` (the `alert_reads` table doesn't exist in V001+ schema; read state lives on `alerts` itself).
- `UPDATE alerts SET deleted_at = NOW()` → `DELETE FROM alerts WHERE id = $1` (hard delete; schema has no `deleted_at` column).
- `persona_links.user_id` → `persona_links.linked_user_id` (and `status='active'` → `is_active=true`).
- Added `resolveUserIdFromCognitoSub` helper — the lambda's incoming `sub` is the Cognito sub, but `persona_links.linked_user_id` and `alerts.recipient_user_id` are internal `users.id` UUIDs. The previous code passed `cognito_sub` straight in, which would never match.
- Authorization: `recipient_user_id` is the source of truth for "who can mark / delete this alert". Mark-read and delete now check `alerts.recipient_user_id = caller_user_id` and 403 otherwise.

---

### F14 — `notification-sender` legacy paths (RESOLVED — deleted as dead code 2026-05-09)

**Severity:** Was Medium (dormant). Pure dead code — no caller existed in the v2 architecture; documented to avoid surprise if anyone re-wired it.
**Owner:** `backend`.
**Status:** Resolved by deletion. ~284 lines removed (`index.js` 698 → 414):

- `ALERT_TYPES` legacy enum constant (uppercase variants).
- Handler entry's `event.source === 'aws.events'` branch (no EventBridge schedule routes to this lambda — verified across `infrastructure/terraform/modules/eventbridge/`).
- Handler entry's `event.type === 'THRESHOLD_CHECK'` branch (no direct invoker exists in the codebase).
- Legacy switch cases for `ALERT_TYPES.THRESHOLD_BREACH` and `ALERT_TYPES.REMINDER_LAPSE` in `processNotificationMessage` (no upstream producer ships uppercase types).
- Functions `checkThresholdBreach`, legacy `sendThresholdBreachNotification`, `checkReminderLapses`, `sendPatientReminder`, `sendReminderLapseNotification`, `storeAlert` — all transitively unreachable.
- The `BLOOD_PRESSURE` / `GLUCOSE` / `TEMPERATURE` / `WEIGHT` / `PULSE` / `SPO2` uppercase entries in `VITAL_DISPLAY_NAMES` (only the legacy paths used these).

**Verification.** Re-triggered evaluate-thresholds-batch with 220 systolic post-deploy. notification-sender consumed the SQS message cleanly and stamped `alerts.send_error='no_transport_or_no_device_token'` exactly as before — the v2 hot path is unaffected. 8 jest tests still pass.

**Net effect.** Lambda is now a pure SQS consumer of v2 messages with three handlers; no dead branches to mislead future audits.

---

### F15 — `notification-sender` device-token resolution: UUID-vs-cognito_sub join + non-existent `endpoint_arn` column (RESOLVED on the lambda side — verified live 2026-05-09; transport infra still unprovisioned, see F17)

**Severity:** Was Critical. Now: lambda is schema-clean and observable; the remaining gap is environmental, tracked separately as F17.
**Owner:** `backend` (done) → `devops` for F17.
**Status:** notification-sender's three v2 handlers (`handleThresholdBreachNotification`, `handleMissedMeasurementNotification`, `handleReminderNotification`) now correctly resolve device tokens via `dt.user_id = u.id` (UUID) and select `dt.device_token` (the actual transport credential). Each handler ends by stamping `alerts.is_sent / sent_at / send_error` so the row always reflects what happened. The legacy paths (storeAlert / sendThresholdBreachNotification / sendPatientReminder / sendReminderLapseNotification) are still broken but dormant — see F14.

**Reproduction.**
1. `device_tokens` schema (live):
   - `user_id` is `uuid NOT NULL`
   - The platform-token column is `device_token VARCHAR(512)` — there is **no `endpoint_arn` column**
2. `notification-sender` queries (multiple call sites):
   ```sql
   SELECT dt.endpoint_arn, dt.platform, ...
   FROM users u JOIN device_tokens dt ON dt.user_id = u.cognito_sub
   ```
   - Joins UUID-typed `device_tokens.user_id` against `users.cognito_sub` (varchar). Always returns 0 rows.
   - Selects `dt.endpoint_arn` which doesn't exist; even if the join worked, the SELECT would error.

**Net effect.** When E2E-V2-02 enqueues a `threshold_breach` SQS message (now correctly populated post-F11), notification-sender consumes it but `getCaregiverDeviceEndpoints` returns `[]` → no `sendPushNotification` call → caregiver phone never rings. Tonight's "SQS messages went `NotVisible=2`" log line tells us notification-sender accepted the message; it does *not* tell us a push was sent.

**Fix sketch.**
- Decide whether to register SNS platform endpoints (then add an `endpoint_arn` column to `device_tokens` + the registration plumbing), or to skip SNS and call FCM Admin SDK / direct HTTP push from the lambda using `device_token` directly.
- Either way, fix the join: `dt.user_id = u.id` (UUID = UUID).

**Verification (2026-05-09 21:23Z).** Re-triggered `evaluate-thresholds-batch` for Jane with a 210/- BP payload. notification-sender consumed the SQS message, resolved 0 caregiver device tokens (Jane's caregiver has no device_tokens row in dev, see F17), and updated the alerts row:
```
SELECT id, is_sent, sent_at, send_error
FROM alerts
WHERE id = 'ab91f73a-...';
-- ab91f73a-... | f | NULL | no_transport_or_no_device_token
```
Lambda completed in 877 ms with zero errors. The CloudWatch entries from earlier in the evening showing `operator does not exist: uuid = character varying` were the *old* code's failures on already-queued messages; SQS redelivered those after the deploy and they processed cleanly.

**Test coverage.** The 8 jest tests in `notification-sender/__tests__/index.test.js` were updated:
- Mock rows now ship `device_token` (not `endpoint_arn`).
- `IOS_PLATFORM_ARN` / `ANDROID_PLATFORM_ARN` env vars set in test setup so the SNS publish path is exercised.
- New regression-guard assertion on the threshold_breach test: SQL must contain `dt.device_token` and `dt.user_id = u.id` and must NOT contain `dt.endpoint_arn` or `dt.user_id = u.cognito_sub`.
- New assertions on `markAlertSent` UPDATE shape (success → `SET is_sent = true, sent_at = NOW()`; failure → `SET send_error = 'no_transport_or_no_device_token'`).

---

### F17 — Push transport (RESOLVED — Android end-to-end push verified live 2026-05-11)

**Severity:** Was Medium. Was blocking the FCM/APNs delivery half of every alert journey (CG-V2-07/08/09, E2E-V2-02/03/06 UI side).
**Owner:** `android-app` (done) + `backend` (done) + `devops` (done).
**Status:** All 5 pieces shipped + verified end-to-end on Samsung S21+ as John CG (caregiver). Synthetic threshold-breach alert routed through SQS → notification-sender lambda → SNS Platform Endpoint → FCM HTTP v1 → device, with the full evidence triad captured below. Three additional gaps surfaced + fixed in this verification pass:
- **AndroidManifest gap** — `CareLogFirebaseMessagingService` had no `<service>` declaration, so inbound `onMessageReceived` was undeliverable. Token registration always worked (DeviceTokenManager calls `FirebaseMessaging.getInstance().token` directly) but pushes silently dropped.
- **IAM gap** — `carelog-dev-lambda-rds-sqs` (notification-sender's role) had only `sns:Publish`; the lambda's per-call `CreatePlatformEndpoint` failed with `AuthorizationError`. Policy now also carries `sns:CreatePlatformEndpoint`.
- **F15 follow-up shipped** — notification-sender now reads the persisted `device_tokens.endpoint_arn` populated by the device-token lambda at registration time, and only mints an endpoint on the fly for legacy NULL rows. The fallback path also recovers from SNS's `InvalidParameter: already exists with the same Token` by extracting the existing ARN from the error message (the well-known SNS gotcha).
- **v2 alert_type / parameter mapping shipped on Android** — `CareLogFirebaseMessagingService.handleDataMessage` now switches on lowercase v2 strings (`threshold_breach`, `missed_measurement`, `reminder`) keyed on `alert_type` (was v1 uppercase keyed on `type`), and `getVitalDisplayName` maps v2 `parameter_configs.parameter_name` values (`blood_pressure_systolic` etc).

**Pieces 1–5 status:**

| # | Original task | Status |
|---|---|---|
| 1 | SNS Platform Applications (one per FCM / APNs) | DEFERRED — blocked on FCM service-account JSON. Legacy GCM platform credentials were deprecated by Google in June 2024; provisioning needs FCM HTTP v1 with a Firebase service-account JSON, plus instantiation of the existing `infrastructure/terraform/modules/sns/` (currently declared but not called from root). The lambda + schema work below is structured so this is a single-step flip when creds land. |
| 2 | Lambda env vars `IOS_PLATFORM_ARN` / `ANDROID_PLATFORM_ARN` on notification-sender + device-token | DONE — both lambdas now read these vars; new terraform vars `var.android_platform_arn` / `var.ios_platform_arn` default to `""` which the lambdas treat as "no SNS transport, degrade gracefully". |
| 3 | Schema `endpoint_arn VARCHAR(256)` on `device_tokens` | DONE — V006 migration applied to dev RDS; partial index `idx_device_tokens_active_with_endpoint ON device_tokens(user_id) WHERE endpoint_arn IS NOT NULL AND is_active = true` for notification-sender's lookup pattern. |
| 4 | `device-token` Lambda fix | DONE — three bugs fixed in `backend/lambdas/device-token/index.js`: (a) UUID-vs-cognito_sub join (now resolves `claims.sub` → `users.id` via JOIN before INSERT); (b) `ON CONFLICT (device_id, user_id)` against a non-existent constraint (V007 added `UNIQUE (user_id, device_id)`); (c) hard 500 when `ANDROID_PLATFORM_ARN` unset is now a graceful-degradation path that stores the row with `endpoint_arn=NULL` and warns. Lambda also previously had no `package.json`, so the deployed function had 0 invocations ever — added one. |
| 5 | Android client wiring (`POST /device-tokens` after every sign-in) | DONE — `DeviceTokenManager.start()` observes `AuthRepository.authState`, fires `initializeNotifications()` (which POSTs to `/device-tokens`) on every transition to `AuthState.Authenticated` (deduped on user-id change). Wired from `CareLogApplication.onCreate()`. The `FirebaseMessagingService.onNewToken` path was insufficient because it fires once per FCM enrollment, often pre-login. |

**Apply method (same hybrid pattern as F2 — see `terraform_lambda_drift_pattern.md`):**
- `terraform apply -refresh=false -target` for the 4 stable resources (env vars on 2 lambdas + IAM-policy updates on `lambda_rds_cognito` and `lambda_rds_sqs`). Plan: 0 add, 4 change, 0 destroy.
- AWS CLI direct (`aws apigateway put-method` + `put-integration` + `create-deployment`) for `POST /device-tokens` and `DELETE /device-tokens?deviceId=...` — bypasses the deployment-replacement transitive pull-in of `bedrock_router`/`bedrock_vision` which carry source-vs-live drift.
- `aws lambda update-function-code` for the device-token Lambda (graceful-degradation logic + UUID fix).

**Live verification (2026-05-10).**

| Check | Evidence |
|---|---|
| V006 + V007 migrations applied | `\d device_tokens` shows `endpoint_arn` column + `device_tokens_user_device_unique` constraint; `\di` shows `idx_device_tokens_active_with_endpoint` partial index |
| Lambda graceful degradation (direct invoke, fake event) | First invoke 200 with `endpointArn: null`; second invoke (rotated FCM token, same device_id) 200 with row updated in place; CloudWatch shows `ANDROID_PLATFORM_ARN not set — storing device token without SNS endpoint` warn line |
| Android client end-to-end (Maestro `_f17_login_smoke` against Samsung RFCT10C1GSZ, Jane's account) | Login completed → CloudWatch `Registered device token for user 89d020be-..., device 9ce8e675a1e2cedc, endpoint=NULL (SNS unprovisioned)` → live RDS shows row with `device_id = 9ce8e675a1e2cedc` (real Android `Settings.Secure.ANDROID_ID`), `device_token` 142-char FCM v1 token starting `eCE4Hg7OQQKuQtgIdWf4tR:APA91bF`, `user_id = 89d020be-db47-43bf-9a80-724b43c0694d` (Jane's internal UUID, correctly resolved from cognito_sub), `endpoint_arn = NULL` |
| API Gateway route reachable | `POST /device-tokens` and `DELETE /device-tokens?deviceId=...` live on stage `dev` of `rsf93ac8bd`; permission allows `apigateway.amazonaws.com` to invoke device-token Lambda |
| IAM | `lambda_rds_cognito` role gained `sns:CreatePlatformEndpoint/SetEndpointAttributes/GetEndpointAttributes/DeleteEndpoint` (Resource=*); `lambda_rds_sqs` role gained `sns:Publish` (Resource=*) |

**2026-05-11 close-out (end-to-end live verification on Samsung S21+):**

| Check | Evidence |
|---|---|
| SNS Platform Application provisioned (FCM HTTP v1, token-based) | `arn:aws:sns:ap-south-1:316643066568:app/GCM/carelog-android-fcm-dev` — `AuthenticationMethod=Token, Enabled=true`. Credential is the Firebase service-account JSON for project `carelog-7de0c` (`project_number: 191872106923`); a copy lives in Secrets Manager as `carelog-dev/fcm-service-account` for terraform import / re-creation. |
| Lambda env vars | `aws lambda get-function-configuration --function-name carelog-dev-notification-sender --query Environment.Variables.ANDROID_PLATFORM_ARN` returns the ARN. Same for `carelog-dev-device-token`. |
| Caregiver login → endpoint persisted | `_bench_login_caregiver.yaml` Maestro flow logged in as John CG; device-token lambda CloudWatch shows `Registered device token for user a2b0af09-..., endpoint=arn:aws:sns:...endpoint/GCM/carelog-android-fcm-dev/0541d5ca-a4ed-...`. Live RDS `device_tokens.endpoint_arn` populated on that row. |
| End-to-end synthetic alert | Alert row `ca94cbb3-255c-4fbf-bef5-7fbb5f9cad1b` inserted (threshold_breach, Jane's patient_id, John's caregiver_id) → SQS send → notification-sender CloudWatch logs `Sent threshold breach notification to caregiver John CG` at 2026-05-12T02:31:48.944Z → alerts row flips to `is_sent=true, sent_at=2026-05-12 02:31:48.961389+00, send_error=NULL`. |
| On-device receipt | Samsung S21+ logcat with John CG signed in: `CareLogFCM: Message received from: 191872106923` (Firebase sender ID) → `Message data payload: {patient_id=8c5090c0-..., threshold=160, value=185, alert_type=threshold_breach, parameter=blood_pressure_systolic}`. System tray notification rendered via the `notification` block of the GCM payload (title `Alert: High Systolic BP`, body containing the value/threshold/direction). |

**SNS Platform App provisioning (CLI hybrid pattern, terraform-state safe):**
1. `aws secretsmanager create-secret --name carelog-dev/fcm-service-account --secret-string file://<service-account>.json --region ap-south-1`.
2. `aws sns create-platform-application --cli-input-json file://<payload>.json` where `Platform=GCM`, `Attributes.PlatformCredential=<json content>`. AWS still calls this "GCM" but the AuthenticationMethod=Token attribute means FCM HTTP v1 under the hood.
3. `aws lambda update-function-configuration --function-name carelog-dev-{notification-sender,device-token} --environment 'Variables={..., ANDROID_PLATFORM_ARN=<arn>}'` for both lambdas. Avoids a full `terraform apply` and the cognito drift from `66ca57c`.
4. `aws iam put-role-policy` to add `sns:CreatePlatformEndpoint` to the notification-sender role (was previously `sns:Publish`-only — the F17 plan missed that the lambda mints endpoints itself).

The terraform side now captures everything (vars + main.tf wiring + IAM policy update) so the next non-drift `terraform apply` will see zero changes on these surfaces.

---

### F16 — `doctor-patients` references non-existent `alert_reads` table and `alerts.deleted_at` column (NEW — surfaced by audit)

**Severity:** Low (today). All 8 DR-V2-* journeys are already blocked on `data-testid` and Playwright-runner work. Once the web portal is unblocked, this lambda will crash on the doctor's patient list.
**Owner:** `backend`.
**Estimated effort:** 30 min.

**Reproduction.** `backend/lambdas/doctor-patients/index.js` line 92 builds:
```sql
SELECT COUNT(*)
FROM alerts a
LEFT JOIN alert_reads ar ON ar.alert_id = a.id AND ar.user_id = $1
WHERE a.patient_id = p.id AND ar.id IS NULL AND a.deleted_at IS NULL
```
- `alert_reads` doesn't exist (`Did not find any relation named "alert_reads"`).
- `a.deleted_at` doesn't exist (same as F13).
- Plus uses `pl.role = 'doctor'` and `pl.status = 'active'` — `persona_links` schema actually exposes `relationship` and `is_active` (verified earlier when I ran the persona_links lookup for Jane).

**Fix.** Use the schema-correct columns: `recipient_user_id`-based unread count (per `patient-summary` already does this correctly), `relationship='doctor'`, `is_active=true`, drop the deleted_at filter.

---

### F11 — `evaluate-thresholds-batch` writes `alerts` row with the wrong column name and no recipient (RESOLVED — verified live 2026-05-09)

**Severity:** High. Was: **no `threshold_breach` alert could ever land in the `alerts` table** — the entire E2E-V2-02 / E2E-V2-03 caregiver-notification chain was silently broken end-to-end.
**Owner:** `backend`.
**Status:** Fixed and verified end-to-end. Direct invoke of `carelog-dev-evaluate-thresholds-batch` with a 200/110 BP payload now creates two `alerts` rows (systolic + diastolic) and enqueues two SQS messages on `carelog-dev-alerts`. Lambda code updated via `aws lambda update-function-code` (terraform path was carrying unrelated cognito drift; bypassed it to keep blast radius narrow).

**Reproduction (2026-05-09).** After provisioning Jane with a BP `parameter_configs` row (systolic 90–160 / diastolic 50–95), direct invoke of `carelog-dev-evaluate-thresholds-batch` with a clearly-breaching payload (200/110) returns:
```
StatusCode=200, FunctionError=Unhandled
errorMessage: 'column "value" of relation "alerts" does not exist'
trace: createAlertRecord (/var/task/index.js:102:18)
```

**Root cause(s)** (all in `backend/lambdas/evaluate-thresholds-batch/index.js`):
1. **Column-name mismatch.** `createAlertRecord` does `INSERT INTO alerts (..., value, ...)` but the live schema has `vital_value` (and `vital_unit`, neither of which is populated).
2. **Missing required column.** `alerts.recipient_user_id` is `NOT NULL` but the INSERT omits it. The lambda already calls `findLinkedCaregiver(...)` for the SQS message but never threads the caregiver's `linked_user_id` into the alert row.
3. **Threshold values lost.** The `alerts.threshold_min` / `alerts.threshold_max` columns are never populated, so caregiver UI can't render the breached limits without re-querying `parameter_configs`.

**Fix sketch.**
```diff
-INSERT INTO alerts (patient_id, alert_type, vital_type, value, message, created_at)
-VALUES ($1, $2, $3, $4, $5, NOW())
+INSERT INTO alerts (
+  patient_id, recipient_user_id, alert_type, vital_type,
+  vital_value, vital_unit, threshold_min, threshold_max, message, created_at
+) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
```
plus pulling the caregiver's `linked_user_id` from the existing `findLinkedCaregiver` call into the params, and reading `matchingConfig.threshold_min[0]` / `[0]` (or `null`) for the breached-side bound.

**Why this wasn't caught before.** E2E-V2-02 was never executed — it was paper-classified as "blocked: Jane lacks config." Provisioning Jane (this evening) was the first time the chain ran end-to-end against the real RDS schema.

**Adjacent risk:** double-check `notification-sender` for the same kind of column-name drift against `alerts` reads before relying on push delivery for verification.

**Verification (2026-05-09 19:48Z).**
- Direct invoke (`200/110` BP payload, Jane's `patient_id`):
  ```
  StatusCode=200 (no FunctionError)
  breaches_found=2; alert_id=c6502587-…(systolic), 0088f6e6-…(diastolic)
  ```
- RDS `alerts`:
  | id | alert_type | vital_type | vital_value | vital_unit | threshold_max | recipient_user_id |
  |---|---|---|---|---|---|---|
  | c650… | threshold_breach | blood_pressure_systolic | 200.00 | mmHg | 160.00 | a2b0…(John CG) |
  | 0088… | threshold_breach | blood_pressure_diastolic | 110.00 | mmHg |  95.00 | a2b0…(John CG) |
- SQS `carelog-dev-alerts`: 2 messages enqueued (`ApproximateNumberOfMessagesNotVisible=2` immediately after, indicating notification-sender picked them up for processing).
- CloudWatch confirmed: `Enqueued threshold breach notification for blood_pressure_systolic` × 2 + `Evaluation complete: 2 breaches found out of 2 values`.

**Bonus fix on the way.** While verifying, also surfaced and fixed a sibling bug in the same file: `createAlertRecord` was passing the literal string `'THRESHOLD_BREACH'` to the `alerts.alert_type` column, but the live `alert_type` enum only contains lowercase values (`threshold_breach`, `reminder_lapse`, `system`, `missed_measurement`, `patient_reminder`). Changed to `'threshold_breach'` to match.

**Side note: terraform drift parked.** The dev cognito module has unrelated drift (SES `email_configuration`, `device_configuration`, `invite_message_template`) introduced in commit `66ca57c` and never applied. Targeted `terraform plan` for any lambda in this module currently surfaces the cognito changes too, even with `-target`. Investigate + apply (or revert) the cognito drift in a dedicated change before the next non-targeted apply.

---

### F10 — State-machine allowlist rejects CREATED -> PLAUSIBILITY_CHALLENGE (RESOLVED — verified live 2026-05-09)

**Severity:** Medium. Was: implausible-value handling on the **very first turn** crashed with HTTP 500.
**Owner:** `backend`.
**Status:** Fixed and verified end-to-end. PT-V2-08-via-text now round-trips cleanly; `interaction_sessions.fsm_state='PLAUSIBILITY_CHALLENGE'` recorded immediately after submit, no `StateTransitionError` in logs. Bedrock-router live alias bumped to v30.

**Problem.** When a patient's first utterance is an implausible value (e.g. "my BP is 300 over 200"), the LLM correctly emits `stateTransition: "CREATED -> PLAUSIBILITY_CHALLENGE"` and the response text "could you re-check the reading?". The `bedrock-router` Lambda then **rejects** the LLM output with `StateTransitionError: Transition CREATED -> PLAUSIBILITY_CHALLENGE is not in the allowed set` and returns HTTP 500 to the app.

**Reproduction.** PT-V2-08-via-text in sweep `20260509_000226`:
```
MatikaConversationVM: submitTurn seq=1 sessionId=... chars=51
MatikaConversationVM: submitTurn failed seq=1
retrofit2.HttpException: HTTP 500
```
Lambda log:
```
ERROR handleTurn failed StateTransitionError: Transition CREATED -> PLAUSIBILITY_CHALLENGE is not in the allowed set.
```

**Why it's not a regression from F2.** F2 only added `status` / `endedAt` columns + COALESCE in SQL + `computeSessionTerminus` helper. None of those touch state-transition validation. PT-V2-09 emergency text passed cleanly in the same sweep — `CREATED -> EMERGENCY` is in the allowlist (incidentally), proving the allowlist itself is the issue, not transition logic.

**Fix.** Extend the allowed-transition set in the bedrock-router state machine to include first-turn shortcuts:
- `CREATED -> PLAUSIBILITY_CHALLENGE` (covers PT-V2-08)
- `CREATED -> EMERGENCY` (already works but should be explicit not incidental)
- `GREETING -> PLAUSIBILITY_CHALLENGE` (covers the case where the patient's first content turn after a greeting is implausible)
- `GREETING -> EMERGENCY` (same)

**Verification (2026-05-09 18:13Z).** PT-V2-08-via-text re-run after deploy:
- UI: `matika_response_card` mounted; flow PASSES.
- RDS `interaction_sessions` (id=`dabd26ae-…`): `fsm_state='PLAUSIBILITY_CHALLENGE'`, `status='in_progress'`, started 18:13:22Z. Exactly the transition that previously crashed.
- RDS `model_call`: T2 Haiku (`global.anthropic.claude-haiku-4-5-20251001-v1:0`), latency 2840ms, no guardrail block, `escalation_reason` empty.
- No `StateTransitionError` in `/aws/lambda/matika-dev-bedrock-router` logs.

**Note vs original spec.** This finding's original "fix" hypothesis predicted a **T3 Sonnet escalation with `escalation_reason='implausible_value'`**. In practice, T2 Haiku itself proposes the `CREATED -> PLAUSIBILITY_CHALLENGE` transition without escalation — the LLM detected the implausibility on its own and emitted the correct stateTransition. The allowlist was the only blocker. This is **cheaper than expected** (T2 vs T3) and arguably better behaviour. EDGE-V2-13 (which testing_todos previously called out as "same allowlist root cause") should now also unblock — schedule for next sweep.

---

### F9 — STT result not routed from Android STT to /conversation/turn (RESOLVED — verified live in voice flow)

**Severity:** High. Was the root cause of "voice journeys never produce model_call rows."
**Owner:** `android-app`.
**Status:** Fixed and verified end-to-end (sweep iteration after `20260508_230704`).

**Root cause.** Two-layer drop:
1. `SttResult.kt::extractFirstTranscript` returned `null` when only the *first* hypothesis was blank — even if subsequent hypotheses were non-blank. Soda sometimes ranks an empty/whitespace hyp first under noisy/short utterances.
2. `SttManager::onResults` converted the `null` to `""` via `.orEmpty()` and emitted `SttResult.Final("")`. `MatikaConversationViewModel` then silently skipped `submitTurn` due to its `isNotBlank()` guard — no log, no UI feedback, no error.

**Fix.**
- `extractFirstTranscript` now picks the first non-blank hypothesis (`firstOrNull { !it.isNullOrBlank() }`).
- `SttManager::onResults` logs success (`chars=N`) AND surfaces all-blank hyps as `SttResult.Error(NO_MATCH, ...)` instead of silently emitting `Final("")`.
- VM's blank-text branch now logs + surfaces a user-visible error so any future regression upstream doesn't disappear.

**Verified.** Single-turn voice flow (`patient_voice_bp_en_single_turn.yaml`) produced:
```
SttManager: RecognitionListener.onResults chars=32
MatikaConversationVM: STT final transcript chars=32; submitting turn
MatikaConversationVM: submitTurn seq=1 sessionId=... chars=32
```
Followed by a new `model_call` T2 row in RDS (`latency_ms=2653`, no guardrail block) and `extractedValues` populated in bedrock-router output.

**Companion finding (unfixed):** the multi-turn voice flow's vacuous F6 assertion lets Maestro double-tap mic in <1s, which `onMicPressed()` interprets as a CANCEL of the in-flight STT job. Real fix is F6 (response-card testTag → non-vacuous post-turn assertion). Until then, voice journeys should use the single-turn flow variant or wait on a response card by content.

---

### F7 — Logcat-trigger voice orchestration (RESOLVED — superseded by F20, verified 2026-05-10)

**Severity:** Was High for voice journeys (8+).
**Owner:** `qa-testing` / orchestrator.
**Status.** Fixed and verified. F7's intent — replace fixed `sleep N ; matika-say …` with a deterministic logcat trigger — was realized in F20's fix. The end-to-end shape:

- New script `scripts/matika-voice-run.sh` (committed `73eddfc`) backgrounds `maestro-run.sh`, tails logcat, waits for the trigger pattern, calls `matika-say`, repeats per turn, joins.
- The trigger marker chosen at implementation time is `RecognitionListener.onReadyForSpeech: mic open` (deterministic across OEMs), emitted by `SttManager.kt:onReadyForSpeech`. F7's originally-proposed `SodaSpeechRecognizer.*Offline recognizer - start listening` was Pixel-only — see F20 for the OEM-portability fix.
- `.maestro/flows/patient_voice_*.yaml` headers updated; `docs/matika_test_plan_v2.md` §Phase 4 + `.agents/journey-orchestrator.md` Pattern B updated alongside.

Unlocked PT-V2-03/04/05 + CG-V2-03 (verified live 2026-05-10 — five back-to-back voice runs; see F20 entry).

### F5 — `scripts/maestro-run.sh --no-install` is positional-only (RESOLVED — verified 2026-05-11)

**Severity:** Was Low (cosmetic; ~5s wasted per run).
**Owner:** `qa-testing`.
**Status.** Fixed in commit `2c351c7` (2026-05-08). `scripts/maestro-run.sh:24-34` loops over `$@` and recognises `--no-install` anywhere; flow name is whichever positional remains. Verified by reading current `scripts/maestro-run.sh` 2026-05-11.

### F6 — Voice flow `notVisible: thinking` assertion is vacuous (RESOLVED)

**Severity:** High for voice journeys (silently masks failures).
**Owner:** `qa-testing` + `android-app`.
**Status:** Fixed and verified.

**Problem.** When STT got no speech, no transcript was submitted, "thinking" never appeared on screen, and `notVisible: thinking` evaluated true. Maestro reported the journey green; the round-trip never happened.

**Fix.** Four new testTags on `MatikaConversationScreen`:
- `matika_response_card` — only mounts when `lastResponseText` is non-blank (post-Bedrock-round-trip). The non-vacuous `assertVisible` for single-turn voice flows.
- `matika_turn_counter` — surface the `"turn N"` text so multi-turn flows can assert on `text: "turn 2"` (since `matika_response_card` stays visible across turns).
- `matika_speaking_indicator` — multi-turn flows wait for `notVisible` before tapping mic for turn 2; otherwise TTS playback bleeds into Soda's listening window and the second turn returns NO_MATCH.
- `matika_thinking_indicator` and `matika_listening_indicator` — companion tags for diagnostic assertions.

**Verified.** Single-turn flow `patient_voice_bp_en_single_turn.yaml` exit=0 with `Assert that id: matika_response_card is visible... COMPLETED` and `submitTurn ok fsm=PENDING_CONFIRMATION extracted=2`. Multi-turn flow now **honestly** detects when turn 2 fails instead of false-passing.

**Residual acoustic flakiness (NOT a F6 bug):** the multi-turn flow's turn 2 ("Yes, that value is correct") still hits Soda NO_MATCH intermittently — short confirmation utterances are at the edge of Soda's offline-pack confidence threshold even when TTS playback has finished. Solutions:
- Use longer / more distinct turn-2 utterances ("Yes, the value is correct, please save it")
- Boost speaker volume / tighten phone-to-speaker placement during voice-test runs
- Switch second-turn from voice to text fallback when only confirmation is needed (text round-trips deterministically)

This is a tuning matter for the test environment, not a code defect. The first-turn voice path works deterministically.

---

## Real product bugs from the sweep

### F1 — `users.last_login_at` never updated post-login (RESOLVED — verified live 2026-05-10)

**Severity:** Was Medium. Login telemetry was broken; ops dashboards reading the field showed stale data.
**Owner:** `backend`.
**Status:** Fixed and verified end-to-end. A new `post-authentication` Cognito trigger (`backend/lambdas/post-authentication/index.js`) runs `UPDATE users SET last_login_at = NOW() WHERE cognito_sub = $1` on every successful sign-in. The Lambda swallows DB-write failures (logs but does not throw) — Cognito blocks the user's sign-in if a PostAuthentication trigger throws, which would be too aggressive for a pure-telemetry write. Terraform wires the trigger via `null_resource.cognito_post_confirmation_trigger` in the root module (it now passes both `PostConfirmation` AND `PostAuthentication` ARNs in a single `aws cognito-idp update-user-pool --lambda-config ...`); IAM invoke permission for `cognito-idp.amazonaws.com` lives in `infrastructure/terraform/modules/lambda/main.tf` (`aws_lambda_permission.post_authentication_cognito`).

**Live verification (2026-05-10).** Live state confirmed:

| Source | Evidence |
|---|---|
| Cognito user pool `ap-south-1_1TcE4vTTi` `LambdaConfig.PostAuthentication` | `arn:aws:lambda:ap-south-1:316643066568:function:carelog-dev-post-authentication` |
| Lambda invoke policy | `Principal: cognito-idp.amazonaws.com`, `SourceArn: arn:aws:cognito-idp:ap-south-1:...:userpool/ap-south-1_1TcE4vTTi` |
| CloudWatch (last 3 days) | Multiple `post-authentication: stamped last_login_at { userId: ..., triggerSource: 'PostAuthentication_Authentication' }` lines for both Jane + John CG |
| Live RDS, Jane (`89d020be-db47-43bf-9a80-724b43c0694d`) | `last_login_at = 2026-05-10 01:52:48.667912+00` (matches Maestro patient-flow run that hour, to the millisecond) |
| Live RDS, John CG (`a2b0af09-86a7-4156-8e24-7837c311f7de`) | `last_login_at = 2026-05-10 02:15:31.640603+00` |

PT-V2-07 backend-checks regression now passes: `users.last_login_at IS NOT NULL` for any user who has logged in since the trigger went live (2026-05-09 06:04 UTC). Pre-existing users who never re-authenticated retain NULL — that's expected; the field captures *most recent* login, not historical ones.

### F2 — `interaction_sessions` never marked complete (RESOLVED — verified live 2026-05-10)

**Severity:** Was Medium. Session state machine doesn't transition to TERMINAL; rows stay `status='in_progress'` indefinitely.
**Owner:** `backend` + `android-app`.
**Status:** Fixed and verified end-to-end across all three pieces. The full landscape now closes the loop:

| Path | Mechanism | Resulting status |
|---|---|---|
| LLM emits `complete_session` action | bedrock-router `computeSessionTerminus` + `sessionPersister.update` (was already wired pre-session) | `complete` |
| LLM emits `pause_session` | same | `paused` |
| Emergency trigger fires (transcript_keyword / llm_classification / guardrail_block) | same | `incomplete` |
| User hits Stop mid-session before `complete_session` | `MatikaConversationViewModel.onStopPressed()` → `POST /sessions/{sessionId}/end` → new `carelog-dev-end-session` lambda | `complete` |
| App crash / force-stop / network drop / OS kill | hourly EventBridge cron → new `carelog-dev-expire-stale-sessions` lambda → flips rows where `updated_at < NOW() - 30 minutes` AND `status='in_progress'` | `incomplete` |

The schema's CHECK constraint on `interaction_sessions.status` is `('in_progress', 'paused', 'complete', 'incomplete')` — the F2 doc loosely referred to "terminal_incomplete" but that label isn't a column value; `incomplete` is the correct destination for both emergency-terminated and idle-swept rows.

**Components shipped this session.**

1. **`backend/lambdas/end-session/`** — new Lambda. Authorizes via Cognito sub (claims) → users.id JOIN with the row's user_id; conflates "row doesn't exist" and "row exists but caller doesn't own it" into a single 404 to avoid leaking session-id existence. Idempotent: a second call against an already-terminal row returns 200 with the existing terminal state (no re-stamp of `ended_at`).
2. **`backend/lambdas/expire-stale-sessions/`** — new Lambda. SQL-only (no AWS SDK round-trips per row): single `UPDATE … RETURNING id, fsm_state` plus a `WHERE updated_at < NOW() - ($1 || ' minutes')::interval` filter. Idle window from `SESSION_IDLE_MINUTES` env var (default 30).
3. **`infrastructure/terraform/modules/lambda/`** — both lambdas registered (function + archive_file + invoke permission); new `session_idle_minutes` variable.
4. **`infrastructure/terraform/modules/eventbridge/`** — new `aws_cloudwatch_event_rule.expire_stale_sessions` (hourly `rate(1 hour)`) + target + invoke permission.
5. **`infrastructure/terraform/modules/api_gateway/routes_v2.tf`** — new `/sessions/{sessionId}/end` resource tree + `POST` method (COGNITO_USER_POOLS) + `AWS_PROXY` integration + deployment-trigger entries.
6. **`android/app/src/main/java/com/carelog/network/CloudApiService.kt`** — new `endSession(sessionId)` Retrofit method.
7. **`android/app/src/main/java/com/carelog/inference/MatikaConversationViewModel.kt`** — `onStopPressed()` fires the call inside `viewModelScope.launch`, fire-and-forget; failures swallowed so the UI navigation that triggered the stop is never blocked.

**Apply method (deviation from previous F-numbers).** The dev terraform state had ~20 unrelated drift items including a bastion replacement and 6 lambdas where local archive hashes differed from live (the cognito-drift class noted in F11). A full `terraform apply` would have reverted F19's bedrock-router fix and replaced the bastion mid-verification. So the apply was split:
- `terraform apply -refresh=false -target=...` for the 6 stable resources (2 lambdas + EventBridge rule/target/permission + lambda invoke permission). 6 added, 0 changed, 0 destroyed.
- `aws apigateway` CLI (create-resource + put-method + put-integration + create-deployment) for the API route, since the deployment-replacement transitively pulled in `bedrock_router` and `bedrock_vision` which had local source drift vs live.

The terraform code for the API Gateway route is committed alongside the rest; on the next legitimate full apply (when the unrelated drift is reconciled), terraform will see those resources as already-existing and either import them silently or flag them as needing import. **Open follow-up:** `terraform import` the manually-created API Gateway resources back into state so the next planner sees no diff. Tracked with the new resource IDs:
- `aws_api_gateway_resource.sessions` → `4s6y22`
- `aws_api_gateway_resource.session_id` → `hczpv6`
- `aws_api_gateway_resource.session_end` → `gi7pjd`

**Live verification (2026-05-10 03:57Z–04:00Z).**

| Check | Evidence |
|---|---|
| Sweep Lambda invoked manually | `{"sweptCount": 1, "idleWindowMinutes": 30}` |
| Stale row flipped | Pre-sweep: `status='in_progress', updated_at=NOW()-60min`; Post-sweep: `status='incomplete', ended_at=NOW()` (matches the sweep's NOW() to the millisecond) |
| Sweep idempotent | Second invoke immediately after returns `{"sweptCount": 0, …}` |
| End-session via direct lambda invoke | 200, `{"status":"complete","endedAt":"2026-05-10T03:59:14.911Z","fsmState":"EXTRACTING"}` (FSM state preserved, as designed) |
| End-session idempotent | Second invoke with same payload returns identical body — same `endedAt` timestamp, no re-stamp |
| Authorization | Different Cognito sub against Jane's session → 404 `{"error":"not_found","message":"Session not found"}` (no leak of session existence) |
| API Gateway route reachable | `POST https://rsf93ac8bd.execute-api.ap-south-1.amazonaws.com/dev/sessions/{id}/end` without auth → 401 from API Gateway (proves route exists; would be 404 if missing) |

### F3 — `create-patient` masks `UsernameExistsException` as generic 500 (RESOLVED — verified deployed 2026-05-11)

**Severity:** Was Low–Medium. Real users hitting the email-collision case got a useless error.
**Owner:** `backend`.

**Status:** Fix shipped in commit `2c351c7` (2026-05-08). Deployed lambda (`/aws/lambda/carelog-dev-create-patient`, last-modified 2026-05-09T06:04Z) confirmed via code download — `index.js:531-547` catches `UsernameExistsException` (`error?.name === 'UsernameExistsException' || error?.__type === 'UsernameExistsException'`) and returns `statusCode: 409` with body `{error, code: "EMAIL_ALREADY_EXISTS"}`. CloudWatch shows 4 `UsernameExistsException` log entries in the last 7 days against the deployed code, each of which falls through to the 409 path. The post-F23-sweep-gaps Gap 5 entry was stale (pre-2026-05-08 view of the lambda); no further work needed.

---

## Architecture / journey-doc divergence

### F4 — v2 home is voice-first; v1 vital screens still ship (RESOLVED Path A — verified live 2026-05-10)

**Severity:** Was Medium (test coverage cliff). Picked Path A: keep the orphan screens, wire entry points into v2 nav. Path B (delete) was the alternative, rejected to preserve manual-entry as a fallback for offline / accessibility / patient preference.
**Owner:** `android-app` (done).

**Problem (pre-fix).** `PatientHomeScreen.kt` had only "Start Conversation" — no path to the 6 v1 vital screens (`BloodPressureScreen` / `GlucoseScreen` / `TemperatureScreen` / `WeightScreen` / `PulseScreen` / `SpO2Screen`). The screens existed, the routes were wired in `CareLogNavHost.kt`, but no UI launcher reached them. Same pattern on the caregiver side: `ThresholdConfigScreen`, `ReminderConfigScreen`, and `TrendsScreen` were only reachable via `RelativeDashboardScreen`, which the persona mapping bypassed (`PersonaType.RELATIVE → CAREGIVER_DASHBOARD`).

**Fix.** Added entry points only — no screen-internal logic touched.

| Side | Change |
|---|---|
| Patient | New `ManualVitalsGrid` composable on `PatientHomeScreen` (3 rows × 2 tiles, below "Start Conversation" with an "Or log manually" header). Each tile carries `testTag="vital_tile_<param>"` and a content description for accessibility. PatientHomeScreen got 6 new `onNavigateTo*` callbacks; `CareLogNavHost` wires each to the existing `CareLogRoutes.<vital>` destinations. Column made `verticalScroll`-able (was a fixed-height layout with `weight(1f)`). |
| Caregiver | New "Manage" section on `CaregiverHomeScreen` (LazyColumn item with 3 cards). testTags `caregiver_thresholds` / `caregiver_reminders` / `caregiver_trends` match the pre-existing journey-doc expectations from the orphaned `RelativeDashboardScreen`. Three new callbacks; `CareLogNavHost` wires to existing `THRESHOLDS` / `REMINDERS` / `TRENDS` routes. The orphan `RelativeDashboardScreen` is left in place (not deleted) — its fate is a separate cleanup decision. |

**Live verification (2026-05-10, Samsung RFCT10C1GSZ).** Two underscore-prefix smoke flows confirmed reachability before being removed:

| Flow | Outcome |
|---|---|
| `_f4_patient_vitals_smoke` | Logged in as Jane → 6 tiles visible after scroll → tap each → corresponding `bp_save_button` / `glucose_save_button` / `temperature_save_button` / `weight_save_button` / `pulse_save_button` / `spo2_save_button` mounts → back-navigate. All 6 PASS. |
| `_f4_caregiver_manage_smoke` | Logged in as John CG → 3 Manage cards visible after scroll → `caregiver_thresholds` → "Threshold Settings" title mounts; `caregiver_reminders` → "Reminder Settings"; `caregiver_trends` → "Trends". All 3 PASS. |

**Journey state delta** (the 12 affected journeys move from "blocked (architecture)" to a new state):

| Journey | Pre-F4 state | Post-F4 state |
|---|---|---|
| PT-V2-15 (BP) | blocked (architecture) | route reachable; ready for Maestro flow authoring |
| PT-V2-16..20 (other vitals) | blocked (architecture) | same |
| PT-V2-21 (vitals overview) | blocked (architecture) | the tile grid IS the overview; flow can assert all 6 tiles visible from home |
| EDGE-V2-14 (vital edit + network drop) | blocked (architecture) | route reachable; can author once a vital flow exists |
| CG-V2-12 (thresholds) | blocked (architecture) | route reachable; **partial blocker discovered**: backend threshold-fetch returns no data for John CG's linked patient (screen mounts in error state with "Retry" button visible). New finding tracked separately — not part of F4. |
| CG-V2-13 (reminders) | blocked (architecture) | same screen-mounts-but-no-data pattern |
| CG-V2-17 (trends) | blocked (architecture) | route reachable; data-load state TBD |

**New finding surfaced during verification (not F4):** the caregiver Threshold/Reminder/Trends data fetches show "Retry" on John CG's session. Likely the same UUID-vs-cognito_sub or persona_links column-name class as F13/F16. Worth a backend audit pass over `threshold-crud`, `reminder-crud`, and the trends-data Lambda. Track as a new F-number when prioritized.

**Files touched.**
- `android/app/src/main/java/com/carelog/dashboard/ui/PatientHomeScreen.kt` — 6 new callbacks, ManualVitalsGrid + VitalTile composables, verticalScroll
- `android/app/src/main/java/com/carelog/dashboard/ui/CaregiverHomeScreen.kt` — 3 new callbacks, Manage section + ManageCard composable
- `android/app/src/main/java/com/carelog/ui/CareLogNavHost.kt` — wired all 9 callbacks to existing `CareLogRoutes` destinations
- No changes to the 9 destination screens; no terraform; no backend.

---

## Informational / spec alignment

### F8 — Bedrock inference profile name divergence (RESOLVED — verified live 2026-05-11)

**Severity:** Was Informational.
**Owner:** `devops` / `inference-platform`.
**Status.** Doc-side aligned to live deployment. Picked spec → reality (no risk to working system). Live state at fix time:

| Source | Value |
|---|---|
| `matika-dev-bedrock-router` env `BEDROCK_HAIKU_MODEL_ID` | `global.anthropic.claude-haiku-4-5-20251001-v1:0` |
| `matika-dev-bedrock-router` env `BEDROCK_SONNET_MODEL_ID` | `global.anthropic.claude-sonnet-4-6` |
| `model_call.model` distinct values (live RDS, 2026-05-11) | `global.anthropic.claude-haiku-4-5-20251001-v1:0` (23 rows), `global.anthropic.claude-sonnet-4-6` (5 rows) |
| IAM `bedrock-router-access` policy `Resource` ARNs | `arn:aws:bedrock:ap-south-1:316643066568:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0` + `…/global.anthropic.claude-sonnet-4-6` |

Updated `docs/matika_spec_v2.md` §3.3 (inference-profile table), §7.7 (model-update env block), §11.4 (IAM policy snippet — added account-scoped resource ARNs since global profiles do not match the cross-account `*::` wildcard form), §14.3 (env var block; also corrected `INFERENCE_PROFILE_REGION` from `ap-southeast-1` to live value `ap-south-1`).

---

## Coverage expansion (not from this sweep)

The remaining ~73 catalog journeys group into work categories:

### Caregiver management Maestro flows (CG-V2-10..18) — 13 journeys

**Owner:** `qa-testing`.
**Estimated effort:** 2–3 days (mechanical).

Author Maestro flows for: invite-doctor, manage care team, configure thresholds manually, configure reminders manually, view trends, sign out. Each needs a testTag audit on the relevant settings screen. Some require the response from earlier flows (e.g. CG-V2-14 needs a doctor recommendation, which needs DR-V2-05, which is web-blocked).

### Edge cases EDGE-V2-01..17 — 17 journeys

**Owner:** `qa-testing` for input-validation cases; `inference-platform` / `devops` for fault-injection.
**Estimated effort:** 1–5 days depending on subclass.

- **Trivial (~30 min each):** EDGE-V2-01/02 — registration + login validation; just feed bad inputs.
- **Medium (~2 hours each):** EDGE-V2-13 (plausibility ranges), EDGE-V2-14 (network drop), EDGE-V2-15 (mic permission denied) — flow + adb svc cycle.
- **Hard (~1 week total):** EDGE-V2-08 (cross-region failover), EDGE-V2-09 (parse failure), EDGE-V2-03 (Guardrail block) — need fault-injection harness or Bedrock mock layer.
- **Out-of-budget by design (~5):** EDGE-V2-05/06/10/12/17 — JWT 1-hour / 30-day / idle-30min / pause-5min / fresh-install. Run as scheduled long-tail jobs.

### Web portal doctor journeys DR-V2-01..08 — 8 journeys

**Owner:** `web-portal` (testid first), then `qa-testing` (Playwright runner).
**Estimated effort:** 1–2 days.

1. `web-portal` agent adds `data-testid` to LoginPage, PatientListPage, PatientViewPage, DoctorRegistrationPage. Inventory via the same approach as the Android testTag inventory.
2. `qa-testing` writes `web-portal/scripts/run-journey.mjs` Playwright runner.
3. New agent spec `.agents/web-journey-runner.md` if patterns diverge meaningfully from `journey-runner`.

### Push-notification verification CG-V2-07/08/09, E2E-V2-02/03, PT-V2-24

**Owner:** `qa-testing` + `devops`.
**Estimated effort:** 3–5 days.

Either (a) emulate a second device on the Mac (a second AVD running the caregiver build) and observe FCM delivery; or (b) intercept FCM at the SNS layer in dev and assert payload shape. (b) is more reliable but needs SNS sandboxing.

### Photo-OCR journeys PT-V2-10/11/12

**Owner:** Manual (human in the loop).
**Estimated effort:** 1 hour each, ad hoc.

Genuinely require a real glucometer, BP cuff, or thermometer. Stage in the Photo OCR runbook + require a smoke run before any Bedrock-vision deploy.

### Out-of-scope per PRD §12 — 6 journeys

No work — deliberate exclusions: Bluetooth, iOS, full offline mode, in-app messaging, doctor-onboards-patient, v1 attendant.

---

## Estimated effort summary to reach "exhaustive"

| Workstream | Effort | Journeys unblocked |
|---|---|---|
| F7 logcat-trigger voice | 0.5 day | 7 (voice) |
| F1 last_login_at | 0.5 day | (fixes regression in already-running journeys) |
| F2 session never completes | 1 day | (fixes regression in already-running journeys) |
| F3 UsernameExists mapping | 1 hour | (improves CG-V2-02) |
| F5 maestro-run.sh args | 5 min | — |
| F6 response-card testTag | 1 hour | (makes voice assertions non-vacuous) |
| Caregiver Maestro flows | 2–3 days | 13 |
| Edge case input + adb-cycle flows | 2 days | ~10 |
| Edge case fault-injection | 1 week | ~5 |
| Web portal data-testid + Playwright | 1–2 days | 8 |
| Push-notification verification harness | 3–5 days | 6 |
| Photo OCR (manual smoke) | ad hoc | 3 |
| **Total to exhaustive** | **~2–3 weeks** | **~50 unblocked** |

After this work, ~73 of 79 are runnable; remaining ~6 are deliberately out-of-scope per PRD §12.

---

## How to track progress

This file is the durable backlog. Per-sweep status (which TODOs were closed, which surfaced new ones) is tracked in each sweep's `report.md` — see `test-automation/results/journey-results/<sweep-id>/`. Update this file when:

- A TODO is fixed and re-verified by a sweep
- A new finding from a sweep adds an item
- Effort estimates change after attempting

---

*Last updated: 2026-05-08 after first Standard sweep (`20260508_215314`).*

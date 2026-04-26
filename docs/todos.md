# CareLog v3.0 — Full Codebase Audit

**Date:** 2026-04-25
**Scope:** Complete audit of CareLog v3.0 conversational system implementation across all deployment boundaries
**Method:** Terraform validate, TypeScript/Kotlin compilation, Python syntax checks, unit test runs, file existence verification

---

## Summary

| Category | P0 | P1 | P2 | P3 | Total |
|----------|----|----|----|----|-------|
| Build Errors | 8 | 1 | 0 | 0 | 9 |
| Deployment Issues | 3 | 1 | 1 | 2 | 7 |
| Runtime Errors | 2 | 1 | 1 | 0 | 4 |
| Test Failures | 0 | 4 | 1 | 1 | 6 |
| Missing Implementations | 0 | 0 | 2 | 0 | 2 |
| Documentation Gaps | 0 | 0 | 1 | 0 | 1 |
| **Total** | **13** | **7** | **6** | **3** | **29** |

---

## Build Errors

### BE-1 [P0] Android: Missing `kotlinx.coroutines.launch` import
- **File:** `android/app/src/main/java/com/carelog/conversation/ConversationRepository.kt:348`
- **Error:** `Unresolved reference: launch` — blocks entire Android build (16 compilation errors cascade from 5 root causes)
- **Fix:** Add `import kotlinx.coroutines.launch` to imports

### BE-2 [P0] Android: `AudioTrack.SESSION_ID_CAN_GENERATE` does not exist
- **File:** `android/app/src/main/java/com/carelog/conversation/audio/AudioPlayerManager.kt:150`
- **Error:** `Unresolved reference: SESSION_ID_CAN_GENERATE`
- **Fix:** Replace with `android.media.AudioManager.AUDIO_SESSION_ID_GENERATE`

### BE-3 [P0] Android: `Alignment.Baseline` is not a valid Compose API (5 occurrences)
- **Files:**
  - `conversation/extraction/ConfirmationHandler.kt:72`
  - `conversation/extraction/ValueDisplay.kt:62`
  - `conversation/photo/VisionResultDisplay.kt:87`
  - `conversation/ui/ValueCard.kt:86, 157`
- **Error:** `Unresolved reference: Baseline` in `Row(verticalAlignment = Alignment.Baseline)`
- **Fix:** Replace `Alignment.Baseline` with `Alignment.Bottom` or use `.alignByBaseline()` modifier on individual Row children

### BE-4 [P0] Android: Missing Coil dependency for image loading
- **File:** `android/app/src/main/java/com/carelog/conversation/photo/DevicePhotoCaptureScreen.kt:40,116`
- **Error:** `Unresolved reference: coil` — `rememberAsyncImagePainter` not available
- **Fix:** Add `implementation("io.coil-kt:coil-compose:2.6.0")` to `android/app/build.gradle.kts`

### BE-5 [P0] Android: `PullToRefreshBox` requires newer Compose BOM
- **Files:**
  - `dashboard/ui/CaregiverHomeScreen.kt:51, 140, 147`
  - `dashboard/ui/PatientHomeScreen.kt:33, 91, 98`
- **Error:** `Unresolved reference: PullToRefreshBox` — requires Material3 1.3.0+ (BOM 2024.09.00+), project uses BOM 2024.06.00
- **Fix:** Upgrade Compose BOM from `2024.06.00` to `2024.09.00` in `app/build.gradle.kts`, or rewrite using the older `pullRefresh` modifier pattern

### BE-6 [P0] Web Portal: Missing `vite-env.d.ts` — 5 TypeScript errors
- **File:** `web-portal/src/vite-env.d.ts` (missing)
- **Error:** `TS2339: Property 'env' does not exist on type 'ImportMeta'` in `src/config/amplify.ts:7,8,18,19` and `src/services/api.ts:10`
- **Fix:** Create `web-portal/src/vite-env.d.ts` containing `/// <reference types="vite/client" />`

### BE-7 [P0] Web Portal: Unused variable/import blocks build
- **Files:**
  - `web-portal/src/components/patient/FilesTab.tsx:46` — unused parameter `fileType`
  - `web-portal/src/components/patient/ThresholdsTab.tsx:3` — unused import `VITAL_TYPES`
- **Error:** `TS6133` with `noUnusedLocals: true` in tsconfig
- **Fix:** Prefix `fileType` with `_`, remove `VITAL_TYPES` from import

### BE-8 [P0] Mac Mini: Missing `python-multipart` dependency
- **File:** `mac-mini/requirements.txt`
- **Error:** `RuntimeError: Form data requires "python-multipart" to be installed` — blocks vision service and test collection for `test_vision.py`
- **Fix:** Add `python-multipart>=0.0.7` to `requirements.txt`

### BE-9 [P1] Web Portal: ESLint configuration missing
- **File:** `web-portal/` (no `.eslintrc.*` or `eslint.config.*`)
- **Error:** `ESLint couldn't find a configuration file` — `npm run lint` broken
- **Fix:** Create `.eslintrc.cjs` with React/TypeScript config

---

## Deployment Issues

### DI-1 [P0] Lambda: `PATIENT_REMINDER` not in `alert_type` enum
- **File:** `backend/lambdas/check-daily-deadline/index.js:168, 180`
- **Error:** Inserts `alert_type = 'PATIENT_REMINDER'` but enum only has: `threshold_breach`, `reminder_lapse`, `system`, `missed_measurement`
- **Impact:** Every deadline reminder INSERT will fail with `invalid input value for enum alert_type`
- **Fix:** Add `ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'patient_reminder';` to V004 migration, or use existing `'reminder_lapse'` value

### DI-2 [P0] Lambda: Missing `recipient_user_id` in alerts INSERT
- **Files:**
  - `backend/lambdas/check-daily-deadline/index.js:179` — `INSERT INTO alerts (patient_id, alert_type, message, created_at)`
  - `backend/lambdas/check-missed-measurements/index.js:195` — `INSERT INTO alerts (patient_id, alert_type, vital_type, message, created_at)`
- **Error:** `alerts.recipient_user_id` is `NOT NULL` — both INSERTs omit it
- **Impact:** Every alert creation will fail with NOT NULL constraint violation
- **Fix:** Include `recipient_user_id` (available as `row.user_id` in query results) in INSERT statements

### DI-3 [P0] V004 Migration: `recommendations` table missing `updated_at` column
- **File:** `backend/database/migrations/V004__conversational_system.sql:136-151`
- **Error:** `manage-recommendations` Lambda SELECTs `r.updated_at` (line 129) and SETs `updated_at = NOW()` (line 191), but the column doesn't exist in the table definition
- **Fix:** Add `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` to the `recommendations` table and add an update trigger

### DI-4 [P1] Terraform: Duplicate EventBridge Lambda permissions
- **Files:**
  - `infrastructure/terraform/modules/lambda/main.tf:1192-1204` — creates `aws_lambda_permission` with `statement_id = "AllowEventBridgeInvoke"`
  - `infrastructure/terraform/modules/eventbridge/main.tf:21-27, 44-50` — creates same permissions with same `statement_id`
- **Error:** Two permissions with same `statement_id` on same Lambda = conflict at apply time
- **Fix:** Remove lines 1188-1204 from `modules/lambda/main.tf` (EventBridge module versions are better — they include `source_arn`)

### DI-5 [P2] Terraform: Raw interactions bucket not wired to Lambda
- **Files:**
  - `infrastructure/terraform/main.tf` — doesn't pass `raw_interactions_bucket_name` to Lambda module
  - `infrastructure/terraform/modules/lambda/main.tf:724` — `store_interaction` uses `S3_RAW_BUCKET = var.documents_bucket_name`
- **Error:** Raw interactions stored in wrong bucket (documents bucket instead of purpose-built raw_interactions bucket with HIPAA lifecycle policies)
- **Fix:** Pass `module.s3.raw_interactions_bucket_name` to Lambda module; update env var

### DI-6 [P3] Terraform: Unused variables
- **File:** `infrastructure/terraform/variables.tf`
- **Error:** `cognito_user_pool_name` (line 52) and `enable_waf` (line 92) defined but never referenced
- **Fix:** Remove unused variables

### DI-7 [P3] Terraform: Monitoring module disabled in dev
- **File:** `infrastructure/terraform/environments/dev/main.tf`
- **Error:** No `alert_email` set, so monitoring module (CloudWatch alarms, dashboard) is never created in dev
- **Fix:** Consider adding optional `alert_email` variable for dev

---

## Runtime Errors

### RE-1 [P0] Lambda: `check-missed-measurements` inserts non-enum `vital_type` values
- **File:** `backend/lambdas/check-missed-measurements/index.js:196`
- **Error:** Inserts `parameter_configs.parameter_name` (e.g., `'body_weight'`, `'blood_glucose'`) into `alerts.vital_type` column, but enum values are: `blood_pressure_systolic`, `blood_pressure_diastolic`, `glucose`, `temperature`, `weight`, `pulse`, `spo2`
- **Impact:** Will fail at runtime for parameters whose names don't match enum values
- **Fix:** Add a mapping from parameter_name to vital_type enum, or extend the enum, or pass NULL (column is nullable)

### RE-2 [P0] Lambda: `evaluate-thresholds-batch` inconsistent response shape
- **File:** `backend/lambdas/evaluate-thresholds-batch/index.js:151`
- **Error:** Early return path returns `{ breaches: [], message: '...' }` but normal path returns `{ breaches_found: <count>, ... }`. Callers checking `breaches_found` get `undefined` on early return.
- **Fix:** Change early return to `{ breaches: [], breaches_found: 0, message: '...' }`

### RE-3 [P1] Mac Mini: No Mac Mini hardware available
- **Impact:** The entire conversational voice flow (STT, LLM, TTS, Vision) cannot function end-to-end without a provisioned Mac Mini M4. The Android app's conversation button will be disabled (health check fails). Photo-based readings won't work. This blocks E2E testing of scenarios E2E-1 through E2E-9.
- **Workaround:** Android app gracefully degrades — shows "Mac Mini Offline" status and disables conversation. All cloud features (auth, FHIR storage, alerts, web portal) work independently.

### RE-4 [P2] API Gateway: No CORS OPTIONS methods
- **File:** `infrastructure/terraform/modules/api_gateway/main.tf`
- **Error:** No OPTIONS methods with MOCK integrations for CORS preflight. Web portal browser calls may fail CORS.
- **Fix:** Add OPTIONS methods with CORS headers on each resource, or migrate to HTTP API Gateway (built-in CORS)

---

## Test Failures

### TF-1 [P1] Lambda: Mock pollution causes 20 test failures across 5 suites
- **Files:**
  - `backend/lambdas/evaluate-thresholds-batch/__tests__/index.test.js` (1 failure)
  - `backend/lambdas/check-daily-deadline/__tests__/index.test.js` (3 failures)
  - `backend/lambdas/manage-recommendations/__tests__/index.test.js` (6 failures)
  - `backend/lambdas/manage-parameter-configs/__tests__/index.test.js` (7 failures)
  - `backend/lambdas/manage-interactions/__tests__/index.test.js` (3 failures)
- **Error:** `jest.clearAllMocks()` doesn't clear queued `mockResolvedValueOnce` implementations. Unconsumed mocks from "returns 404" tests leak into subsequent tests.
- **Fix:** Replace `jest.clearAllMocks()` with `jest.resetAllMocks()` in all `beforeEach` blocks

### TF-2 [P1] Lambda: `check-daily-deadline` tests are time-dependent
- **File:** `backend/lambdas/check-daily-deadline/__tests__/index.test.js:143, 167, 203`
- **Error:** Tests set `earliest_deadline: '10:00:00'` but use real wall clock time. Pass after 10:00 local time, fail before.
- **Fix:** Mock `getCurrentTimeInTimezone()` to return a fixed time, or use `jest.useFakeTimers()`

### TF-3 [P1] Mac Mini: 39 LLM test failures due to missing TMP_DIR
- **File:** `mac-mini/tests/test_llm.py` (fixture at line 48)
- **Error:** Session creation returns HTTP 500 — `session.tmp_dir.mkdir()` tries to create `/opt/carelog/tmp/<session_id>` which doesn't exist in test environment
- **Fix:** Mock `TMP_DIR` in test fixture: `with patch("llm_service.TMP_DIR", Path(tempfile.mkdtemp())): yield`

### TF-4 [P1] Test Automation: TypeScript syntax errors in compliance tests
- **Files:**
  - `test-automation/compliance/access-control-verify.ts:321, 440` — trailing comma before ternary colon
  - `test-automation/compliance/encryption-verify.ts:216` — same issue
- **Error:** `TS1005: ':' expected` — blocks `npx tsc --noEmit`
- **Fix:** Remove trailing commas before `: undefined` in ternary expressions

### TF-5 [P2] Lambda: `notification-sender` has no tests
- **File:** `backend/lambdas/notification-sender/` — no `__tests__/` directory
- **Error:** Despite having jest as devDependency, no test files exist
- **Fix:** Create `__tests__/index.test.js` covering SQS processing, FCM dispatch, error handling

### TF-6 [P3] Mac Mini: pytest `asyncio_mode` config warning
- **File:** `mac-mini/pyproject.toml`
- **Error:** `PytestConfigWarning: Unknown config option: asyncio_mode` — missing `pytest-asyncio`
- **Fix:** Install `pytest-asyncio` or remove `asyncio_mode` from config

---

## Missing Implementations

### MI-1 [P2] Web Portal: Zero test files
- **File:** `web-portal/src/` — no `*.test.*` or `*.spec.*` files anywhere
- **Error:** `npm run test` finds no tests. Agent spec requires Vitest + React Testing Library tests for all new components.
- **Fix:** Write unit tests for ProtocolTab, RecommendationsTab, InteractionsTab, ParameterConfigForm, RecommendationForm, TranscriptViewer

### MI-2 [P2] Android: Tests could not run (compilation blocked)
- **Impact:** Cannot verify Android unit test coverage because build fails (see BE-1 through BE-5). Once build errors are fixed, tests should be re-run.
- **Fix:** Fix build errors first, then audit test results

---

## Documentation Gaps

### DG-1 [P2] Deployment Guide: Mac Mini model download URLs are placeholders
- **File:** `mac-mini/deploy/provision.sh:29-34`
- **Error:** All 6 `MODEL_*_URL` variables point to `https://models.example.com/...` — these are placeholder URLs that will fail on actual provisioning
- **Impact:** Section 4.2 of the deployment guide says "update the model download URLs" but doesn't provide actual URLs or a download procedure
- **Fix:** Document the actual model sources (Hugging Face, etc.) and download instructions for each model

---

## Lambda Test Results Matrix

| Lambda | Tests | Pass | Fail | Status |
|--------|-------|------|------|--------|
| fetch-session-config | 7 | 7 | 0 | PASS |
| construct-fhir-batch | 17 | 17 | 0 | PASS |
| store-interaction | 12 | 12 | 0 | PASS |
| evaluate-thresholds-batch | 17 | 16 | 1 | FAIL (mock pollution) |
| check-daily-deadline | 14 | 11 | 3 | FAIL (time-dependent + mock) |
| check-missed-measurements | 13 | 13 | 0 | PASS |
| manage-recommendations | 10 | 4 | 6 | FAIL (mock pollution) |
| manage-parameter-configs | 11 | 4 | 7 | FAIL (mock pollution) |
| manage-interactions | 9 | 6 | 3 | FAIL (mock pollution) |
| manage-prompts | 8 | 8 | 0 | PASS |
| notification-sender | 0 | 0 | 0 | NO TESTS |

## Mac Mini Test Results Matrix

| Suite | Tests | Pass | Fail | Status |
|-------|-------|------|------|--------|
| test_health.py | ~25 | 25 | 0 | PASS |
| test_stt.py | ~30 | 30 | 0 | PASS |
| test_llm.py | ~60 | 21 | 39 | FAIL (TMP_DIR) |
| test_tts.py | ~40 | 40 | 0 | PASS |
| test_vision.py | ~35 | 35 | 0 | PASS (after python-multipart install) |

---

## Priority Fix Order

**Immediate (blocks any deployment):**
1. DI-1: Add `patient_reminder` to `alert_type` enum in V004
2. DI-2: Add `recipient_user_id` to alerts INSERTs
3. DI-3: Add `updated_at` column to `recommendations` table
4. DI-4: Remove duplicate EventBridge Lambda permissions from lambda/main.tf

**Before Android release:**
5. BE-1: Add `launch` import
6. BE-2: Fix `AudioTrack.SESSION_ID_CAN_GENERATE`
7. BE-3: Replace `Alignment.Baseline` (5 files)
8. BE-4: Add Coil dependency
9. BE-5: Upgrade Compose BOM

**Before web portal release:**
10. BE-6: Create `vite-env.d.ts`
11. BE-7: Fix unused variable/import

**Before Mac Mini deployment:**
12. BE-8: Add `python-multipart` to requirements.txt

**Before test runs:**
13. TF-1: Switch to `jest.resetAllMocks()` across all test suites
14. TF-3: Mock TMP_DIR in LLM test fixture
15. TF-4: Fix ternary syntax in compliance tests

---

*Generated by full codebase audit — 2026-04-25*

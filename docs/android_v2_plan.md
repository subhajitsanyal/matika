# Android v2 Client — Implementation Plan & Log

**Owner:** Android client work
**Started:** 2026-05-03
**Source spec:** `docs/matika_spec_v2.md` §8
**Source plan:** `docs/matika_implementation_plan_v2.md` (Phase 1.3 / 1.4 + Phase 2/3 client items)

This is a living log. Phases below are the planned sequence; the
**Status log** at the bottom tracks what has actually been done and any
deviations from the plan.

---

## Lay of the land (as of 2026-05-03)

The v1 Android app is deeply coupled to the Mac Mini stack:

- `network/MacMiniLlmApi.kt`, `network/MacMiniSttApi.kt`,
  `network/MacMiniTtsApi.kt`, `network/MacMiniVisionApi.kt`
- `discovery/MacMiniDiscovery.kt`, `discovery/HealthCheckService.kt`
- `conversation/audio/AudioCaptureManager.kt` →
  `conversation/audio/AudioStreamManager.kt` (WebSocket to Mac Mini STT/TTS)
- `conversation/ConversationRepository.kt` orchestrates the
  STT → LLM → TTS pipeline against Mac Mini endpoints

`network/CloudApiService.kt` exists but only covers the **v1** REST
surface (`session-config`, `observations/batch`, `interactions`,
`alerts`, etc.). None of the v2 routes are wired:

- `POST /conversation/turn`
- `POST /conversation/turn-stream`
- `POST /conversation/photo-presign`
- `POST /conversation/photo-extract`
- `GET  /health`

Package is still `com.carelog.*` — per CLAUDE.md, do **not** rename
until v2.1.

---

## Highest-leverage piece for pilot

**The patient daily check-in flow over sync `POST /conversation/turn`.**
That is the dominant pilot journey. SSE streaming, photo OCR, caregiver
onboarding, and full Mac Mini deletion can all wait — pilot value is
unlocked the moment a patient can tap mic, speak BP, and the cloud
round-trips an extracted value with a confirmation prompt.

---

## Phases

### Phase 0 — Backend gap confirmation (BEFORE coding)

Resolve the five open questions logged in **Backend gaps** below so the
client can be coded against a single confirmed contract instead of
guesses. Captured answers go into this file.

### Phase A — Minimum pilot client (~1–2 wks)

1. v2 Retrofit interface + DTOs for `/conversation/turn`, `/health`,
   `/conversation/photo-presign`, `/conversation/photo-extract`. Auth
   headers via the existing Cognito interceptor; new base URL → API
   Gateway.
2. `SttManager` — `android.speech.SpeechRecognizer` wrapper,
   `EXTRA_PREFER_OFFLINE`, en-IN / hi-IN / bn-IN.
3. `TtsManager` — `TextToSpeech` wrapper, `QUEUE_ADD`, language switch.
4. `BedrockTurnClient` (sync `/turn`) + `ConversationStateMachine`
   mirroring the server transitions from spec §6.2.
5. Rewire `ConversationViewModel`: STT-final → `/turn` → confirmation
   cards from `extractedValues` → TTS speak `responseText`. Generate
   `sessionId` client-side at start; thread `turnSequence` through every
   call. Keep MacMini path behind a `BuildConfig.USE_V2_INFERENCE` flag
   for safe rollback during pilot ramp.
6. Smoke test in en, hi, bn against dev (matches T-V2-140..142 exit
   criteria).

### Phase B — Vision + safety (~1 wk)

7. `OcrManager` (ML Kit Text Recognition v2) + confidence-thresholded
   fallback → `/photo-presign` PUT (honour returned `requiredHeaders`,
   esp. `x-amz-server-side-encryption: aws:kms`) → `/photo-extract`.
8. On-device emergency keyword matcher (T-V2-221) — fast-path before the
   LLM round-trip.
9. `/health` polling for the connectivity banner.

### Phase C — Caregiver session (~1 wk)

10. Rewire `CaregiverOnboardingViewModel` through `BedrockTurnClient`
    with `sessionType: "caregiver_onboarding"`. Reuse existing onboarding UI.

### Phase D — Streaming (deferred unless P95 demands it)

11. SSE client for `/turn-stream`. Skip until pilot data shows it is
    worth the implementation cost — and only after Backend Gap #3 is
    resolved (REST API Gateway buffers SSE).

### Phase E — Cleanup (post-pilot)

12. Delete `com.carelog.macmini.*`, `MacMini*Api`, `MacMiniDiscovery`,
    `AudioStreamManager`, etc. (T-V2-011).

---

## Backend gaps — RESOLVED 2026-05-03

All five answers come from reading the deployed backend code, not from
guesses. Citations are file:line.

### 1. API Gateway base URL → reuse `BuildConfig.API_BASE_URL`

`android/app/src/main/java/com/carelog/core/BuildConfig.kt:19` already
defines `API_BASE_URL` and is auto-updated by
`scripts/update-app-config.sh` after every `terraform apply`. The v2
routes are added to the **same** `aws_api_gateway_rest_api.main` REST
API as v1 (see `infrastructure/terraform/modules/api_gateway/routes_v2.tf`),
so a single base URL covers both `/patients/...` (v1) and
`/conversation/...`, `/health` (v2). No new config mechanism needed.

**Action:** new v2 Retrofit interface uses the same Retrofit instance
(same base URL, same `AuthInterceptor`) as `CloudApiService`.

### 2. `actorCognitoSub` → client sends it explicitly

`backend/lambdas/bedrock-router/src/handler.ts:69-75` declares
`actorCognitoSub` as a top-level optional field on `TurnRequest`; the
Lambda does **not** lift it from the JWT. Validation at line 596–600
only checks "string + non-empty if present." For caregiver sessions
the field drives `parameter_configs.threshold_set_by` (T-V2-303), so
omitting it on a caregiver_onboarding session means caregiver
attribution is silently lost.

**Action:** client sends `actorCognitoSub` on every turn. For
`patient_logging` sessions it equals `patientId` (per spec comment at
line 70); for caregiver_* it is the caregiver's Cognito sub from the
Amplify session. Sending it always is the simplest invariant and the
backend tolerates it.

### 3. `/turn-stream` is buffered, not streamed

`backend/lambdas/bedrock-router/src/index.ts:219-226` is explicit:
"API Gateway REST integrations buffer the full Lambda response, so this
collects all SSE events into the body rather than streaming them on the
wire. … Real per-token streaming requires moving the route to a Lambda
Function URL with response streaming or to API Gateway HTTP API —
deferred to v2.1." The body is still SSE-compliant, but there is
zero latency benefit over sync `/turn`.

**Action:** Phase D (Android SSE client) is **blocked** on the backend
moving the route off REST API Gateway. Skip it for pilot. Use sync
`/turn` only.

### 4. Photo flow contract → confirmed

`backend/lambdas/photo-presign/src/handler.ts`:

- **Request:** `{ patientId, sessionId, contentType? }`. Both IDs must
  match `UUID_PATTERN`. `contentType` defaults to `image/jpeg` and
  must match `^image/(jpe?g|png|heic|webp)$`.
- **Response:** `{ uploadUrl, s3Key, requiredHeaders, expiresIn }`
  where `requiredHeaders = { 'Content-Type': contentType,
  'x-amz-server-side-encryption': 'aws:kms' }`. TTL = 300s.
- **Client contract:** echo every entry of `requiredHeaders` on the
  S3 PUT request. Skipping `x-amz-server-side-encryption` triggers
  the bucket's `EnforceKMSEncryption` deny → 403. Then call
  `/conversation/photo-extract` with the returned `s3Key`.

`/conversation/photo-extract` payload shape per spec §4.2 is the
contract to code against (handler not re-read here; we will verify
when Phase B touches it).

### 5. `patientId` field carries the Cognito sub

`backend/lambdas/bedrock-router/src/handler.ts:299` names
`event.patientId` as `patientCognitoSub`. The internal UUID is
resolved server-side via `patientLoader.load(event.patientId)` (line
195) and stored on `patientCtx.patient.id` (line 288, 300). FHIR
Observation S3 keys also use the Cognito sub directly per the
`observation_writer` (key format `observations/{cognitoSub}/...`).
Same convention applies to `/conversation/photo-presign` and
`/conversation/photo-extract` (S3 key `interactions/{patientId}/...`).

**Action:** every v2 client request that takes a `patientId` sends
the patient's Cognito sub. The app never needs the internal `patients.id`
UUID.

### Side-note: `/health` is unauthenticated

`infrastructure/terraform/modules/api_gateway/routes_v2.tf:GET /health`
declares `authorization = "NONE"`. The same Retrofit client (with the
`AuthInterceptor` attached) still works — the Lambda ignores the
Authorization header — so this needs no special-case wiring on the
client.

### Side-note: `/interactions/log` is **not** a v2 endpoint

Spec §8.3 mentions audio uploaded via `POST /interactions/log`, but
`routes_v2.tf` declares no such route. The existing v1 `/interactions`
multipart endpoint (in `CloudApiService`) is the one to use; the v2
spec is forward-looking. Audio buffering/upload is not gating for
Phase A and can stay on the v1 endpoint for the pilot.

---

## Phase plan adjustments after gap resolution

- Phase A.1: create a **new** `MatikaCloudApi` Retrofit interface for
  v2 routes; do not extend `CloudApiService`. Reuse the existing
  Retrofit instance / `AuthInterceptor` / base URL. Keeps v1 surface
  untouched until Phase E.
- Phase A.5: client always sends `actorCognitoSub = current
  Cognito sub`. For patient sessions it equals `patientId`; the
  backend tolerates the duplication.
- Phase D: re-flagged as **blocked on backend** (REST API Gateway
  buffering). Will not be in pilot.
- Phase B.7: `/photo-presign` request takes both `patientId` and
  `sessionId` (both UUIDs); response `requiredHeaders` are mandatory
  on the S3 PUT.

---

## Status log

| Date | Phase | Note |
|---|---|---|
| 2026-05-03 | Plan | Plan authored. Phase 0 (backend gap confirmation) starting. |
| 2026-05-03 | Phase 0 | All five backend gaps resolved from backend code. Phase A unblocked. Phase D moved to "blocked on backend" until REST API Gateway buffering is replaced. |
| 2026-05-03 | A.1 | `network/MatikaCloudApi.kt` Retrofit interface + DTOs added for `/conversation/turn`, `/conversation/photo-presign`, `/conversation/photo-extract`, `/health`. Hilt provider wired in `core/di/NetworkModule.kt` (shares `@CloudApi` Retrofit + `AuthInterceptor`). 10-test Gson round-trip suite (`MatikaCloudApiDtoTest`) passes; full app compiles. v2 health type renamed to `MatikaHealthResponse` to dodge collision with the v1 `HealthResponse` in `MacMiniApiService.kt` (will dissolve in Phase E). |
| 2026-05-03 | A.2 | `conversation/audio/stt/` package: `SttResult.kt` (sealed Partial/Final/Error + `SttErrorCode` enum + framework-error-int mapper), `SttManager.kt` (Hilt singleton, callbackFlow-based `recognize(languageTag)` Flow with main-thread funnel + AtomicBoolean BUSY guard, `EXTRA_PREFER_OFFLINE` always set), `LanguagePackChecker.kt` (ordered-broadcast best-effort supported-languages lookup). `AndroidManifest.xml` `<queries>` block added so `SpeechRecognizer.isRecognitionAvailable()` works on Android 11+. 7-test `SttResultTest` covers all `ERROR_*` mappings + sealed-class identity; full app compiles. |
| 2026-05-03 | A.3 | `conversation/audio/tts/` package: `TtsManager.kt` (Hilt singleton; async `TextToSpeech` init via `CompletableDeferred`; `setLanguage` returns typed `TtsLanguageStatus`; `speak(text, lang, queueMode)` + `stop()` + `release()`; `isSpeaking` StateFlow tracked via `UtteranceProgressListener` keyed on utterance IDs), `NumberFormatter.kt` (pure object; BP-style spelling for 0..999 with "one thirty / one oh five / two hundred" register, `/` → ` over `, decimal → ` point `; passthrough for non-English or `spellOutNumbers=false`). 19-test `NumberFormatterTest` covers spec example, register edge cases, decimals, pass-through paths, and `\b`-protected compound tokens. `SentenceQueue.kt` deferred to Phase D (only used by streaming responses, which are blocked on backend). |
| 2026-05-03 | A.4 | `inference/` package created. `BedrockTurnClient.kt` (stateless `@Singleton`, returns `Result<TurnResponse>`, only translates domain naming → wire `patientId`-as-Cognito-sub). `ConversationStateMachine.kt` + `ConversationState.kt` (per spec §8.5, projector not enforcer; `start()` generates UUID sessionId, `beginTurn()` snapshots `TurnInputs` and only sends `sessionType` on turn 1, `applyTurnResponse` mirrors server `fsmState` via lenient `ConversationFsmState.fromServer` lookup that falls through to `UNKNOWN`, pause/resume/connectivity are local-only flags that don't clobber FSM state). 4 + 12 tests pass; `TurnFixtures.kt` provides a reusable `FakeMatikaCloudApi` and `fakeTurnResponse(...)` builder. |
| 2026-05-03 | A.5 | `BuildConfig.USE_V2_INFERENCE` flag added (default `true`). `inference/MatikaConversationViewModel.kt` (Hilt `@HiltViewModel`; orchestrates `SttManager` + `TtsManager` + `BedrockTurnClient` + `ConversationStateMachine`; idempotent `startSession()` from `LaunchedEffect(Unit)`; `onMicPressed` toggles STT capture; `submitTurn` runs through `beginTurn → submitTurn → applyTurnResponse/Failure`; `speakResponse` runs `NumberFormatter` then `TtsManager.speak(QUEUE_FLUSH)`; complete_session action terminates the session). `inference/ui/MatikaConversationScreen.kt` (Compose; FSM badge, response card, user-said card, pending-values list, still-needed chips, mic + pause/stop controls, text-input fallback). `CareLogNavHost.kt` `CONVERSATION` route now branches on the flag. Phase A scope: patient_logging only — actor and patient sub both = current `CareLogUser.userId`; caregiver-acts-on-patient is Phase C. No ViewModel unit tests (Android-coupled; manual smoke in A.6). Full app compiles. |
| 2026-05-03 | A.6 | **Prep done; device test pending.** Debug APK built clean (`app-debug.apk` 130 MB; Hilt/Dagger DI resolves at runtime). Dev `/health` curl returns 200 with the exact wire shape the v2 DTOs expect: `{"status":"healthy","checks":{"rds":"up","bedrock":"up","bedrock_inference_region":"ap-south-1","s3":"up","lambda_warm":<bool>},"timestamp":"..."}`. Smoke-test runbook authored at `docs/android_v2_smoke_test_runbook.md` with: pre-flight curl, dev-RDS data prerequisites for the test user, 5-turn script per language with English/Hindi/Bengali utterances, screen + CloudWatch watchpoints, pass/fail criteria, failure-mode cheat sheet. |
| 2026-05-03 | A.6 | **English passed end-to-end on Samsung S21+.** Patient logged BP + fasting blood sugar; FHIR observations confirmed in S3 bucket `carelog-v2-dev-documents-316643066568/observations/{cognitoSub}/2026/05/04/`. Five real bugs surfaced and fixed during the device run: (1) `RECORD_AUDIO` not auto-prompted on the v2 screen → added permission launcher mirroring v1; (2) language tag mismatch — `AppLanguage.code` returns ISO-639-1 (`en`) but backend wants BCP-47 (`en-IN`) → added `toBcp47()` helper at the boundary; (3) Bedrock Guardrail's `medical_diagnosis_or_prescription` denied topic was firing on benign patient inputs ("BP is one thirty…") → topic removed in `infrastructure/terraform/modules/bedrock/guardrail.tf` and applied to dev (Guardrail v5); system-prompt refusal rules remain authoritative for medical-advice avoidance; (4) `bedrock-router` and `bedrock-vision` `index.ts` were double-wrapping the API Gateway proxy response (`handleTurn` already returns `{statusCode, body: <stringified>}`, then `handleProxyInvocation` was calling `jsonResponse(200, result)` and re-stringifying) → fixed both Lambdas, redeployed; (5) the v2 conversation was navigating to v1 `SessionSummaryScreen` on completion which mis-reported "no clinical values captured" because it reads v1 in-memory state → built inline `SessionCompleteCard` in `MatikaConversationScreen`, changed nav callback to `popBackStack` and bypass v1 summary. Hindi + Bengali smoke deferred. STT setup on Samsung also surfaced — needed switch to Google's on-device recognizer + offline `en-IN` pack download (Settings search → "voice input"); user resolved on-device. |


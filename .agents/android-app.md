# Agent: Android App

## Role

You are the **Android App** agent. You build the Kotlin/Jetpack Compose mobile application that serves both patient and caregiver personas. The app captures voice on-device (Google `SpeechRecognizer`), reads photos on-device (Google ML Kit), speaks responses on-device (Android `TextToSpeech`), and calls the AWS cloud backend over HTTPS for all conversational reasoning, persistence, and notifications.

## Owned Directories

```
android/app/src/main/java/com/matika/        # Brand rename to com.matika.* deferred to v2.1
├── core/
│   ├── MatikaApplication.kt
│   ├── di/
│   │   ├── NetworkModule.kt           # Single Retrofit instance + SSE consumer (cloud only)
│   │   ├── AudioModule.kt             # STT + TTS providers
│   │   └── VisionModule.kt            # ML Kit OCR provider
│   └── config/
│       └── AppSettings.kt             # Language, accessibility, telemetry opt-in
│
├── connectivity/
│   ├── CloudHealthChecker.kt          # GET /health polling (30s active, 5min idle)
│   └── ConnectivityState.kt           # HEALTHY | RECONNECTING | DEGRADED
│
├── audio/
│   ├── stt/
│   │   ├── SttManager.kt              # SpeechRecognizer wrapper, EXTRA_PREFER_OFFLINE
│   │   ├── SttResult.kt               # Sealed: Final, Partial, Error
│   │   └── LanguagePackChecker.kt     # Detect + prompt for offline pack downloads
│   └── tts/
│       ├── TtsManager.kt              # TextToSpeech wrapper
│       ├── SentenceQueue.kt           # Buffers sentences from streaming responses
│       └── NumberFormatter.kt         # Pre-format numbers for natural readout
│
├── vision/
│   ├── OcrManager.kt                  # ML Kit Text Recognition v2 wrapper
│   └── DigitExtractor.kt              # Numeric extraction with confidence threshold
│
├── inference/
│   ├── BedrockClient.kt               # Retrofit + SSE client for /conversation/turn(-stream)
│   ├── SseConsumer.kt                 # Custom SSE parser for streamed turns
│   ├── PhotoExtractClient.kt          # Client for /conversation/photo-extract
│   ├── ConversationTurnRepository.kt
│   └── ConversationStateMachine.kt    # Mirrors server state machine for UI
│
├── conversation/
│   ├── ConversationViewModel.kt       # Single source of truth for session state
│   ├── ConversationRepository.kt      # Coordinates STT → cloud → TTS pipeline
│   ├── session/
│   │   ├── SessionManager.kt
│   │   ├── SessionState.kt
│   │   └── EmergencyKeywordMatcher.kt # On-device fast-path emergency detection
│   ├── extraction/
│   │   ├── ValueDisplay.kt
│   │   └── ConfirmationHandler.kt
│   ├── photo/
│   │   ├── DevicePhotoCaptureScreen.kt
│   │   ├── OnDeviceOcrFlow.kt         # ML Kit first; cloud fallback
│   │   └── VisionResultDisplay.kt
│   └── ui/
│       ├── ConversationScreen.kt
│       ├── ConversationControls.kt
│       ├── TranscriptView.kt
│       ├── ValueCard.kt
│       ├── ReconnectingBanner.kt
│       └── SessionSummaryScreen.kt
│
├── onboarding/
│   ├── CaregiverOnboardingViewModel.kt
│   ├── PatientSetupViewModel.kt
│   ├── ProtocolConfigViewModel.kt
│   ├── consent/
│   │   ├── ConsentV2Screen.kt         # DPDP v2.0 consent (cross-region disclosure)
│   │   └── ConsentRecorder.kt
│   ├── languagepacks/
│   │   └── LanguagePackOnboardingScreen.kt  # Prompts for offline STT/TTS pack download
│   └── ui/
│       ├── CaregiverRegistrationScreen.kt
│       ├── PatientOnboardingConversationScreen.kt
│       ├── ProtocolConfigConversationScreen.kt
│       └── InviteScreen.kt
│
├── dashboard/
│   ├── PatientDashboardViewModel.kt
│   ├── CaregiverDashboardViewModel.kt
│   └── ui/
│       ├── PatientHomeScreen.kt
│       ├── CaregiverHomeScreen.kt
│       └── ConnectivityBanner.kt      # Replaces v1 ModelStatusBanner
│
├── history/                            # Unchanged from v1
├── settings/                           # Unchanged from v1 (audio mode toggle removed — no streaming/batch toggle now)
├── notifications/                      # FCM, unchanged from v1
├── network/
│   ├── CloudApiService.kt             # Retrofit interface for AWS API Gateway
│   └── AuthInterceptor.kt             # Cognito JWT injection
├── fhir/                               # Unchanged from v1
└── util/                               # Unchanged from v1
```

**Removed in v2** (delete from repo):
- `discovery/` package (mDNS/NSD)
- `network/MacMiniApiService.kt`, `MacMiniSttApi.kt`, `MacMiniTtsApi.kt`, `MacMiniLlmApi.kt`, `MacMiniVisionApi.kt`
- Dual-Retrofit DI module
- `conversation/audio/AudioCaptureManager.kt`, `AudioPlayerManager.kt`, `VoiceActivityDetector.kt`, `AudioStreamManager.kt` (all replaced by on-device STT/TTS)
- "Audio mode toggle" in settings (no streaming/batch choice now — streaming is server-decided)

You do NOT touch: `backend/`, `web-portal/`, `infrastructure/terraform/`.

## Specifications

Refer to `docs/matika_spec_v2.md`:
- Section 4.1 — `bedrock-router` API contracts (sync + SSE)
- Section 4.2 — `bedrock-vision` API contract
- Section 4.3 — `health-check` API contract
- Section 6 — Conversation engine (you mirror the server state machine on the client)
- Section 8 — Mobile App Architecture (your blueprint)

## Phase Assignments

### P0 — Foundation (Weeks 1–2)
- **[T-V2-011]** Delete `com.carelog.macmini.*` package and dependents.
- **[T-V2-013]** Brand rename in `strings.xml`, app name, splash screen — to "Matika".
- Update DI graph: remove dual-Retrofit; single `CloudApi` Retrofit only.
- Build green after deletions.

### P1 — Conversational Core (Weeks 3–6)
- **[T-V2-120]** `SttManager` — `SpeechRecognizer` wrapper, `EXTRA_PREFER_OFFLINE = true`, locales `en-IN`/`hi-IN`/`bn-IN`.
- **[T-V2-121]** Language-pack onboarding flow.
- **[T-V2-122]** `TtsManager` — `TextToSpeech` wrapper, `QUEUE_ADD` mode.
- **[T-V2-123]** `SentenceQueue` for streaming TTS.
- **[T-V2-130]** `BedrockClient` — sync POST `/conversation/turn` and SSE `/conversation/turn-stream`.
- **[T-V2-131]** `ConversationViewModel` and unidirectional state from server.
- **[T-V2-132]** Conversation UI screen.
- **[T-V2-140..142]** Multilingual end-to-end validation (en, hi, bn).

### P2 — Vision + Escalation (Weeks 7–8)
- **[T-V2-200..202]** ML Kit OCR; on-device-first, cloud fallback flow.
- **[T-V2-221]** On-device `EmergencyKeywordMatcher` — regex against transcript; immediate emergency UI + caregiver alert without waiting for Bedrock.

### P3 — Caregiver Experience (Weeks 9–11)
- Caregiver onboarding screen with consent v2.0 capture (cross-region inference disclosure).
- Caregiver dashboard (reuse v1 components).

### P4 — Integration & Polish (Weeks 12–14)
- UI accessibility audit (touch targets ≥ 48dp, 72dp+ primary, WCAG AA contrast).
- Pipeline timing instrumentation (new t-stages — see qa-testing agent for the new model).
- Connectivity-loss UX: "Reconnecting…" banner; resume from last confirmed turn.

## Key Design Decisions

1. **Single network layer**: One Retrofit instance for the cloud only. No LAN, no mDNS, no dual config. Removes ~30% of v1's networking complexity.
2. **On-device audio I/O**: STT and TTS use OS-native engines. Audio never transits the cloud — only transcripts and response text do. This is a privacy *upgrade* over v1 (which streamed raw audio over LAN to Mac Mini).
3. **Streaming via SSE**: Server decides streaming per-turn. App's SSE consumer dispatches `token` events for transcript-reveal animation, `sentence` events to TTS queue, `action` events for state machine, `extracted` events for value-card UI.
4. **Sentence-buffered TTS**: TTS plays each sentence as it arrives from the SSE stream. `QUEUE_ADD` keeps subsequent sentences pending; barge-in flushes the queue.
5. **Server is the state machine source of truth**: App mirrors but does not authoritatively mutate. Every turn round-trips state.
6. **Emergency fast path**: On-device keyword matcher fires immediately on transcript completion; emergency UI shows before the LLM response arrives. Server-side Guardrails are second line.
7. **Consent v2.0 required**: First v2 launch forces re-consent including cross-region inference disclosure. Existing v1 consent records are invalidated.
8. **Photo path**: ML Kit first, ~150ms on-device. Confidence < 0.85 OR multi-block ambiguity → upload to S3 (presigned URL from `bedrock-router` issued at session start) → call `/conversation/photo-extract`.

## Dependencies

| What I need | From whom | When |
|---|---|---|
| `POST /conversation/turn` and `/turn-stream` deployed | backend | P1 |
| `POST /conversation/photo-extract` deployed | backend | P2 |
| `GET /health` deployed | backend | P0 |
| Cognito groups (`patients`, `caregivers`, `doctors`) | backend | P0 |
| FCM configured | devops | P3 |
| Consent v2.0 text | (PRD owner / legal) | P3 |

| What I provide | To whom | When |
|---|---|---|
| FCM device token registration | backend (`device-token` Lambda) | P3 |
| Pipeline timing instrumentation | qa-testing | P4 |

## Testing

- **Unit**: JUnit 5 + MockK + Turbine. Coverage on `SttManager`, `TtsManager`, `SentenceQueue`, `OcrManager`, `DigitExtractor`, `BedrockClient`, `SseConsumer`, `EmergencyKeywordMatcher`, `ConversationViewModel`, `ConversationStateMachine`.
- **Instrumentation**: Compose UI tests for conversation flow, onboarding, consent, language-pack download.
- **Mock cloud**: For tests, mock `CloudApiService` to return canned JSON / SSE event streams matching the spec contracts.

## Constraints

- Kotlin, Jetpack Compose, Hilt DI.
- Min Android 9 (API 28). Google Play Services current required (for ML Kit, `SpeechRecognizer` quality).
- Touch targets: 48x48dp min, 72dp+ primary.
- Contrast: WCAG AA (4.5:1).
- No PHI in Logcat or crash reports. Audio buffers cleared after upload-ack.
- Tokens in Android Keystore.
- Certificate pinning on cloud API calls (`*.execute-api.ap-south-1.amazonaws.com`).
- Offline language packs (~100 MB across en/hi/bn STT+TTS) — disclose in Play Store listing.
- Microphone is released between turns (clear "your turn" / "system's turn" UX state).

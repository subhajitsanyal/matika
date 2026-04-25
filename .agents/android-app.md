# Agent: Android App

## Role

You are the **Android App** agent. You build the Kotlin/Jetpack Compose mobile application that serves both patient and caregiver personas. The app communicates directly with the Mac Mini over LAN for AI inference and with the AWS cloud backend over HTTPS for persistence.

## Owned Directories

```
android/app/src/main/java/com/carelog/
├── core/
│   ├── CareLogApplication.kt          # Hilt app, Amplify init
│   ├── di/
│   │   ├── NetworkModule.kt            # Dual Retrofit instances (LAN + WAN)
│   │   ├── AudioModule.kt              # Audio capture/playback providers
│   │   └── ServiceDiscoveryModule.kt   # mDNS/NSD provider
│   └── config/
│       └── AppSettings.kt             # Settings: streaming/batch, language, Mac Mini URL
│
├── discovery/
│   ├── MacMiniDiscovery.kt            # NSD (mDNS/Bonjour) service discovery
│   ├── HealthCheckService.kt          # Polls /health every 10s
│   └── ModelStatus.kt                 # Data class for service status
│
├── conversation/
│   ├── ConversationViewModel.kt       # Main session orchestrator
│   ├── ConversationRepository.kt      # Coordinates STT → LLM → TTS pipeline
│   ├── session/
│   │   ├── SessionManager.kt          # Start/pause/resume/stop lifecycle
│   │   ├── SessionState.kt            # UI state: confirmed values, pending, remaining
│   │   └── PauseTimeoutHandler.kt     # 5-minute pause → stop timer
│   ├── audio/
│   │   ├── AudioCaptureManager.kt     # Mic recording → PCM buffer
│   │   ├── AudioPlayerManager.kt      # PCM playback (TTS response)
│   │   ├── VoiceActivityDetector.kt   # Silence detection for batch mode
│   │   ├── AudioStreamManager.kt      # WebSocket streaming for STT/TTS
│   │   └── AudioFormat.kt             # PCM 16kHz constants
│   ├── extraction/
│   │   ├── ValueDisplay.kt            # Visual display of extracted values
│   │   └── ConfirmationHandler.kt     # Value confirmation flow
│   ├── photo/
│   │   ├── DevicePhotoCaptureScreen.kt # Camera capture for device readings
│   │   └── VisionResultDisplay.kt     # Show extracted readings with bounding boxes
│   └── ui/
│       ├── ConversationScreen.kt      # Main conversation UI
│       ├── ConversationControls.kt    # Start / Pause / Stop buttons
│       ├── TranscriptView.kt          # Live transcript display
│       ├── ValueCard.kt               # Confirmed value display card
│       └── SessionSummaryScreen.kt    # End-of-session summary
│
├── onboarding/
│   ├── CaregiverOnboardingViewModel.kt
│   ├── PatientSetupViewModel.kt
│   ├── ProtocolConfigViewModel.kt
│   └── ui/
│       ├── CaregiverRegistrationScreen.kt
│       ├── PatientOnboardingConversationScreen.kt
│       ├── ProtocolConfigConversationScreen.kt
│       ├── PatientProfileConfirmationScreen.kt
│       └── InviteScreen.kt
│
├── dashboard/
│   ├── PatientDashboardViewModel.kt
│   ├── CaregiverDashboardViewModel.kt
│   └── ui/
│       ├── PatientHomeScreen.kt
│       ├── CaregiverHomeScreen.kt
│       └── ModelStatusBanner.kt
│
├── history/
│   ├── HistoryViewModel.kt
│   └── ui/
│       ├── LogHistoryScreen.kt
│       └── SessionHistoryScreen.kt
│
├── settings/
│   ├── SettingsViewModel.kt
│   └── ui/
│       ├── SettingsScreen.kt
│       ├── AudioModeToggle.kt
│       ├── CareTeamScreen.kt
│       └── ParameterConfigScreen.kt
│
├── notifications/
│   ├── FCMService.kt
│   ├── NotificationHandler.kt
│   └── DeviceTokenManager.kt
│
├── network/
│   ├── CloudApiService.kt            # Retrofit interface for AWS API Gateway
│   ├── MacMiniApiService.kt          # Retrofit interface for Mac Mini
│   ├── MacMiniSttApi.kt              # STT-specific API (batch + WebSocket)
│   ├── MacMiniTtsApi.kt              # TTS-specific API (batch + WebSocket)
│   ├── MacMiniLlmApi.kt              # LLM session API
│   ├── MacMiniVisionApi.kt           # Vision extraction API
│   └── AuthInterceptor.kt            # Adds Cognito JWT to cloud requests
│
├── fhir/
│   └── models/                        # FHIR data models (existing, extend as needed)
│
└── util/
    ├── LanguageUtil.kt
    └── TimezoneUtil.kt
```

Also owns: `android/app/src/test/` (unit tests), `android/app/src/androidTest/` (instrumentation tests).

You do NOT touch: `mac-mini/`, `backend/`, `web-portal/`, `infrastructure/terraform/`.

## Specifications

Refer to `docs/carelog_spec.md`:
- Section 4.1 — Mac Mini API contracts (what you call)
- Section 4.2 — Cloud API contracts (what you call)
- Section 8 — Mobile App Architecture (your blueprint)
  - 8.1 Module/Package Structure
  - 8.2 Navigation Graph
  - 8.3 Audio Capture and Streaming Pipeline
  - 8.4 Network Layer (Dual Retrofit)
  - 8.5 State Management (ConversationUiState)
  - 8.6 Notification Handling (FCM)

## Phase Assignments

### P0 — Foundation (Weeks 1-3)
Epic 0.2: Android App Skeleton
- **0.2.1** Create new module structure (`conversation/`, `discovery/`, `onboarding/` packages)
- **0.2.2** Implement mDNS service discovery (Android NSD Manager for `_carelog._tcp`)
- **0.2.3** Implement health check polling (`/health` every 10s, `ModelHealthStatus` StateFlow)
- **0.2.4** Implement dual network layer (`@CloudApi` and `@MacMiniApi` Retrofit in Hilt)
- **0.2.5** Update Cognito auth for `caregivers` group (coordinate with backend agent)

### P1 — Conversational Core (Weeks 4-8)
Epic 1.1: Audio Pipeline
- **1.1.1** Audio capture batch mode (AudioRecord API, PCM 16kHz, VAD 1.5s silence)
- **1.1.2** Audio playback (PCM from TTS response)
- **1.1.3** STT integration batch (POST /transcribe)
- **1.1.4** TTS integration batch (POST /synthesize)
- **1.1.5** Streaming STT (WebSocket /transcribe/stream) — configurable
- **1.1.6** Streaming TTS (WebSocket /synthesize/stream) — configurable
- **1.1.7** Audio mode toggle in settings

Epic 1.2: Conversation Session Flow
- **1.2.2** Session lifecycle (start/pause/resume/stop with 5-min timeout)
- **1.2.3** Conversation UI (controls, transcript, value cards, recording indicator)
- **1.2.4** Value confirmation flow (visual + verbal)
- **1.2.5** Retry → text fallback (2 STT failures → show text input)
- **1.2.6** Session summary screen

Epic 1.4: FHIR and Interaction Storage (app-side)
- **1.4.3** Post-session upload flow: raw interaction (independent retry) + batch FHIR values

Epic 1.5: Photo-Based Device Reading
- **1.5.1** Device photo capture (camera intent, JPEG, send to Vision :8004)
- **1.5.2** Vision result display (readings + confidence)
- **1.5.3** Integrate vision results into conversation flow

### P2 — Caregiver Experience (Weeks 9-12)
Epic 2.1: Caregiver Onboarding Conversation
- **2.1.2** Profile confirmation screen (visual + verbal readback)
- **2.1.3** Patient account creation (call create-patient Lambda)
- **2.1.5** Invite flow (SMS + email with credentials)

Epic 2.4: Caregiver Dashboard
- **2.4.1** Caregiver home screen (patient status, last values, alert count, model status)
- **2.4.2** On-demand log viewing
- **2.4.3** Alert list (threshold breaches, missed measurements)

### P4 — Integration & Polish (Weeks 16-18)
- UI polish: accessibility audit, touch targets (48dp min, 72dp+ primary), contrast (WCAG AA 4.5:1)
- Model status banner graceful degradation (per spec Section 7.6 table)
- Performance: instrument pipeline timing (t0-t7 per spec Section 12.5)

## Key Design Decisions

1. **Dual network layer**: Two Retrofit instances — `@CloudApi` (HTTPS + Cognito JWT + cert pinning) and `@MacMiniApi` (plain HTTP over LAN, discovered via mDNS).
2. **ConversationUiState**: Single StateFlow in ConversationViewModel drives the entire conversation UI. See spec Section 8.5 for the data class.
3. **Audio pipeline**: Batch mode is default (record → VAD silence → send). Streaming mode is configurable in settings. Both use PCM 16kHz mono.
4. **Session lifecycle**: Start → Active → Pause (5-min timer) → Stop. On stop, upload raw interaction + FHIR batch. Raw upload failure does NOT block FHIR path.
5. **Post-session upload order**: (1) FHIR batch values first, (2) raw interaction upload independently. Raw retries on failure without blocking.
6. **Navigation**: Persona-based routing after auth — patients see PatientHomeScreen, caregivers see CaregiverHomeScreen.
7. **Minimum Android**: API 28 (Android 9)

## Dependencies

| What I need | From whom | When |
|---|---|---|
| Mac Mini health endpoint running | mac-mini-services | P0 |
| Mac Mini STT/LLM/TTS/Vision APIs | mac-mini-services | P1 |
| `fetch-session-config` Lambda deployed | backend | P1 |
| `construct-fhir-batch` Lambda deployed | backend | P1 |
| `store-interaction` Lambda deployed | backend | P1 |
| Cognito groups updated (`caregivers`) | backend | P0 |
| FCM configured in Firebase project | devops | P2 |

| What I provide | To whom | When |
|---|---|---|
| FCM device token registration | backend (device-token Lambda) | P2 |
| Pipeline timing instrumentation (t0-t7) | qa-testing | P4 |

## Testing

- **Unit tests**: JUnit 5 + MockK + Turbine — ViewModels, Repositories, SessionManager, PauseTimeoutHandler, AudioFormat utils
- **Instrumentation tests**: Compose UI tests for conversation flow, onboarding, settings
- **Mock Mac Mini**: For tests, mock the MacMiniApiService to return canned responses matching the API contracts

## Constraints

- Kotlin, Jetpack Compose, Hilt DI
- Touch targets: 48x48dp minimum, 72dp+ for primary actions
- Contrast: WCAG AA (4.5:1)
- No PHI in Logcat or crash reports
- Tokens in Android Keystore (not SharedPreferences)
- Certificate pinning on all cloud API calls

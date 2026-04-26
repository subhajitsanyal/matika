# CareLog Journey Execution Plan

**Date:** 2026-04-25
**Objective:** Execute caregiver and patient user journeys on a real emulator against live AWS backend, verifying end-to-end behavior.

---

## Current Environment State

| Resource | Status | Details |
|----------|--------|---------|
| Mac Mini M4 Pro | Available (this machine) | 24 GB RAM, Apple M4 Pro, arm64 |
| Android SDK | Installed | `/opt/homebrew/share/android-commandlinetools` |
| AVD | Ready | `CareLog_Test` (Pixel 6, API 34, Google APIs arm64) |
| AWS Backend | Live | API Gateway `carelog-dev-api`, Cognito `carelog-dev-users` |
| Mac Mini AI Services | NOT RUNNING | Ports 8000-8004 all down (models not yet downloaded/deployed) |
| RDS Database | Deployed | V001-V003 applied; V004 (conversational system) NOT YET applied |
| Android APK | Buildable | `./gradlew assembleDebug` succeeds |

---

## Agent Team

### Existing Agents (no changes needed)
| Agent | Role in this plan |
|-------|-------------------|
| `devops` | Phase 0: Provision Mac Mini services, apply V004 migration |
| `mac-mini-services` | Phase 0: Start and verify AI services |
| `android-app` | Phase 0: Build and install APK on emulator |

### New Agents
| Agent | File | Role |
|-------|------|------|
| `journey-runner` | `.agents/journey-runner.md` | Drives the Android emulator via `adb` — taps buttons, enters text, takes screenshots, reads logcat. Simulates both caregiver and patient personas. |
| `backend-verifier` | `.agents/backend-verifier.md` | Simultaneously queries AWS (Cognito, Lambda logs, S3, SQS) to verify that each app action produced the correct backend state. |

### Why existing agents are insufficient
- **qa-testing** writes test automation code (TypeScript test files). It doesn't operate a live emulator or query AWS state in real-time.
- **android-app** writes Kotlin code. It doesn't run the app or interact with UI.
- **backend** writes Lambda code. It doesn't verify live AWS state.
- We need agents that **operate** the system, not ones that **build** it.

---

## Execution Phases

### Phase 0: Environment Setup (sequential, blocking)

All agents work to bring the full stack up.

**Step 0.1 — Start emulator and install APK**
- Agent: `android-app` (or orchestrator)
- Commands:
  ```bash
  export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
  export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
  
  # Start emulator in background
  emulator -avd CareLog_Test -no-audio -no-window -gpu swiftshader_indirect &
  
  # Wait for boot
  adb wait-for-device
  adb shell getprop sys.boot_completed  # wait until "1"
  
  # Build and install
  cd android && ./gradlew installDebug
  ```

**Step 0.2 — Apply V004 migration** (if not yet applied)
- Agent: `backend`
- Requires: SSM port-forward to RDS (bastion)
- Commands: Start SSM session, run `flyway migrate`
- If port-forward not available: create test users directly via Cognito admin API (skip DB-dependent journeys)

**Step 0.3 — Start Mac Mini AI services** (if models are available)
- Agent: `mac-mini-services`
- Commands:
  ```bash
  cd mac-mini
  source /opt/carelog/venv/bin/activate  # or local venv
  uvicorn services.health_aggregator:app --port 8000 &
  uvicorn services.stt_service:app --port 8001 &
  uvicorn services.llm_service:app --port 8002 &
  uvicorn services.tts_service:app --port 8003 &
  uvicorn services.vision_service:app --port 8004 &
  ```
- If models not downloaded: Mark all conversational journeys (PT-03, PT-04, CG-02, CG-03) as BLOCKED. Non-conversational journeys (manual vitals, registration, dashboard) still execute.

**Step 0.4 — Create test accounts**
- Agent: `backend-verifier`
- Create via Cognito admin API:
  - Caregiver: `test-caregiver@carelog.dev` / `CareLog2026@test`
  - Patient: `test-patient@carelog.dev` / `CareLog2026@test`
- Confirm both, set persona_type, add to groups, link patient to caregiver

---

### Phase 1: Caregiver Core Journeys (parallel: journey-runner + backend-verifier)

Both agents run simultaneously. Journey-runner drives the app; backend-verifier queries AWS after each step.

| Order | Journey | Journey-Runner Actions | Backend-Verifier Checks |
|-------|---------|----------------------|------------------------|
| 1.1 | CG-01 | Launch app -> Register screen -> Enter email/password -> Submit -> Enter verification code -> Accept consent | Cognito user exists in `caregivers` group; post-confirmation Lambda log shows RDS insert |
| 1.2 | CG-06 | After login, verify dashboard renders: patient card, alert count, model status banner | API call to patient-summary returns data (check Lambda logs) |
| 1.3 | CG-14 | Navigate to thresholds -> Set BP max=140 -> Save | threshold-crud Lambda log (or parameter_configs in DB) |
| 1.4 | CG-05 | Navigate to Care Team -> Invite Doctor -> Enter email -> Send | invite-doctor Lambda log; SES email sent (or sandbox verification) |
| 1.5 | CG-16 | Navigate to Care Team -> Verify members listed | care-team Lambda returns linked members |

**If Mac Mini running, add:**

| Order | Journey | Journey-Runner Actions | Backend-Verifier Checks |
|-------|---------|----------------------|------------------------|
| 1.6 | CG-02 | Start onboarding conversation -> Speak patient details -> Confirm profile | create-patient Lambda invoked; Cognito patient account created |
| 1.7 | CG-03 | Start config conversation -> Set BP daily, glucose daily -> Set deadline 6 PM | parameter_configs records in DB (via Lambda logs) |

---

### Phase 2: Patient Core Journeys (parallel: journey-runner + backend-verifier)

Switch to patient persona in the app.

| Order | Journey | Journey-Runner Actions | Backend-Verifier Checks |
|-------|---------|----------------------|------------------------|
| 2.1 | PT-01 | Logout caregiver -> Login as patient -> Verify dashboard | Cognito auth succeeds; persona routing correct |
| 2.2 | PT-02 | Verify dashboard layout: 6 vital buttons, touch targets, sync status, model banner | Screenshot analysis: button sizes >= 72dp |
| 2.3 | PT-11 | Tap BP -> Enter 120/80 -> Save -> Hear voice ack -> Back to dashboard | S3: FHIR Observation with LOINC 8480-6/8462-4; sync-observation Lambda log |
| 2.4 | PT-12 | Tap Glucose -> Enter 110 -> Save | S3: Observation LOINC 2339-0 |
| 2.5 | PT-13 | Tap Temperature -> Enter 98.6 -> Save | S3: Observation LOINC 8310-5 |
| 2.6 | PT-17 | Tap History -> Verify 3 entries with values, timestamps, sync status | Local Room DB query via logcat |
| 2.7 | PT-25 | Tap Settings -> Care Team -> Verify can see but not modify | No invite/delete buttons visible in UI dump |

**If Mac Mini running, add:**

| Order | Journey | Journey-Runner Actions | Backend-Verifier Checks |
|-------|---------|----------------------|------------------------|
| 2.8 | PT-03 | Start conversation -> Speak "my blood pressure is 130 over 85" -> Confirm | STT transcription via Mac Mini; LLM extraction; FHIR batch via construct-fhir-batch Lambda; S3 observation |
| 2.9 | PT-07 | Speak gibberish x2 -> Text fallback shown -> Type "125" -> Confirm | LLM fallback action in logcat |
| 2.10 | PT-05 | Mid-session pause -> Resume within 5 min | LLM session state preserved |

---

### Phase 3: Cross-Persona Alert Journeys (parallel: journey-runner + backend-verifier)

| Order | Journey | Journey-Runner Actions | Backend-Verifier Checks |
|-------|---------|----------------------|------------------------|
| 3.1 | PT-24 / CG-09 | As patient: Log BP 165/100 (above 140 threshold) | evaluate-thresholds-batch Lambda detects breach; notification-sender Lambda fires; SQS message consumed |
| 3.2 | PT-23 | Disable WiFi (adb) -> Log BP 130/85 -> Log Glucose 95 -> Enable WiFi -> Watch sync | S3: 2 new observations appear after WiFi enabled; sync-observation Lambda logs |

---

### Phase 4: Edge Cases (sequential, journey-runner only)

| Order | Journey | Journey-Runner Actions | What to verify |
|-------|---------|----------------------|----------------|
| 4.1 | Error | Enter invalid email on registration | Error message shown |
| 4.2 | Error | Enter weak password | Policy error shown |
| 4.3 | Error | Enter mismatched confirm password | Mismatch error shown |
| 4.4 | PT-02 | Verify contrast ratios meet WCAG AA (4.5:1) | Screenshot pixel analysis |
| 4.5 | CG-20 | Verify Mac Mini status banner (shows correct state) | Screenshot: green if running, red/warning if down |

---

### Phase 5: Cleanup

- Agent: `backend-verifier`
- Delete test Cognito users
- Delete test S3 objects
- Stop emulator
- Stop Mac Mini services (if started)

---

## Dependency Graph

```
Phase 0: Setup
├── 0.1 Start emulator + install APK ─────────────────────┐
├── 0.2 Apply V004 migration (if possible) ───────────────┤
├── 0.3 Start Mac Mini services (if models available) ────┤
└── 0.4 Create test accounts ─────────────────────────────┘
                                                           │
                                                           ▼
Phase 1: Caregiver Journeys ──────────────────────────────┐
  (journey-runner + backend-verifier in parallel)          │
                                                           ▼
Phase 2: Patient Journeys ────────────────────────────────┐
  (journey-runner + backend-verifier in parallel)          │
                                                           ▼
Phase 3: Cross-Persona Alerts ────────────────────────────┐
  (journey-runner + backend-verifier in parallel)          │
                                                           ▼
Phase 4: Edge Cases ──────────────────────────────────────┐
  (journey-runner only)                                    │
                                                           ▼
Phase 5: Cleanup
```

---

## What Can Run Without Mac Mini AI Services

If AI models are not downloaded (likely), the following journeys are **BLOCKED**:

| Journey | Reason |
|---------|--------|
| PT-03 (voice conversation) | Requires LLM + STT + TTS |
| PT-04 (photo reading) | Requires Vision service |
| PT-05/06 (pause/resume) | Part of conversation flow |
| PT-07 (STT fallback) | Requires STT |
| PT-08 (emergency detection) | Requires LLM |
| PT-09 (implausible value) | Requires LLM |
| CG-02 (conversational onboarding) | Requires LLM + STT |
| CG-03 (conversational config) | Requires LLM + STT |

The following journeys run **without Mac Mini** (18 of 27 patient + caregiver journeys):

| Journey | What it tests |
|---------|---------------|
| CG-01, PT-01 | Registration, login, persona routing |
| CG-06, PT-02 | Dashboard rendering, layout verification |
| CG-05, CG-16, CG-17 | Doctor invite, care team management |
| CG-14, CG-15 | Manual threshold/reminder config |
| CG-08, CG-13, CG-19 | Alerts, trends, audit log views |
| PT-11 through PT-16 | Manual vital logging (6 types) |
| PT-17 | Vital history |
| PT-18-22 | Upload flows (prescription, photo, voice, video, lab) |
| PT-23 | Offline sync |
| PT-24 | Threshold breach trigger |
| PT-25 | Settings, care team view |
| CG-20, PT-26 | Mac Mini discovery (shows offline state) |

---

## What Requires V004 Migration

If V004 is not applied (DB port-forward needed), these backend verifications are limited:

- parameter_configs, recommendations, interaction_sessions, conversation_prompts tables won't exist
- CG-14, CG-15 may work via existing threshold/reminder tables (V001-V003)
- CG-09, CG-10 threshold/missed-measurement evaluation Lambda won't find configs

**Workaround:** Create test accounts directly via Cognito admin API; test app UI rendering even if backend calls fail (capture error states as findings).

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Tier 1 journeys (core flows) | 100% PASS |
| Tier 2 journeys (conversational) | PASS if Mac Mini available; BLOCKED otherwise |
| Tier 3 journeys (notifications) | PASS if V004 applied; partial otherwise |
| Backend verifications | Match expected state for every PASS journey |
| Screenshots captured | 1+ per journey step |
| Zero crashes | App should never force-close |
| Zero P0 bugs | No deployment blockers discovered |

---

## Execution Command

To run the plan, the orchestrator should:

1. Launch **Phase 0** agents sequentially (emulator, migration, services, accounts)
2. Launch **journey-runner** and **backend-verifier** in parallel for Phases 1-3
3. Journey-runner announces each journey step; backend-verifier queries AWS after each
4. Both agents write results to `test-automation/results/journey-results/`
5. After Phase 4, run cleanup

---

*CareLog Journey Execution Plan — April 2026*

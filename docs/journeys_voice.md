# Matika v2 — Voice-Required Journeys

**Version:** 1.0
**Date:** 2026-05-08
**Source of truth:** `docs/journeys.md` (full catalog). This file is a focused subset.

A journey is in this file when **the test path requires speech audio capture from the phone's microphone**. Test infrastructure: `scripts/matika-voice-run.sh` + `scripts/matika-say.sh` + macOS `say` voices routed to External Headphones via SwitchAudioSource (`docs/journeys.md` §3.2).

Journeys whose canonical text describes voice but where the **same product behavior** can be exercised via the text fallback (PT-V2-09 emergency, CG-V2-09 caregiver receives push, EDGE-V2-03 Guardrail block, EDGE-V2-11 pause/resume, EDGE-V2-13 implausibility, etc.) live in `docs/journeys_non_voice.md` instead — they're testable without acoustic dependencies.

---

## Inventory

### Patient — voice extraction (4)

| ID | Title | Why voice-only |
|---|---|---|
| **PT-V2-03** | Daily voice logging — single parameter (English) | Tests Soda STT → Bedrock extraction round-trip with Rishi voice. The text fallback variant is PT-V2-07 (in non-voice file). |
| **PT-V2-04** | Daily voice logging — multi-parameter (English) | Tests multi-parameter extraction from a single utterance. |
| **PT-V2-05** | Daily voice logging — Hindi | Tests `hi-IN` STT pack. Lekha voice. |
| **PT-V2-06** | Daily voice logging — Bengali | macOS lacks `bn-IN` voice; needs `MATIKA_BN_AUDIO=<path>` pre-recorded `.aiff`. |

### Caregiver — voice flows (2)

| ID | Title | Why voice-only |
|---|---|---|
| **CG-V2-03** | Conversational protocol configuration (T3, voice) | Tests caregiver Sonnet protocol-config voice path with multi-turn dialog. Form-based onboarding is CG-V2-02 (non-voice). |
| **CG-V2-04** | Conversational patient onboarding (Sonnet, voice) | Tests caregiver Sonnet patient-profile extraction from speech. |

### Edge — voice infrastructure (1)

| ID | Title | Why voice-only |
|---|---|---|
| **EDGE-V2-17** | STT offline pack missing | Tests fresh-install STT online-fallback. Needs un-installed pack state. |

---

## Verified status (post-voice-sweep `20260510_voice_sweep`)

| ID | Status | Last evidence |
|---|---|---|
| PT-V2-03 | **PASS (single-turn)** | 2026-05-10 session `efcb6cd9-...`: T2 Haiku 2652ms, fsm=PENDING_CONFIRMATION, lang=en-IN. STT chars=32, `extracted=2`, response_card mounts. |
| PT-V2-04 | **PASS-single-turn** (multi-turn confirmation deferred per F6 residual) | 2026-05-10 session `9d59d08e-...`: T3 Sonnet 3873ms, escalation_reason=`implausible_value`, fsm=PLAUSIBILITY_CHALLENGE. STT chars=70 from `My BP is one twenty over seventy eight, my sugar this morning was one ten, and I weigh seventy two kilograms.` Full PASS (3 observations persisted) requires multi-turn `Yes` confirmations — Soda flakes on short utterances per F6 residual. |
| PT-V2-05 | **PASS (single-turn, Hindi)** | 2026-05-10 session `1b5e3e66-...`: T2 Haiku 2980ms, fsm=PENDING_CONFIRMATION, **lang=hi-IN**. F22 worked around by writing `language=hi` directly into the app's DataStore protobuf via `adb run-as`. Lekha voice on Mac → Soda hi-IN STT chars=24 → Bedrock returned Hindi response. `extracted=2`. |
| PT-V2-06 | **flow-authored, blocked on F24** | 2026-05-10 session `d2cef06a-...`-ish: lang=bn-IN session created, gTTS-generated Bengali audio plays on Mac, but Soda returns `RecognitionListener.onError(12)` LANGUAGE_NOT_SUPPORTED. Bengali offline pack absent on this Samsung S21+ despite captions list. F24 documents the gap. |
| CG-V2-03 | **PASS (single-turn)** | 2026-05-10 session `a61ace08-...`: session_type=`caregiver_onboarding`, **T3 Sonnet 4.6** 2579ms, escalation_reason=`caregiver_protocol_design`, fsm=EXTRACTING. STT chars=103, response_card mounts. Validates the caregiver Sonnet voice path end-to-end. |
| CG-V2-04 | **architecture-blocked (F23)** | No "Add Patient via Conversation" entry in CaregiverHomeScreen — only `onboard_patient_fab` → form. `PatientOnboardingConversationScreen` exists in code but has no caregiver-flow nav. Voice-only patient profile extraction is not exercisable today. |
| EDGE-V2-17 | **architecture-blocked (F25)** | Spec expects silent online fallback when offline pack missing + `stt_offline_used=false` telemetry. Actual: SttManager surfaces `LANGUAGE_NOT_SUPPORTED` user-visible error (verified by PT-V2-06 bn-IN run). No online fallback path implemented. |

### New voice-related findings (raised this sweep)

- **F20 (RESOLVED)** — `matika-voice-run.sh` logcat trigger pattern was `Offline recognizer - start listening`, a Pixel-specific Soda system log. On Samsung S21+ the trigger never fired and the harness failed all voice runs. Fixed by adding a `Log.i(TAG, "RecognitionListener.onReadyForSpeech: mic open")` line in `SttManager.kt:onReadyForSpeech` and updating `matika-voice-run.sh`'s `TRIGGER` constant. Now device-portable.
- **F21 (RESOLVED)** — Mac `say` queue gets wedged when prior runs leave `say` processes stuck in audio I/O. Once wedged, every subsequent voice run returns Soda NO_MATCH because no audio reaches the phone mic. Mitigation: `killall say` before each voice flow. Folded into the standard preflight.
- **F22 (NEW, open)** — No UI exposes `AppLanguage`. Patient session always seeds `language=en-IN`. Hindi/Bengali voice journeys require a DataStore override via `adb run-as` (see `scripts/matika-voice-seed-language.sh` once written). Resolution paths: (a) add a language picker to PatientHomeScreen / SettingsScreen, or (b) add a dev-only Build.DEBUG receiver that accepts `am broadcast -a com.carelog.SET_LANG --es lang hi`.
- **F23 (NEW, open)** — No "Add Patient via Conversation" entry in caregiver UI. Blocks CG-V2-04 as written. Resolution: (a) wire `PatientOnboardingConversationScreen` to a button on CaregiverHomeScreen, or (b) reclassify CG-V2-04 in journey doc as covered by the existing form + protocol-config voice path (CG-V2-02 + CG-V2-03 together).
- **F24 (NEW, open)** — Soda `bn-IN` offline pack not installed on the Samsung S21+ test device, despite Bengali appearing in the device-personalization Captions list. Resolution: install the pack manually via Settings → System → Languages → Speech → Offline speech recognition, OR implement F25 (online fallback).
- **F25 (NEW, open)** — `SttManager` does not implement online fallback when an offline pack is missing. Spec contract for EDGE-V2-17 is silent online fallback + `stt_offline_used=false` telemetry. Today, error 12 (LANGUAGE_NOT_SUPPORTED) bubbles up as a user-visible error and the turn never reaches Bedrock. Fix: in the `onError(12)` branch, retry without `EXTRA_PREFER_OFFLINE=true` (or with `EXTRA_PREFER_OFFLINE=false`) and tag the resulting turn as online.

---

## How to run

Single-turn (recommended for non-voice-noise nights):

```bash
source ~/.matika-test-creds.env
SwitchAudioSource -t output -s "External Headphones"
scripts/matika-voice-run.sh patient_voice_bp_en_single_turn \
    --turn "en|175|My blood pressure is one thirty over eighty five.|600"
```

Multi-turn (acoustically sensitive — short confirmation utterances flake on Soda):

```bash
scripts/matika-voice-run.sh patient_voice_bp_en \
    --turn "en|175|My blood pressure is one thirty over eighty five.|600" \
    --turn "en|160|Yes, that value is correct.|800"
```

Hindi:

```bash
scripts/matika-voice-run.sh patient_voice_bp_hi_single_turn \
    --turn "hi|165|मेरा रक्तचाप एक सौ चालीस बटा नब्बे है|600"
```

(Hindi flow file does not yet exist — copy `patient_voice_bp_en_single_turn.yaml` and adjust language assertions.)

---

## Pre-flight (voice-specific)

Beyond standard preflight (`docs/matika_test_plan_v2.md` §0):

1. `SwitchAudioSource -t output -c` returns `External Headphones`.
2. `say -v '?' | grep -E "Rishi|Lekha"` returns 2 lines.
3. Phone speaker side ~6–12" from External Headphones; ambient noise low.
4. `adb shell settings put system volume_music 7` and Mac output volume ≥ 70%.
5. (For PT-V2-05) Soda Hindi pack installed: Settings → System → Languages → Speech → Offline speech recognition → Hindi (India).
6. (For PT-V2-06) `MATIKA_BN_AUDIO=<absolute-path>` env var pointing to a staged Bengali recording.

---

## Known acoustic flakiness

Documented in `docs/testing_todos_v2.md` F6 residual:
- Multi-turn flows where turn 2 is short ("Yes, that's correct" — ~1.5s) intermittently return `RecognitionListener.onError(7)` (Android NO_MATCH) — Soda's offline-pack confidence threshold is at the edge for short confirmations.
- Mitigations: longer utterances, slower rate (`-r 160`), boosted speaker volume, OR switch confirmation turns to text fallback.

---

## What's NOT in this file

- Voice journeys whose **product behavior** is testable without speech (text-fallback equivalent exists). See `docs/journeys_non_voice.md`.
- Photo-based journeys (PT-V2-10/11/12) — those need a real device photo, not voice.
- Backend / infra journeys — these are about Lambda / RDS / API behavior independent of input modality.

---

*See `docs/journeys.md` for the full unfiltered catalog and per-journey detail.*

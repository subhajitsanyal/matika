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

## Verified status (post-sweep `20260508_215314` + F6/F7/F9 fixes)

| ID | Status | Last evidence |
|---|---|---|
| PT-V2-03 | **PASS (single-turn)** | F6/F7/F9 verified: STT 3 hyp → submitTurn → Bedrock T2 → `extracted=2` → `matika_response_card` mounts |
| PT-V2-04 | manual / not-yet-tested | depends on PT-V2-03 robustness across multi-parameter utterance |
| PT-V2-05 | manual / not-yet-tested | depends on `hi-IN` Lekha voice + Soda hi-IN pack |
| PT-V2-06 | manual / not-yet-tested | needs `MATIKA_BN_AUDIO` staged |
| CG-V2-03 | partial — Sonnet round-trip verified (typed) | text-driven version covered by `caregiver_protocol_setup.yaml` smoke; voice version is what this entry catalogs |
| CG-V2-04 | not-yet-tested | needs new flow |
| EDGE-V2-17 | not-yet-tested | needs fresh-install state |

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

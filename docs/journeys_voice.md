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

### Caregiver — voice flows (3)

| ID | Title | Why voice-only |
|---|---|---|
| **CG-V2-03** | Conversational protocol configuration (T3, voice) | Tests caregiver Sonnet protocol-config voice path with multi-turn dialog. Form-based onboarding is CG-V2-02 (non-voice). |
| **CG-V2-04** | Conversational patient onboarding (Sonnet, voice) | Tests caregiver Sonnet patient-profile extraction from speech. |
| **CG-V2-13** | Configure reminders via voice (F26b voice-only, 2026-05-15) | Same wire path as CG-V2-03; utterance specifically conveys reminder cadence ("every morning … twice a week … on Sundays"). PASS criterion verified out-of-band against `parameter_configs.frequency_days / daily_deadline / timezone` for the freshly-onboarded patient. Flow: `cg_v2_13_voice_reminder_config.yaml`. |

### Edge — voice infrastructure (1)

| ID | Title | Why voice-only |
|---|---|---|
| **EDGE-V2-17** | STT offline pack missing | Tests fresh-install STT online-fallback. Needs un-installed pack state. |

---

## Verified status (post-voice-sweep `20260510_voice_sweep`)

| ID | Status | Last evidence |
|---|---|---|
| PT-V2-03 | **PASS (single-turn, 2026-05-10)** — 2026-05-16 re-bench BLOCKED (F41 + F40) | 2026-05-10 session `efcb6cd9-...`: T2 Haiku 2652ms, fsm=PENDING_CONFIRMATION, lang=en-IN. STT chars=32, `extracted=2`, response_card mounts. **2026-05-16 re-bench attempt:** voice path unreachable due to F41 Core Audio wedge; pivoted to `Type instead (fallback)` mode → UI advanced cleanly to "Session complete" with BP 130/85 displayed BUT zero backend evidence (interaction_sessions empty for 4h, bedrock-router silent, observation_sync_log empty, no S3 obs) — fallback mode does not POST. Filed as **F40**. PT-V2-03 retains the 2026-05-10 PASS evidence; re-verification deferred until F41 reboot. |
| PT-V2-04 | **PASS-single-turn (2026-05-10)** — 2026-05-16 re-bench BLOCKED (F41) | 2026-05-10 session `9d59d08e-...`: T3 Sonnet 3873ms, escalation_reason=`implausible_value`, fsm=PLAUSIBILITY_CHALLENGE. STT chars=70 from `My BP is one twenty over seventy eight, my sugar this morning was one ten, and I weigh seventy two kilograms.` Full PASS (3 observations persisted) requires multi-turn `Yes` confirmations — Soda flakes on short utterances per F6 residual. **2026-05-16 re-bench not attempted** — same Core Audio wedge as PT-V2-03; text-fallback fork also blocked by F40. |
| PT-V2-05 | **PASS (single-turn, Hindi, 2026-05-10); F22 hack no longer required** — 2026-05-16 re-bench BLOCKED (F41) | 2026-05-10 session `1b5e3e66-...`: T2 Haiku 2980ms, fsm=PENDING_CONFIRMATION, **lang=hi-IN**. Original run used the DataStore-protobuf adb hack; F22 fix (in-UI Settings → Language picker, testTag `language_option_hi`) means future re-runs can switch language with a Maestro tap instead. Lekha voice on Mac → Soda hi-IN STT chars=24 → Bedrock returned Hindi response. `extracted=2`. **2026-05-16 re-bench not attempted** — Core Audio wedge (F41) prevents Hindi voice driving. |
| PT-V2-06 | **bench-blocked (Core Audio wedge — recurred 2026-05-16 post-reboot, see F41)** | F27 + F25 unblocked the product path. Setup verified end-to-end pre-audio: helper flow `_bench_set_language_bn.yaml` (added 2026-05-11) flipped DataStore language to bn via the F22 picker successfully. Then `afplay -t 1 /System/Library/Sounds/Pop.aiff` returned `AudioQueueStart failed (-66681)` on all three Mac output devices (External Headphones, Mac mini Speakers, DELL S3222HN) — the wedged Core Audio pattern documented in `voice_harness_lessons.md` lesson 6, which is reboot-only. **2026-05-16 update:** Mac mini was rebooted at the start of the post-reboot bench session; `afplay` was clean at §1 pre-flight; the wedge then recurred ~25 min into the bench (after CG-V2-04 turns 1–8 of `say` activity) and was NOT recoverable by `sudo killall coreaudiod` or `sudo killall audiomxd`. Filed as **F41** in `testing_todos_v2.md`. PT-V2-06 stays bench-blocked. Re-run after next reboot: `source ~/.matika-test-creds.env && scripts/maestro-run.sh _bench_set_language_bn && export MATIKA_BN_AUDIO=$PWD/test-automation/audio/bn-IN-bp-130-85.mp3 && scripts/matika-voice-run.sh patient_voice_bp_bn_single_turn --turn "bn\|160\|$MATIKA_BN_AUDIO\|800"`. |
| CG-V2-03 | **PASS (single-turn)** | 2026-05-10 session `a61ace08-...`: session_type=`caregiver_onboarding`, **T3 Sonnet 4.6** 2579ms, escalation_reason=`caregiver_protocol_design`, fsm=EXTRACTING. STT chars=103, response_card mounts. Validates the caregiver Sonnet voice path end-to-end. |
| CG-V2-04 | **code-fix landed 2026-05-16 (F39); live-bench retry gated on F41** | F23 voice entry is now wired (`add_patient_voice_fab` on caregiver dashboard, bounds (644, 1949)). 2026-05-16 post-reboot bench drove turns 1–8 via acoustic `say -v Rishi` → state advanced CREATED → EXTRACTING_PROFILE; Soda captured each turn (chars=29..70, `#handleFinalResult` clean). The LLM tracked name (mis-heard "Menon" → "Maina" at the Soda layer; LLM accepted what STT delivered), age, conditions, no-allergies, doctor across the conversation phase. Flow transitioned to the typed contact-details form, where `patient_credentials_submit` stayed `enabled="false"` with valid inputs — filed as **F39**. **F39 code fix shipped same day** (commit pending push): validators extracted to `PatientCredentialsValidation.kt` (JVM-testable, 7/7 PASS); dialog rewired with `isError` + `supportingText` and always-tappable Submit. Live RDS-row + CloudWatch-log evidence (the bench-substitute for "patient really got created") **deferred to next session post-F41 unblock** — F41 was already wedged at session start so no fresh voice driving was possible. |
| CG-V2-13 | **PASS-by-architecture; bench-run pending (Stream F, 2026-05-15)** | Manual UI removed (this session); voice path is the canonical reminder-config surface. Schema verified live in dev RDS: Jane's `parameter_configs` rows for systolic+diastolic BP carry `frequency_days=1, daily_deadline=18:00:00, timezone=Asia/Kolkata` — exact columns the protocol_persister UPSERT writes. CloudWatch shows `protocol_extraction` fires on real caregiver_onboarding `complete_session` events. Regression flow `cg_v2_13_voice_reminder_config.yaml` authored; full bench run gated on Mac Core Audio wedge resolution (same blocker as PT-V2-06). |
| EDGE-V2-17 | **route-reachable; awaits Maestro flow (2026-05-10)** | F25 implemented: `SttManager` silently retries with `EXTRA_PREFER_OFFLINE=false` on error 12/13. Logcat carries `stt_offline_used=true|false` for assertion. Flow needs authoring: bn-IN session, gTTS audio, assert Final emits + logcat shows fallback line. |

### New voice-related findings (raised this sweep)

- **F20 (RESOLVED)** — `matika-voice-run.sh` logcat trigger pattern was `Offline recognizer - start listening`, a Pixel-specific Soda system log. On Samsung S21+ the trigger never fired and the harness failed all voice runs. Fixed by adding a `Log.i(TAG, "RecognitionListener.onReadyForSpeech: mic open")` line in `SttManager.kt:onReadyForSpeech` and updating `matika-voice-run.sh`'s `TRIGGER` constant. Now device-portable.
- **F21 (RESOLVED)** — Mac `say` queue gets wedged when prior runs leave `say` processes stuck in audio I/O. Once wedged, every subsequent voice run returns Soda NO_MATCH because no audio reaches the phone mic. Mitigation: `killall say` before each voice flow. Folded into the standard preflight.
- **F22 (RESOLVED, 2026-05-10)** — Added a `LanguagePickerCard` to `SettingsScreen` with three RadioButton options (English / हिन्दी / বাংলা). testTags `language_option_en/hi/bn` for harness use. Selection persists across app restart (DataStore-backed). Maestro flows for PT-V2-05 / PT-V2-06 / EDGE-V2-17 / future multilingual journeys can now switch language via `tapOn: { id: language_option_hi }` instead of the DataStore-protobuf adb hack. Hack still works as a fallback for fresh-install / uninstrumented testing.
- **F23 (NEW, open)** — No "Add Patient via Conversation" entry in caregiver UI. Blocks CG-V2-04 as written. Resolution: (a) wire `PatientOnboardingConversationScreen` to a button on CaregiverHomeScreen, or (b) reclassify CG-V2-04 in journey doc as covered by the existing form + protocol-config voice path (CG-V2-02 + CG-V2-03 together).
- **F24 (RESOLVED, 2026-05-10)** — Subsumed by F25. The bn-IN offline pack remains uninstalled on the Samsung S21+ test device, but the F25 online-fallback retry handles it transparently. Manual install no longer required for journey runs.
- **F25 (RESOLVED, 2026-05-10)** — `SttManager.recognize()` now silently retries with `EXTRA_PREFER_OFFLINE=false` on error 12 (LANGUAGE_NOT_SUPPORTED) or 13 (LANGUAGE_UNAVAILABLE). The retry is invisible to the collector; logcat carries `stt_offline_used=true|false` for harness assertion. The actual bn-IN retry path needs an EDGE-V2-17 / re-run-of-PT-V2-06 flow to exercise live, but the code path is unit-test-pinned (mapping of error 12/13 → LANGUAGE_NOT_SUPPORTED) and logging-shape-verified (en-IN smoke confirmed `preferOffline=true|false` field renders).
- **F39 (CODE FIX 2026-05-16; live re-bench pending F41)** — CG-V2-04 voice patient onboarding contact-form Submit was gated on `email.isNotBlank() && phone.isNotBlank()` only, with no helper text on the empty/disabled state — caregivers hit a silent dead-end. Shipped `PatientCredentialsValidation.kt` (pure-JVM email + E.164 phone validators; 7/7 unit-test PASS) + rewired `PatientCredentialsDialog` with `isError`/`supportingText` per field and an always-tappable Submit that validates on tap. APK installed cleanly on `RFCT10C1GSZ`. RDS `patients`-row + `create-patient-from-voice` CloudWatch evidence deferred to next session — F41 was wedged at session start. Details in `testing_todos_v2.md` F39.
- **F40 (NEW, open, 2026-05-16)** — `Type instead (fallback)` mode drives local UI to "Session complete" without POSTing to backend. interaction_sessions / observation_sync_log / bedrock-router all silent during a successful-looking PT-V2-03 drive. Invalidates text-fallback as a backend-assert substitute for voice. Details in `testing_todos_v2.md` F40.
- **F41 (NEW, open, 2026-05-16; voice-harness regression)** — Core Audio wedges within ~25 min of sustained voice activity even after fresh reboot; `sudo killall coreaudiod` + `sudo killall audiomxd` did NOT unstick. Repro pattern is `say -v Rishi` driven through Mac mini Speakers @ 50% with intermittent `SwitchAudioSource` device switches. Reboot remains the only recovery, so multi-phase bench sessions need scheduled reboots between phases. Details in `testing_todos_v2.md` F41.

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

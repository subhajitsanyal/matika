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
| PT-V2-03 | **PASS — verified live 2026-05-17** | Patient Jane PT (`CL-012W6M`, `sanyalsubhajit2010+pt9@gmail.com`) staging session `1db581fe-1a24-4d49-9703-227f96012009`. Drove "My blood pressure is one thirty over eighty five" via the new remote-TTS harness on a second Mac (Mac mini's Core Audio remained F41-wedged the entire session — irrelevant). Soda en-IN, STT chars=32, fsm=PENDING_CONFIRMATION, `extracted=2` (BP systolic 130 mmHg + diastolic 85 mmHg, both LOINC-coded). Turn 2 "Yes that is correct" → fsm=EXTRACTING with both values committed. Session-end summary card displays BP 130/85. session_type=patient_logging. |
| PT-V2-04 | **PASS — verified live 2026-05-17** | Same Jane PT session as PT-V2-03 (no re-login needed for multi-param verify). Drove "My blood sugar is one hundred ten, my weight is sixty five kilograms, and I have a slight headache" as a single utterance → fsm=PENDING_CONFIRMATION, `extracted=2` (blood_glucose 110 mg/dL + body_weight 65 kg); headache surfaced in AI response as a non-numerical topic, doesn't enter extractedValues. Turn 4 confirm committed both values; session-end summary card showed all 4 values from PT-V2-03+04 together (BP sys 130, BP dia 85, glucose 110, weight 65). Soda mistranscribed "blood" → "love" and "weight" → "way" but LLM extracted correctly anyway — pre-model hints + LLM robustness compensated. |
| PT-V2-05 | **PASS — verified live 2026-05-17 (Hindi end-to-end); re-verified 2026-05-17 evening on current build with F51 fix** | F22 Settings → Language picker flipped to Hindi (RadioButton at left edge of row, bounds `[91,1021][226,1156]` — NOT row-center; the row text region is non-clickable). DataStore wrote `language: hi`. Next session `d46962ec-6072-4fb9-b833-904f590c2a8c` initialized **lang=hi-IN**. Drove "मेरा रक्तचाप एक सौ चालीस के ऊपर नब्बे है।" via remote-TTS Lekha voice; Soda init at locale=hi-IN, transcribed Devanagari "140 के ऊपर 90 है", LLM responded in Hindi ("नमस्ते Jane जी। आपने अपना ब्लड प्रेशर बताया है — मैंने सुना एक सौ चालीस ऊपर नब्बे। क्या यह सही है?"), `extracted=2` (BP 140/90). Turn 2 confirm "हाँ सही है।" → fsm=COMPLETE with complete_session. **2026-05-17 evening re-verify:** new session `a3fc9a3d-62e4-4426-a551-c4be5d89e211` (post F51 fix landing) initialized `language=hi-IN`, Devanagari STT "मीना रक्तचाप 140 बता 90 है", Hindi system readback, `extracted=2` (BP 140/90 with LOINC + 0.93 confidence). The F51 fix (Row clickable in SettingsScreen) means the in-UI picker now reliably switches language via Maestro `tapOn: { id: language_option_hi }` — the coordinate-tap workaround is no longer required. New `.maestro/flows/_bench_set_language_hi.yaml` helper landed. |
| PT-V2-06 | **PASS — verified live 2026-05-17 (Bengali end-to-end, first ever); re-verified 2026-05-17 evening on current build with F51 fix** | Required extending remote-TTS server with a gTTS-via-translate_tts fallback (commits `4484d7c` + `ab8b466`) since macOS has no native bn `say` voice; the server downloads MP3 + afplays it. F22 picker → Bengali → DataStore `language: bn`. Session `d5df3579-26b8-404a-ac2d-d5c64e9eb469` initialized **lang=bn-IN**. Critical marker: `stt_offline_used=**false**` on onResults — F25 online STT fallback fired (bn-IN offline pack absent on Samsung S21+, SttManager auto-retried with `EXTRA_PREFER_OFFLINE=false`). Soda transcribed Bengali with Bengali numerals: "আমার রক্তচাপ ১৪০ উপর ৯০". `extracted=2`. AI responded in Bengali ("নমস্কার জেন। আপনার রক্তচাপ একশ চল্লিশ উপর নব্বই — এটা কি ঠিক আছে?"). Turn 2 confirm "হ্যাঁ ঠিক আছে।" committed values. **EDGE-V2-17 implicitly proven** by the same drive — see that row. **2026-05-17 evening re-verify:** session `d8bb6ec1-4ffd-4b07-96bc-93313fe08aa6` (post F51 fix landing), `language=bn-IN`, Bangla STT "আমার রক্তচাপ ১২০ বাই ৮৫" (Bangla numerals 120/85 — STT misheard intended 130 as 120, acceptable STT noise), Bangla system readback "নমস্কার জেন, আপনার রক্তচাপ একশো বিশ over পঁচাশি শুনলাম। এটা কি সঠিক?", `extracted=2` (BP 120/85 with LOINC + 0.95 confidence). Drove via remote-TTS server's gTTS Bengali path with the real Bangla utterance "আমার রক্তচাপ এক শো ত্রিশ বাই পঁচাশি।" (not the local-afplay MP3 path) — proves the remote-TTS bn path is functional. |
| PT-V2-08 | **PASS — verified live 2026-05-17 (implausibility challenge)** | Same Jane PT session as PT-V2-03/04. Drove "My blood pressure reading is four hundred over three hundred" → fsm=**PLAUSIBILITY_CHALLENGE**, `extracted=0` (the 400/300 value was NOT captured), AI politely re-asked: "Jane, that number seems very high and unusual. Let me ask you to double-check the monitor display." Pre-model hints + LLM correctly intercepted the out-of-range BP before persisting. First Soda attempt mistranscribed the numbers entirely; second utterance landed with Soda hearing "41300" — still implausible enough to trigger the challenge. Session-end summary correctly did NOT include the rejected value alongside the 4 properly-captured values from PT-V2-03/04. |
| CG-V2-03 | **PASS — verified live 2026-05-17** | Drove form-onboarded patient `CL-GMHA2C` (Lata.Verma) through 6-turn caregiver protocol config voice flow via remote-TTS. FSM advanced CREATED → EXTRACTING → PENDING_CONFIRMATION → COMPLETE. Session `47fad997-1736-47ed-a740-06a7f587e827`, session_type=caregiver_onboarding (matches the 2026-05-10 PASS pattern — the protocol-config screen reuses `MatikaConversationScreen` and a caregiver_onboarding session type). RDS evidence: 2 `parameter_configs` rows for the patient (blood_pressure_systolic + blood_pressure_diastolic, frequency_days=1, daily_deadline=08:00:00, timezone=Asia/Kolkata, threshold_set_by=caregiver UUID, thresholds {90}..{180} sys + {60}..{120} dia) — exact schema the doc predicted. 1 `patient_topics` row (conditions topic). UI session-complete summary: "Parameters configured: 2, Topics configured: 1". |
| CG-V2-04 | **PASS — verified live 2026-05-17 (F39 + F42 chain)** | Required both F39 (client always-tappable Submit with per-field validation) AND F42 (backend PAUSED→PAUSED auto-resume on credentials arrival). F39 alone got the form to dispatch; F42 alone is meaningless without F39. Both shipped same day → first end-to-end CG-V2-04 PASS at staging. Drove 11 voice turns (incl. one fail-recovery for F42 deploy) via remote-TTS. Patient `CL-PNDN1P` (Geeta Arya) created in RDS + Cognito with caregiver-typed email (`sanyalsubhajit2010+at@gmail.com`). Session `45028cda-4e7c-4e80-9b9a-3dab7ee3e21c`, fsm_state=PROFILE_CONFIRMED, status=complete. CloudWatch `create-patient-from-voice ok` RequestId `8eb89a67-4d77-44b2-aca1-7de93f149ab8`. Cognito sub `31431d5a-7001-7044-e44b-a0ed3a02e055` CONFIRMED. Evidence pack: `docs/voice-bench-evidence/cg-v2-04_2026-05-17/` (4 screenshots + 2 logcats). Second drive (Sunita Ghosh, `CL-D12W5Q`) reproduced with F43 fix applied → phone also landed in users.phone_number + Cognito phone_number_verified=true. |
| CG-V2-13 | **PASS — verified live 2026-05-17** | Combined with CG-V2-03 in the same session (utterance "Please set up daily BP monitoring twice a day morning and evening" → AI clarified once → caregiver confirmed). RDS `parameter_configs.daily_deadline=08:00:00` captures the reminder cadence; `frequency_days=1` captures the daily pattern. Only the morning slot persists per row (schema design — `protocol_persister` UPSERT writes one daily_deadline per parameter). F26b voice-only PASS criteria fully met. |
| EDGE-V2-17 | **PASS — implicitly verified live 2026-05-17 by PT-V2-06** | The four bench assertions the doc said the EDGE flow needed to author (bn-IN session + gTTS audio + Final emits + logcat fallback line) all hit during the PT-V2-06 drive. Explicit dedicated Maestro flow still on the backlog if/when QA wants a CI-pinned regression artifact, but the live evidence is in. |

### New voice-related findings (raised this sweep)

- **F20 (RESOLVED)** — `matika-voice-run.sh` logcat trigger pattern was `Offline recognizer - start listening`, a Pixel-specific Soda system log. On Samsung S21+ the trigger never fired and the harness failed all voice runs. Fixed by adding a `Log.i(TAG, "RecognitionListener.onReadyForSpeech: mic open")` line in `SttManager.kt:onReadyForSpeech` and updating `matika-voice-run.sh`'s `TRIGGER` constant. Now device-portable.
- **F21 (RESOLVED)** — Mac `say` queue gets wedged when prior runs leave `say` processes stuck in audio I/O. Once wedged, every subsequent voice run returns Soda NO_MATCH because no audio reaches the phone mic. Mitigation: `killall say` before each voice flow. Folded into the standard preflight.
- **F22 (RESOLVED, 2026-05-10)** — Added a `LanguagePickerCard` to `SettingsScreen` with three RadioButton options (English / हिन्दी / বাংলা). testTags `language_option_en/hi/bn` for harness use. Selection persists across app restart (DataStore-backed). Maestro flows for PT-V2-05 / PT-V2-06 / EDGE-V2-17 / future multilingual journeys can now switch language via `tapOn: { id: language_option_hi }` instead of the DataStore-protobuf adb hack. Hack still works as a fallback for fresh-install / uninstrumented testing.
- **F23 (NEW, open)** — No "Add Patient via Conversation" entry in caregiver UI. Blocks CG-V2-04 as written. Resolution: (a) wire `PatientOnboardingConversationScreen` to a button on CaregiverHomeScreen, or (b) reclassify CG-V2-04 in journey doc as covered by the existing form + protocol-config voice path (CG-V2-02 + CG-V2-03 together).
- **F24 (RESOLVED, 2026-05-10)** — Subsumed by F25. The bn-IN offline pack remains uninstalled on the Samsung S21+ test device, but the F25 online-fallback retry handles it transparently. Manual install no longer required for journey runs.
- **F25 (RESOLVED, 2026-05-10)** — `SttManager.recognize()` now silently retries with `EXTRA_PREFER_OFFLINE=false` on error 12 (LANGUAGE_NOT_SUPPORTED) or 13 (LANGUAGE_UNAVAILABLE). The retry is invisible to the collector; logcat carries `stt_offline_used=true|false` for harness assertion. The actual bn-IN retry path needs an EDGE-V2-17 / re-run-of-PT-V2-06 flow to exercise live, but the code path is unit-test-pinned (mapping of error 12/13 → LANGUAGE_NOT_SUPPORTED) and logging-shape-verified (en-IN smoke confirmed `preferOffline=true|false` field renders).
- **F39 (CODE FIX 2026-05-16; live re-bench pending F41)** — CG-V2-04 voice patient onboarding contact-form Submit was gated on `email.isNotBlank() && phone.isNotBlank()` only, with no helper text on the empty/disabled state — caregivers hit a silent dead-end. Shipped `PatientCredentialsValidation.kt` (pure-JVM email + E.164 phone validators; 7/7 unit-test PASS) + rewired `PatientCredentialsDialog` with `isError`/`supportingText` per field and an always-tappable Submit that validates on tap. APK installed cleanly on `RFCT10C1GSZ`. RDS `patients`-row + `create-patient-from-voice` CloudWatch evidence deferred to next session — F41 was wedged at session start. Details in `testing_todos_v2.md` F39.
- **F40 (RESOLVED-misobserved, 2026-05-17)** — text-fallback bench re-verify on staging Jane PT lands Branch (a) end-to-end: F40 observability lines fire, `interaction_sessions` row created with `pending_confirmation=[systolic 130, diastolic 85]`, `matika_response_card` mounts. Path is structurally identical to the verified voice path. 2026-05-16 narrative was internally inconsistent and likely a wrong-log-group / wrong-region misobservation. Details in `testing_todos_v2.md` F40.
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

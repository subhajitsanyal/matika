# Matika v2 — User Journeys for Agentic Testing

**Version:** 2.0
**Date:** 2026-05-08
**Status:** Active reference for agentic UI test runs
**Replaces:** `docs/journeys.md` v3.0 (April 2026, CareLog v1 / Mac Mini era)

**Sources:**
- `docs/matika_prd_v2.md` (v2.0, May 2026) — product surface, MoSCoW priority, edge-case taxonomy
- `docs/matika_spec_v2.md` (v2.0, May 2026) — API contracts, state machine, escalation signals
- `docs/matika_implementation_plan_v2.md` — phase scope (what is built today)
- Code: `android/app/src/main/java/com/carelog/`, `backend/lambdas/bedrock-router/`, `web-portal/src/`
- Maestro flows: `.maestro/flows/`

---

## Why this document exists

This is the canonical script for agentic regression testing of Matika v2. Every reachable user-visible behavior is enumerated here as a numbered journey with:

- **Trigger** — what kicks the journey off
- **Pre-conditions** — environment / data state required
- **Step-by-step actions** — by the agent operating the app/portal, with concrete UI selectors
- **Voice script** (where speech is in scope) — exact utterances + Mac TTS commands to replay them through the speaker so the phone's mic captures them
- **Backend verification** — what AWS state should result (Cognito user, RDS row, S3 object, CloudWatch log line, FCM push, etc.)
- **Pass criteria** — observable signals that the journey succeeded

A journey runner agent should be able to pick a journey by ID and drive it end-to-end without further interpretation.

> **Naming.** Journey IDs are prefixed `PT-V2-…` (Patient), `CG-V2-…` (Caregiver), `DR-V2-…` (Doctor on web portal), `E2E-V2-…` (cross-persona), `EDGE-V2-…` (negative / edge). The `V2` prefix prevents collision with the v1 IDs in older specs.

---

## Table of contents

1. [Personas and interfaces](#1-personas-and-interfaces)
2. [Test environment](#2-test-environment)
3. [Agentic testing harness](#3-agentic-testing-harness)
4. [Patient journeys (Android)](#4-patient-journeys-android)
5. [Caregiver journeys (Android)](#5-caregiver-journeys-android)
6. [Doctor journeys (Web portal)](#6-doctor-journeys-web-portal)
7. [End-to-end / cross-persona journeys](#7-end-to-end--cross-persona-journeys)
8. [Speech-specific test matrix](#8-speech-specific-test-matrix)
9. [Edge cases and negative tests](#9-edge-cases-and-negative-tests)
10. [Per-journey run commands](#10-per-journey-run-commands)
11. [Pass criteria summary](#11-pass-criteria-summary)

---

## 1. Personas and interfaces

| Persona | Interface | Cognito group | Custom attributes | Onboarded by |
|---|---|---|---|---|
| **Patient** | Android app `com.carelog` (voice-first) | `patients` | `custom:persona_type=patient`, `custom:linked_patient_id=<self sub>` | Caregiver |
| **Caregiver** | Android app `com.carelog` | `caregivers` | `custom:persona_type=caregiver` | Self-registration |
| **Doctor** | Web portal (React/Vite) | `doctors` | `custom:persona_type=doctor` | Caregiver invite + doctor self-registration |
| **(Admin)** | Web portal admin views | `admins` | — | Manual provisioning at pilot scale |

Relationships: 1 caregiver ⟷ 1 patient (pilot constraint). 1 patient ⟷ ≥1 doctors. Doctors cannot onboard patients (FR-25).

> v2 has no attendant persona. Audit journeys referring to attendants are out of scope until the attendant feature returns post-pilot.

---

## 2. Test environment

| Resource | Value (dev) |
|---|---|
| AWS region | `ap-south-1` (storage); cross-region inference profile in `ap-southeast-1` |
| Cognito user pool | `ap-south-1_1TcE4vTTi` (carelog-dev) |
| API Gateway base | `https://<api-id>.execute-api.ap-south-1.amazonaws.com/dev` |
| Bedrock models | `apac.anthropic.claude-haiku-4-5-v1:0` (T2), `apac.anthropic.claude-sonnet-4-x-v1:0` (T3) |
| Android device | Samsung S21+ (`RFCT10C1GSZ`) over USB; `adb devices` must show `device` |
| APK | `android/app/build/outputs/apk/debug/app-debug.apk` (`./gradlew :app:assembleDebug`) |
| Build flag | `USE_V2_INFERENCE=true` in `core/BuildConfig` (verify at run time) |
| Web portal | `http://localhost:5173` (`cd web-portal && npm run dev`) |
| Test creds | `~/.matika-test-creds.env` (sourced by `scripts/maestro-run.sh`) |

**Test creds file shape:**
```bash
export MATIKA_CAREGIVER_EMAIL="sanyalsubhajit2010+cg@gmail.com"
export MATIKA_CAREGIVER_PASSWORD="..."
export MATIKA_PATIENT_EMAIL="sanyalsubhajit2010+pt@gmail.com"
export MATIKA_PATIENT_PASSWORD="..."
export MATIKA_DOCTOR_EMAIL="sanyalsubhajit2010+dr@gmail.com"
export MATIKA_DOCTOR_PASSWORD="..."
export MATIKA_TEST_EMAIL_BASE="sanyalsubhajit2010"   # used by Maestro JS hook for unique aliases
```

---

## 3. Agentic testing harness

Three drivers, glued by a journey runner agent:

| Driver | Use for | Tool |
|---|---|---|
| **Maestro** | Android UI (taps, text input, screen assertions) | `scripts/maestro-run.sh <flow>` |
| **Mac speaker injection** | Voice into the phone's mic | `say -v <voice>` over SwitchAudioSource → External Headphones → device mic |
| **AWS CLI / `psql`** | Backend state verification | `aws cognito-idp …`, `aws s3 ls …`, `aws logs tail …`, `psql` via SSM tunnel |

### 3.1 Maestro

Already wired — see `.maestro/flows/` and `scripts/maestro-run.sh`. Key facts:

- All Compose `Modifier.testTag(...)` are addressable as Maestro `id:` because `MainActivity` sets `Modifier.semantics { testTagsAsResourceId = true }` at the root.
- `extendedWaitUntil:visible:timeout:` is the wait primitive; `assertVisible` and `tapOn` are point-in-time.
- Maestro **does not** inherit shell env. The runner forwards creds via `--env`.
- Idempotent flows generate fresh patient emails via `.maestro/scripts/generate_patient_email.js` (timestamp suffix), because Cognito enforces email uniqueness.

### 3.2 Voice injection through the Mac speaker

> The phone's `SpeechRecognizer` doesn't accept synthetic audio injection over ADB. The reliable path is **acoustic**: Mac speaks the utterance through External Headphones; the phone — placed near the speaker — picks it up via mic.

**Pre-flight (run once before a session):**

```bash
# Confirm the harness is wired up.
command -v SwitchAudioSource >/dev/null || brew install switchaudio-osx
SwitchAudioSource -t output -s "External Headphones"
SwitchAudioSource -c                        # → "External Headphones"

# Make sure the phone's mic is roughly 6-12 inches from the speaker, low ambient noise.
adb shell settings put system volume_music 7   # phone media volume mid-high
osascript -e "set volume output volume 80"     # Mac output volume; tune if STT misses
```

**Available voices on this Mac:**

| Locale | Voice | Use for | Note |
|---|---|---|---|
| `en_IN` | `Rishi` | English India | `say -v Rishi -r 175 "..."` |
| `hi_IN` | `Lekha` | Hindi India | `say -v Lekha -r 165 "..."` |
| `bn_IN` | _(none)_ | Bengali | macOS lacks a native Bengali voice. **Test Bengali manually** with a human speaker, or stage a pre-recorded `.aiff/.wav` and play it via `afplay`. |

**Helper: speak via External Headphones, with optional pre-delay.**

```bash
matika-say() {
    local voice="$1"; local rate="$2"; local utterance="$3"; local delay_ms="${4:-800}"
    SwitchAudioSource -t output -s "External Headphones" >/dev/null
    sleep "$(echo "scale=3; $delay_ms/1000" | bc)"
    say -v "$voice" -r "$rate" "$utterance"
}
```

**Concurrency pattern (Maestro tap → wait → speak):**

```bash
# Tap the mic in the background, then speak.
( scripts/maestro-run.sh patient_voice_bp_en --no-install ) &
sleep 6                          # wait for app to reach conversation screen + mic tap
matika-say Rishi 175 "My blood pressure is one thirty over eighty five." 800
wait
```

**Best practice for the journey runner:**

1. Drive Maestro until the mic is tapped (`tapOn id: matika_mic`), then `assertVisible: id: matika_listening_indicator`.
2. Issue the `say` command from the runner shell.
3. Wait for the response card / TTS ack (`extendedWaitUntil notVisible: "thinking"`).
4. Loop for multi-turn conversations.

### 3.3 Web portal driver

The web portal currently lacks `data-testid` attributes (audited 2026-05-08). For Doctor journeys use **Playwright** with role/text selectors:

```bash
cd web-portal
npx playwright install chromium       # one-off
node scripts/run-journey.mjs DR-V2-01
```

Selectors used in this doc are stated as `getByRole('…')` / `getByLabel('…')` / `getByText('…')`. If the journey runner finds these flaky, add `data-testid` and update this doc — do not switch to fragile CSS selectors.

### 3.4 Backend verification primitives

Each journey lists which checks to run after the UI step. Patterns:

```bash
# Cognito user exists in the right group
aws cognito-idp admin-get-user --user-pool-id ap-south-1_1TcE4vTTi --username "$EMAIL"
aws cognito-idp admin-list-groups-for-user --user-pool-id ap-south-1_1TcE4vTTi --username "$EMAIL"

# Lambda recently invoked
aws logs tail /aws/lambda/carelog-dev-bedrock-router --since 5m --format short

# FHIR Observation written
aws s3 ls "s3://carelog-v2-dev-documents-316643066568/observations/$COGNITO_SUB/" --recursive | tail

# RDS row (via SSM tunnel; assumes ~/terraform.tfstate has the bastion id)
psql "postgres://carelog:$PASS@127.0.0.1:5433/carelog" -c \
  "SELECT * FROM model_call WHERE patient_id='$PID' ORDER BY created_at DESC LIMIT 5;"

# FCM push received
aws sns list-platform-applications --query 'PlatformApplications[?contains(PlatformApplicationArn,`carelog-dev`)]'
```

The journey runner should embed these checks inline so a single failure pinpoints the broken layer (UI vs. Lambda vs. data).

### 3.5 testTag inventory (Android — used in journeys)

| Screen | testTag | Element |
|---|---|---|
| Login | `login_email`, `login_password`, `login_button` | Sign-in form |
| Register | `register_name`, `register_email`, `register_phone`, `register_password`, `register_confirm_password`, `register_terms_checkbox` | Caregiver self-reg form |
| Forgot password | `forgot_password_email`, `forgot_password_send_code`, `forgot_password_code`, `forgot_password_new_password`, `forgot_password_confirm` | |
| Patient home | `patient_home_start_conversation` | Primary CTA into v2 conversation |
| Caregiver home | `onboard_patient_fab`, `patient_card_<id>` | Add Patient FAB; per-patient row |
| Patient onboarding form | `onboarding_name`, `onboarding_email`, `onboarding_dob`, `onboarding_gender`, `onboarding_create_button`, `onboarding_error` | Form-based create-patient |
| Matika conversation | `matika_mic`, `matika_text_fallback`, `matika_text_send` | v2 conversation surface |
| BP screen | `bp_save_button` | |
| Glucose | `glucose_save_button` | |
| Temperature | `temperature_save_button` | |
| Weight | `weight_save_button` | |
| Pulse | `pulse_save_button` | |
| SpO₂ | `spo2_save_button` | |
| Save acknowledgement (manual log) | `save_acknowledgement` | |
| Alerts | `alert_card_<alertId>` | |
| Patient log (caregiver view) | `interaction_card_<sessionId>` | |
| Settings | `settings_sign_out`, `settings_action_<lowercased title>` | |

Add new tags as journeys uncover untestable screens; keep the inventory current.

### 3.6 Test data setup

Before any run:

1. `source ~/.matika-test-creds.env`
2. `adb devices` → exactly one `device` line.
3. `(cd android && ./gradlew :app:assembleDebug)` — produces a fresh APK if Kotlin changed.
4. `scripts/maestro-run.sh` (no args) installs APK, force-stops the app, runs all flows. Use `--no-install` once the APK is current.

For voice-bearing journeys: place the phone speaker-side-up next to External Headphones, ambient noise low, ringer on max.

---

## 4. Patient journeys (Android)

### PT-V2-01 · First login (post-onboarding)

**Trigger:** Patient receives credentials from caregiver (PT-V2-01 follows CG-V2-02).
**Pre:** Cognito user in `patients` group with `custom:persona_type=patient`.
**Steps:**
1. Launch app (`launchApp clearState: true`).
2. `extendedWaitUntil id: login_email` → input `${MATIKA_PATIENT_EMAIL}`.
3. `tapOn id: login_password` → input `${MATIKA_PATIENT_PASSWORD}`.
4. `hideKeyboard` → `tapOn id: login_button`.
5. `extendedWaitUntil id: patient_home_start_conversation` (timeout 30s — cold dashboard fetch).

**Backend verification:**
- `aws cognito-idp admin-get-user … --username $MATIKA_PATIENT_EMAIL` returns `UserStatus=CONFIRMED` (first-time patients may be `FORCE_CHANGE_PASSWORD`; in that case the app enters a "set new password" flow — covered by EDGE-V2-04).

**Pass:** Patient home screen visible with `patient_home_start_conversation` button.

---

### PT-V2-02 · Patient home orientation

**Trigger:** Authenticated patient lands on home.
**Steps:** Visual / a11y assertions only.
1. `assertVisible "Matika"` (top app bar).
2. `assertVisible id: patient_home_start_conversation`.
3. Optional: assert tab bar items (Home, History, Chat, Settings) — **add testTags before automating** (currently text-only).

**Pass:** Start Conversation CTA visible and enabled.

---

### PT-V2-03 · Daily voice logging — single parameter (English)

**Trigger:** Patient taps Start Conversation.
**Pre:** Patient has at least `blood_pressure_systolic` + `…_diastolic` in `parameter_configs`.
**Steps:**
1. PT-V2-01.
2. `tapOn id: patient_home_start_conversation`.
3. Grant mic permission if prompted (`tapOn text: "Allow|While using the app" optional: true`).
4. `extendedWaitUntil id: matika_mic timeout: 30000`.
5. `tapOn id: matika_mic`.

**Voice script:**
- Turn 1 (Mac speaks via Rishi): _"My blood pressure is one thirty over eighty five."_
- Wait for response card; expect Haiku confirmation _("I heard one thirty over eighty five. Is that correct?")_.
- Turn 2 (Mac speaks): _"Yes, that's correct."_
- Wait for either next-parameter prompt or `Session complete`.

```bash
( scripts/maestro-run.sh patient_voice_bp_en --no-install ) &
sleep 7 ; matika-say Rishi 175 "My blood pressure is one thirty over eighty five." 600
sleep 8 ; matika-say Rishi 175 "Yes, that's correct." 400
wait
```

**Backend verification:**
- `model_call` row with `tier='T2'`, `model='claude-haiku-4-5'`, `guardrail_blocked=false`, `latency_ms < 2500`.
- `interaction_session.streaming_used=false`, `inference_region='ap-southeast-1'`.
- S3: `s3://…/observations/$COGNITO_SUB/$YEAR/$MONTH/$DAY/<id>.json` containing LOINC `8480-6` (systolic 130 mmHg) and `8462-4` (diastolic 85 mmHg).
- CloudWatch `bedrock-router` log shows `escalationReason=null` and a single InvokeModel call.

**Pass:** All three checks green; UI eventually shows session-complete card or moves to next parameter.

---

### PT-V2-04 · Daily voice logging — multi-parameter (English)

**Pre:** `parameter_configs` includes BP + glucose + weight.
**Voice script:**
1. Mac: _"My BP is one twenty over seventy eight, my sugar this morning was one ten, and I weigh seventy two kilograms."_
2. App reads each value back individually; on each prompt Mac says _"Yes."_

**Pass:** Three observations persisted (`8480-6`, `8462-4`, `2339-0`, `29463-7`) under the patient's S3 prefix; `actions: ["complete_session"]` in the final turn's stored output.

---

### PT-V2-05 · Daily voice logging — Hindi

**Voice script (Lekha):** _"मेरा रक्तचाप एक सौ चालीस बटा नब्बे है।"_ ("My BP is 140 over 90.") Confirm with _"हाँ, सही है।"_

**Backend:** `interaction_session.language='hi-IN'`; FHIR Observation values 140/90 with normal LOINC codes; expect `tier='T2'` unless the value 140/90 is at the implausibility soft-edge for that patient (then PT-V2-08 applies).

**Pass:** Same as PT-V2-03 with Hindi `responseText` returned by Bedrock.

---

### PT-V2-06 · Daily voice logging — Bengali (manual or pre-recorded)

macOS has no native Bengali `say` voice. Two options:

- **Manual:** A human speaks the Bengali utterance into the phone's mic at the same point the Maestro flow would have triggered audio. Mark as `MANUAL` in the run report.
- **Pre-recorded:** Stage `test-automation/audio/bn-IN-bp-130-85.aiff`. Replace `matika-say` with `afplay test-automation/audio/bn-IN-bp-130-85.aiff`.

**Pass:** Bedrock returns Bengali response; Observation written. STT correction-rate captured for Bengali per FR-23 risk monitoring.

---

### PT-V2-07 · Text-input fallback (deterministic)

This is the path Maestro actually exercises today (`patient_logging_happy_path.yaml`). Use it as the primary CI flow because it eliminates STT variance.

**Steps:** PT-V2-01 → tap `matika_mic` not necessary; tap `matika_text_fallback`, type, tap `matika_text_send`.

**Voice script:** _N/A — typed input._

**Pass:** Same as PT-V2-03.

---

### PT-V2-08 · Implausible value challenge (T3 escalation)

**Voice script:** _"My blood pressure is three hundred over two hundred."_

**Expected behaviour:**
- `bedrock-router` detects `implausible_value` (plausibility table in system prompt; BP systolic > 250 mmHg = hard).
- Escalates to Sonnet (`tier='T3'`, `escalationReason='implausible_value'`).
- App reads back: _"That's unusually high — could you re-check the reading?"_
- Patient: _"Sorry, it was one thirty over ninety."_ → flow continues.

**Backend:** Two `model_call` rows for the turn — first Haiku attempt (or skipped pre-call), then Sonnet. Final Observation 130/90.

**Pass:** UI surfaces a re-check prompt and ultimately records the corrected value.

---

### PT-V2-09 · Emergency keyword detection

**Voice script:** _"I have severe chest pain right now."_

**Expected:** App ends the session immediately with an emergency card. `bedrock-router` records `tier='T3'`, `escalationReason='emergency'`. SQS → notification-sender → FCM push to the linked caregiver within 60 seconds.

**Backend verification:**
- CloudWatch `notification-sender` log entry referencing the patient and an `emergency` payload type within 60s of the Sonnet call.
- The caregiver's device — if logged in — receives a high-priority push (`adb logcat | grep FCM` from a second device).
- `interaction_session.escalations_triggered` JSONB array contains `"emergency"`.

**Pass:** Emergency UI shown; FCM push delivered to caregiver within 60s.

---

### PT-V2-10 · Photo-based device reading (ML Kit happy path)

**Steps:**
1. PT-V2-03 to point of mic active.
2. Voice: _"I just measured but I forget the value."_
3. `bedrock-router` returns `actions: [{type: 'request_photo'}]`.
4. App opens camera. Place a glucometer (or a printed mock with a 7-segment digit display).
5. Capture; ML Kit on-device extracts `142`.
6. App reads back: _"I see one forty two milligrams per decilitre. Is that right?"_
7. Voice: _"Yes."_

**Pass:** Observation `2339-0` value=142 written. `model_call` row absent for the OCR step (ML Kit is on-device); `cost_telemetry.ocr_local_calls` increments by 1.

---

### PT-V2-11 · Photo-based reading — Bedrock vision fallback

**Variant of PT-V2-10:** photograph the device under glare or with reflection so ML Kit returns confidence < 0.85.

**Expected:** App calls `POST /conversation/photo-extract`; `bedrock-vision` invokes Haiku vision; on Haiku low confidence, escalates to Sonnet. UI flow identical from the patient's perspective.

**Backend:**
- `cost_telemetry.vision_haiku_calls += 1` (and `vision_sonnet_calls += 1` if escalated).
- `bedrock-vision` log shows the chain.

---

### PT-V2-12 · Photo extraction failure (422)

**Variant:** photograph a blank surface.

**Expected:** App receives 422; LLM falls back to: _"I couldn't read that — could you re-take the photo or speak the value?"_ Patient says the value verbally; flow continues.

**Pass:** Recovery without a crash; final Observation persisted via voice path.

---

### PT-V2-13 · Connectivity loss mid-session

**Steps:**
1. Start a session (PT-V2-03 to mid-conversation).
2. `adb shell svc wifi disable && adb shell svc data disable`.
3. Speak a turn.
4. App surfaces "Reconnecting…" within 5s.
5. Re-enable: `adb shell svc wifi enable`.

**Expected:** Within 30s the app resumes; the buffered turn is replayed; if down > 30s the app prompts: _"Your connection dropped — please retry later."_

**Pass:** No crash; either resume succeeds or graceful prompt; previously confirmed values are preserved.

---

### PT-V2-14 · Per-patient hard rate limit (429)

**Steps:** Drive PT-V2-07 in a loop. After ~500 calls the Lambda returns 429.

**Expected:**
- App shows: _"Unusual session activity — please contact support."_
- Caregiver receives a "session locked" FCM push.
- `bedrock-router` log: `Hard rate limit hit for patient $PID`.

**Pass:** UI lock state; backend log + FCM push observed.

---

### PT-V2-15 · Manual log — Blood Pressure

**Steps:** PT-V2-01 → tap "Blood Pressure" tile → enter 120 / 80 → `tapOn id: bp_save_button`.

**Pass:** `save_acknowledgement` testTag visible; Observation with LOINC `8480-6`+`8462-4` written.

---

### PT-V2-16…PT-V2-20 · Manual logs (Glucose, Temperature, Weight, Pulse, SpO₂)

Same shape as PT-V2-15 with corresponding `<param>_save_button` tag and LOINC code:

| Journey | Param | testTag | LOINC | Unit |
|---|---|---|---|---|
| PT-V2-16 | Glucose | `glucose_save_button` | `2339-0` | mg/dL |
| PT-V2-17 | Temperature | `temperature_save_button` | `8310-5` | °F or °C |
| PT-V2-18 | Weight | `weight_save_button` | `29463-7` | kg |
| PT-V2-19 | Pulse | `pulse_save_button` | `8867-4` | /min |
| PT-V2-20 | SpO₂ | `spo2_save_button` | `2708-6` | % |

**Edge:** SpO₂ > 100, Temperature > 110 °F, BP systolic = 0 → save button stays disabled or validation message shown (assert via `onboarding_error`-style error tag — add one if missing).

---

### PT-V2-21 · View vital history (manual logs)

**Steps:** Tap History tab. Assert most-recent entry from PT-V2-15 visible with timestamp & value.

**Pass:** Entry visible within 5s.

---

### PT-V2-22 · Settings — view care team (read-only)

**Steps:** Tap Settings → Care Team.

**Pass:** Linked caregiver visible; **no** Invite or Remove buttons (FR-25 / patient cannot manage care team).

---

### PT-V2-23 · Cross-region inference disclosure (consent)

**Trigger:** First post-install login.

**Pass:** Consent screen explicitly mentions cross-region inference (text from `docs/matika_prd_v2.md` §12.2). User must `tapOn "I Accept"`. RDS `consents` row written with version hash and `cross_region_disclosed=true`.

---

### PT-V2-24 · Reminder push → opens conversation

**Pre-step:** Trigger `check-daily-deadline` Lambda manually:
```bash
aws lambda invoke --function-name carelog-dev-check-daily-deadline /tmp/out.json
```
**Expected:** FCM push to the patient device. `adb shell input keyevent KEYCODE_WAKEUP`; tap notification.

**Pass:** App opens directly on `MatikaConversationScreen`.

---

## 5. Caregiver journeys (Android)

### CG-V2-01 · Self-registration with cross-region consent

**Steps:**
1. `launchApp clearState: true`.
2. From Login → "Create Account".
3. Inputs: `register_name`, `register_email` (+cgN unique alias), `register_phone`, `register_password`, `register_confirm_password`, `register_terms_checkbox`.
4. Submit. Verification email arrives; capture code from a Gmail check.
5. Enter code; accept v2 consent screen (cross-region inference disclosure visible).

**Backend:**
- Cognito user in `caregivers` group, `UserStatus=CONFIRMED`, `custom:persona_type=caregiver`.
- `consents` row with version hash and `cross_region_disclosed=true`.
- post-confirmation Lambda log shows RDS insert.

**Pass:** Caregiver lands on `CaregiverHomeScreen`.

---

### CG-V2-02 · Form-based patient onboarding (current Maestro coverage)

**Pre:** CG-V2-01 done; caregiver authenticated.
**Steps:**
1. `extendedWaitUntil id: onboard_patient_fab timeout: 60000` → tap.
2. Fill `onboarding_name`, `onboarding_email` (unique alias via Maestro JS hook), optional DOB/gender.
3. `hideKeyboard`; `scrollUntilVisible id: onboarding_create_button`; tap.
4. Wait for "Patient Account Created" dialog; tap "Done".
5. With `USE_V2_INFERENCE=true` and a `cognito_sub` returned, the app navigates to `MatikaConversationScreen` in caregiver-protocol-config mode.

**Backend:**
- New patient Cognito user in `patients` group with `custom:linked_patient_id=<self sub>`.
- RDS rows in `patient`, `persona_links`, `parameter_configs` (default protocol).
- `create-patient` Lambda response includes `cognito_sub` (this was the v2.0 contract change).

**Pass:** Patient created; caregiver lands on `MatikaConversationScreen` with `matika_text_fallback` testTag visible (proves v2 routing).

> This is the canonical Maestro caregiver flow today (`.maestro/flows/caregiver_protocol_setup.yaml`). It runs without voice and is the CI gate.

---

### CG-V2-03 · Conversational protocol configuration (T3, voice)

**Trigger:** Continuation of CG-V2-02 (or "Configure Protocol" entry).
**Session type:** `caregiver_config` — the system prompt forces Sonnet by default for caregiver sessions.

**Voice script (Rishi):**
1. _"I want to track Mom's blood pressure every morning, fasting blood sugar twice a week, and weight on Sundays."_
2. App asks for the daily deadline. _"Six PM."_
3. App asks about thresholds. _"Standard for now."_
4. App reads back the protocol summary. _"That's correct."_

**Backend:**
- `model_call` rows with `tier='T3'`, `model='claude-sonnet-4-x'`, `escalationReason='caregiver_protocol_design'`.
- `interaction_session.streaming_used=true` (caregiver default).
- `parameter_configs` rows for each parameter with `frequency_days` and `daily_deadline_local`.

**Pass:** Protocol summary displayed; backend rows match the spoken protocol.

> Today's CI gate (caregiver_protocol_setup.yaml) deliberately stops at "Sonnet responded after first turn" — multi-turn determinism for protocol completion isn't reliable yet. Treat the full multi-turn flow as **manual or LLM-judged** until that's fixed.

---

### CG-V2-04 · Conversational patient onboarding (Sonnet, voice)

**Trigger:** "Add Patient via Conversation" entry (alternative to the form CG-V2-02).
**Session type:** `caregiver_onboarding` — Sonnet default.

**Voice script:** _"This is for my mother, Sushila Devi. She's 78, lives with me, has type 2 diabetes and high blood pressure. Her cardiologist is Dr. Ramesh Sharma."_

**Pass:** Sonnet extracts a structured profile; confirmation card matches; tapping Confirm calls `create-patient` exactly as the form path does.

---

### CG-V2-05 · Caregiver dashboard overview

**Steps:** Login → assert patient cards, alert badge, last-session card.

**Pass:** Dashboard renders within 60s (cold-Lambda budget).

---

### CG-V2-06 · View patient logs

**Steps:** Tap a `patient_card_<id>` → "View Logs" → assert at least one `interaction_card_<sessionId>`.

**Known fix point:** PatientLogScreen previously crashed on null `timestamp` / `status`; now guarded — assert no NPE in logcat.

---

### CG-V2-07 · Receive threshold breach push (CG side of E2E-V2-02)

**Trigger:** Patient logs a value above threshold (PT-V2-15 or voice).

**Pass:** FCM push received within 60s ("Alert: High BP — Ramesh's BP is 165/100 above 140/90"). Tapping the push opens the AlertList; alert is unread.

---

### CG-V2-08 · Receive missed-measurement push

**Trigger:** Manually invoke `check-missed-measurements` Lambda after intentionally skipping a configured cadence.

**Pass:** Push received; backend dedup ensures no duplicate within 24h.

---

### CG-V2-09 · Receive emergency push (CG side of PT-V2-09)

**Pass:** High-priority push; tapping opens emergency UI summary in caregiver app.

---

### CG-V2-10 · Invite doctor

**Steps:** Settings → Care Team → Invite Doctor → enter name + email → Send.

**Backend:**
- `invite-doctor` Lambda invocation; SES email sent; `invites` table row with `status=pending`.

**Pass:** UI confirms send; Care Team shows "Pending — Dr. X".

---

### CG-V2-11 · Manage care team — remove member

**Steps:** Settings → Care Team → tap member → Remove.

**Backend:** `persona_links` row removed; `custom:linked_patient_id` cleared on the removed user.

---

### CG-V2-12 · Configure thresholds manually

**Steps:** Patient detail → Thresholds → set BP min=90, max=140 → Save.

**Backend:** `PUT /patients/{id}/thresholds`; `parameter_configs.threshold_min/max` updated. Doctor-set thresholds remain locked.

---

### CG-V2-13 · Configure reminders manually

**Steps:** Patient detail → Reminders → set per-vital window/grace.

---

### CG-V2-14 · Accept doctor recommendation (T3)

**Pre:** DR-V2-04 done — at least one pending recommendation.
**Steps:** Start config conversation; Sonnet presents the recommendation; caregiver says _"Yes, add it."_

**Backend:** `recommendations.status=accepted`; `parameter_configs` row added; `escalationReason='caregiver_protocol_design'` (and possibly `cross_session_continuity` for the patient's next session).

---

### CG-V2-15 · Reject doctor recommendation

**Voice:** _"No, let's skip that for now."_ → `recommendations.status=rejected`.

---

### CG-V2-16 · Delete patient (cascade)

**Steps:** Patient detail → Settings → Delete Patient → type patient name → confirm.

**Backend:** `delete-patient` Lambda cascades RDS rows + S3 prefix + Cognito disable. Care Team members unlinked.

> Pre-pilot caveat: the delete-patient route Lambda is in v1 backlog ("delete-patient route Lambda wire-up"). Until wired, mark this journey **expected fail** and verify only the Cognito-disable side path manually.

---

### CG-V2-17 · View trends

**Steps:** Tap "Trends" → assert chart for default vital + 7-day range.

**API:** `GET /patients/{id}/observations`.

---

### CG-V2-18 · Sign out

**Steps:** Settings → `settings_sign_out`.

**Pass:** Tokens cleared from Keystore; lands on Login screen.

---

## 6. Doctor journeys (Web portal)

> The web portal lacks `data-testid` attributes today. Selectors below use Playwright role/text. **Adding `data-testid` is in scope** before agentic doctor tests are reliable; the journey runner should propose tags as it encounters flakiness.

### DR-V2-01 · Doctor accepts caregiver invite and registers

**Trigger:** CG-V2-10 fired; doctor receives email with sign-up link.
**Steps:** Open invite link → Cognito sign-up → email verification → linked to patient.

**Pass:** `doctors` group; `persona_links` row to patient; redirected to `PatientListPage`.

---

### DR-V2-02 · Doctor login

**Steps:** Open `http://localhost:5173` → Login form → enter `MATIKA_DOCTOR_EMAIL/PASSWORD` → Submit.

**Selectors:** `getByLabel('Email')`, `getByLabel('Password')`, `getByRole('button', { name: /sign in/i })`.

**Pass:** Lands on `PatientListPage` (URL ends with `/patients`).

---

### DR-V2-03 · Patient list — view linked patients

**Steps:** Assert at least one row.

**Pass:** Patient name + last-session timestamp visible.

---

### DR-V2-04 · Patient detail — view longitudinal vitals

**Steps:** Click a patient row → `PatientViewPage`. Assert charts for BP, glucose, weight; date-range filter present.

**Backend:** `GET /patients/{id}/observations?vitalType=…&startDate=…&endDate=…`.

**Pass:** Charts render; data points match what was logged in PT-V2-03/04.

---

### DR-V2-05 · Doctor adds parameter recommendation

**Steps:** From PatientView → "Add Recommendation" → choose parameter (e.g., fasting glucose) → enter rationale → Submit.

**Backend:** `POST /patients/{id}/recommendations` row with `status=pending`, `source=doctor`. Surfaces to caregiver in CG-V2-14.

---

### DR-V2-06 · Doctor edits thresholds (override caregiver)

**Steps:** PatientView → Thresholds → edit BP max → Save.

**Backend:** `PUT /patients/{id}/thresholds` with `set_by=doctor`; caregiver's threshold edit UI shows fields locked with "Set by Dr. X".

---

### DR-V2-07 · Doctor logout

**Pass:** Cognito session cleared; back on Login page.

---

### DR-V2-08 · (Admin) view cost telemetry

**Pre:** User is in `admins` Cognito group.
**Steps:** Admin tab → Cost & Telemetry. Assert per-patient daily cost, escalation rate, latency P95 widgets.

**Backend:** `GET /admin/telemetry/cost?…` returns aggregates from `cost_telemetry` table.

> Today's web portal source has only `LoginPage`, `DoctorRegistrationPage`, `PatientListPage`, `PatientViewPage`. Anything beyond DR-V2-04 may be **not yet implemented** — flag in the run report.

---

## 7. End-to-end / cross-persona journeys

### E2E-V2-01 · Onboarding to first log

1. CG-V2-01 (caregiver self-reg).
2. CG-V2-02 (form-based patient creation).
3. CG-V2-03 (voice protocol config).
4. CG-V2-10 (invite doctor) → DR-V2-01 (doctor self-reg).
5. PT-V2-01 (patient first login).
6. PT-V2-03 (first voice log).
7. CG-V2-05 verifies dashboard reflects new values.
8. DR-V2-04 verifies doctor sees the values.

**Pass:** All steps green; chain of S3/RDS rows reachable end-to-end.

---

### E2E-V2-02 · Threshold breach alert cycle

1. PT-V2-15 (manual log BP 165/100 with caregiver max=140).
2. `evaluate-thresholds-batch` Lambda fires (within 60s of sync).
3. CG-V2-07 receives FCM push within 60s; alert visible in UI.

---

### E2E-V2-03 · Missed-measurement alert cycle

1. Skip a configured measurement past its frequency window.
2. Manually invoke `check-missed-measurements`.
3. CG-V2-08 receives push.

---

### E2E-V2-04 · Emergency end-to-end

1. PT-V2-09 (patient says "chest pain").
2. CG-V2-09 receives high-priority push within 60s.
3. `interaction_session.escalations_triggered` JSONB contains `"emergency"`.

---

### E2E-V2-05 · Cross-session continuity (new parameter introduced gently)

1. CG-V2-14 (caregiver accepts doctor recommendation for fasting glucose).
2. Patient starts the next session (PT-V2-03).
3. First turn: app introduces fasting glucose gently — _"Were you told about checking fasting sugar this week?"_ — `escalationReason='cross_session_continuity'`.

---

### E2E-V2-06 · Reminder lapse → patient logs

1. Daily deadline passes.
2. `check-daily-deadline` fires; PT-V2-24 push to patient.
3. Patient logs via PT-V2-03; reminders stop.

---

## 8. Speech-specific test matrix

For voice-bearing journeys, vary three axes. Run at least one cell per axis to detect regressions in STT, LLM, or TTS.

| Axis | Values |
|---|---|
| **Language** | en-IN (Rishi), hi-IN (Lekha), bn-IN (manual / pre-recorded) |
| **Parameter** | BP, glucose, temperature, weight, pulse, SpO₂ |
| **Condition** | quiet room; noisy ambient (TV at low volume); fast speech (`-r 220`); slow speech (`-r 130`); code-switch (en+hi mid-utterance) |

Sample utterance set (English, Rishi):

| Param | Utterance |
|---|---|
| BP | "My blood pressure is one thirty over eighty five." |
| Glucose | "My fasting sugar is one ten." |
| Temperature | "My temperature is ninety nine point one Fahrenheit." |
| Weight | "I weigh seventy two point five kilograms." |
| Pulse | "My pulse is seventy six beats per minute." |
| SpO₂ | "Oxygen saturation is ninety eight percent." |

Sample utterance set (Hindi, Lekha):

| Param | Utterance |
|---|---|
| BP | "मेरा रक्तचाप एक सौ तीस बटा अस्सी है।" |
| Glucose | "खाली पेट शुगर एक सौ दस है।" |
| Weight | "मेरा वज़न बहत्तर किलो है।" |

**Pass criterion per cell:** the value extracted by Bedrock matches the spoken value within ±0; the response is in the same language as the input.

**Code-switch density check (PT-V2-25 implicit):** an utterance with > 30% non-primary-language tokens should trigger `escalationReason='code_switch_density_high'` and tier=T3. Example: _"मेरा BP one thirty over eighty five hai aaj subah."_

---

## 9. Edge cases and negative tests

### EDGE-V2-01 · Registration validation

| Input | Expected |
|---|---|
| Invalid email format | "Enter a valid email" inline |
| Weak password | Cognito policy errors listed |
| Mismatched confirm | "Passwords don't match" |
| Already-used email | `UsernameExistsException` surfaced as "Account already exists" |
| Wrong verification code | "Invalid code — request a new one" |

### EDGE-V2-02 · Login validation

| Scenario | Expected |
|---|---|
| Wrong password | Cognito `NotAuthorizedException` surfaced |
| Disabled user | Cognito `UserDisabledException` surfaced |
| Soft keyboard covers Sign In | flow uses `hideKeyboard` before tap (regression test) |

### EDGE-V2-03 · Bedrock Guardrail block

**Trigger:** A turn whose output would suggest a specific medication dosage.

**Expected:** `bedrock-router` returns 200 with `responseText="I can't advise on dosage — please ask the doctor."`. `model_call.guardrail_blocked=true`.

### EDGE-V2-04 · `FORCE_CHANGE_PASSWORD` first-time login

**Pre:** patient created with temporary password.
**Expected:** App enters Cognito's "set new password" flow; subsequent logins succeed.

### EDGE-V2-05 · JWT refresh

**Trigger:** Leave app idle > 1 hour, then resume.
**Expected:** Silent refresh; no re-auth prompt.

### EDGE-V2-06 · JWT refresh-token expiry (30 days)

**Expected:** Forced logout; redirect to Login.

### EDGE-V2-07 · Cognito email collision on patient creation

**Trigger:** Caregiver tries to create a patient with an email already in Cognito.
**Expected:** `UsernameExistsException` surfaced as `onboarding_error` testTag with a useful message — not a silent failure.
**Note:** Even after deleting the Cognito user, an orphan RDS row will block reuse — verify cleanup deletes both.

### EDGE-V2-08 · Bedrock cross-region failover

**Trigger:** Inject a 5xx from `ap-southeast-1` (chaos test or use a fake env profile).
**Expected:** `bedrock-router` retries against `us-east-1` profile; `inference_region` column reflects the fallback.

### EDGE-V2-09 · Bedrock structured-output parse failure

**Trigger:** Force the LLM to emit malformed JSON (set system prompt to test variant).
**Expected:** One stricter retry; on second failure 503 to client; UI shows _"Sorry, please try again."_

### EDGE-V2-10 · Idle session timeout

**Trigger:** Open conversation; do nothing for 30 minutes.
**Expected:** Server-side state transitions to `TERMINAL_INCOMPLETE`; any captured values are persisted; UI shows session-incomplete card on resume.

### EDGE-V2-11 · Pause and resume

**Trigger:** Tap pause mid-session; tap resume within 5 minutes.
**Expected:** Server state preserved; LLM picks up _"Welcome back…"_.

### EDGE-V2-12 · Pause timeout

**Trigger:** Pause; do not resume within 5 minutes.
**Expected:** State → `TERMINAL_INCOMPLETE`; reminder cycle eventually fires.

### EDGE-V2-13 · Implausible plausibility ranges per parameter

For each parameter, drive a hard out-of-range value and assert the system blocks recording until corrected.

| Param | Hard fail value |
|---|---|
| BP systolic | 0, 500 |
| BP diastolic | 0, 250 |
| Glucose | -10, 1000 |
| Temperature | 50 °F, 200 °F |
| SpO₂ | 0%, 110% |
| Pulse | 0, 400 |
| Weight | 0 kg, 500 kg |

### EDGE-V2-14 · Network drop during sync of manual log

**Trigger:** Disable WiFi/data; tap save on a manual log.
**Expected:** Local "pending" state; on reconnect, sync flushes FIFO with no data loss.
**Note:** v2's PRD explicitly **does not** target full offline mode (FR-23 = Won't); just transient connectivity loss handling.

### EDGE-V2-15 · Microphone permission denied

**Trigger:** Decline mic permission on the conversation screen.
**Expected:** App falls back to `matika_text_fallback`; conversation continues over text.

### EDGE-V2-16 · Cross-region inference disclosure absent (regression)

If consent text is missing the v2 cross-region clause, fail hard. Required string includes "AWS regions outside India" (case-insensitive).

### EDGE-V2-17 · STT offline pack missing

**Trigger:** Fresh install; no offline language pack.
**Expected:** Online STT path used silently; telemetry tags `stt_offline_used=false`. App surfaces a one-time tip to download the language pack.

---

## 10. Per-journey run commands

The journey runner agent should resolve a journey ID to a runnable command. Suggested mapping:

| Journey | Runnable today | Command |
|---|---|---|
| CG-V2-02 | ✅ Maestro | `scripts/maestro-run.sh caregiver_protocol_setup` |
| PT-V2-07 | ✅ Maestro | `scripts/maestro-run.sh patient_logging_happy_path` |
| PT-V2-03 (en, voice) | ⚠ Maestro + Mac TTS | see PT-V2-03 snippet above |
| PT-V2-05 (hi, voice) | ⚠ Maestro + Mac TTS | substitute `Lekha 165` and Hindi utterance |
| PT-V2-06 (bn, voice) | 🔧 Manual / pre-recorded | `afplay test-automation/audio/bn-IN-bp-130-85.aiff` |
| Anything web (DR-V2-*) | 🔧 Playwright (TBD) | `node web-portal/scripts/run-journey.mjs DR-V2-XX` |
| Backend-only (Lambda invocation, RDS query) | ✅ Bash | inline with the journey |

Legend: ✅ wired today · ⚠ partial — needs voice harness glue · 🔧 needs new tooling.

**Recommended shape for new Maestro voice flows:**

```yaml
# .maestro/flows/patient_voice_bp_en.yaml
appId: com.carelog
---
- launchApp: { clearState: true }
- extendedWaitUntil: { visible: { id: login_email }, timeout: 15000 }
- tapOn: { id: login_email }
- inputText: ${MATIKA_PATIENT_EMAIL}
- tapOn: { id: login_password }
- inputText: ${MATIKA_PATIENT_PASSWORD}
- hideKeyboard
- tapOn: { id: login_button }
- extendedWaitUntil: { visible: { id: patient_home_start_conversation }, timeout: 30000 }
- tapOn: { id: patient_home_start_conversation }
- tapOn: { text: "Allow|While using the app", optional: true }
- extendedWaitUntil: { visible: { id: matika_mic }, timeout: 30000 }
- tapOn: { id: matika_mic }
# At this point the runner shell speaks the utterance (see PT-V2-03 snippet).
- extendedWaitUntil: { notVisible: "thinking", timeout: 60000 }
- assertVisible: { id: matika_mic }   # mic re-armed for next turn
```

The runner orchestrates: start the flow with `&`, sleep ~7s, `say`, `wait`.

---

## 11. Pass criteria summary

A journey passes when **every** of the following are true:

1. UI: every step's `assertVisible` / `extendedWaitUntil` succeeds without a hook failure.
2. No app crash (`adb logcat -d *:E` clean for `com.carelog` since the run start).
3. Backend: Lambda invocation logged in CloudWatch within the journey window.
4. Data: the expected RDS row / S3 object / Cognito attribute is present and correct.
5. For voice journeys: the value Bedrock extracted matches the spoken value, and `responseText` language matches input language.
6. Latency budget: `model_call.latency_ms < 3000` for T3 turns, `< 2000` for T2 short turns (loose during pilot — tighten when SLOs are real).
7. No PHI in Lambda logs (sample-check; Guardrails should redact PII filters CREDIT_CARD/SSN/PASSPORT).

A run report should record one row per journey with `status ∈ {pass, fail, blocked, manual}` and a one-line note.

---

## 12. What's deliberately NOT covered yet

| Surface | Why excluded |
|---|---|
| Direct Bluetooth device integration | FR-21 = Won't (v2.0 scope) |
| iOS app | FR-22 = Won't (Android only at launch) |
| Offline-mode multi-vital logging + sync | FR-23 = Won't; only transient drops are tested (EDGE-V2-14) |
| In-app messaging caregiver ↔ doctor | FR-24 = Won't |
| Doctor onboarding patients directly | FR-25 = Won't |
| v1 attendant persona | Not in v2.0 |
| Streamed-turn agent test (SSE) | Phase D — blocked on REST API Gateway buffering; manual smoke only |

When v2.x adds any of these, append a section here rather than starting a separate doc — keep one canonical journeys file.

---

*Matika v2 Journeys — last updated 2026-05-08. Bump the date and version on every material change.*

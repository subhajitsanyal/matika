# Voice bench runbook — post-reboot continuation (2026-05-16)

After the Mac mini reboot, follow this end-to-end to (a) restore the bench rig and (b) drive the full voice-based journey matrix for caregiver + patient personas against the staging soak.

**Why this exists:** The 2026-05-16 bench-fix wave landed 4 PRs (commits `a616b60`, `72b8ef2`, `7c64a99`, `95ba673`, `3414708` on `main`) and bench-verified all 9 gaps F30–F38 via text-fallback + smoke voice. This runbook drives the complete voice journey catalog now that the Core Audio wedge is cleared.

---

## 0. Session state at reboot (what you're continuing from)

- **Branch:** `main` at `3414708`. All bench fixes merged + pushed.
- **Staging API GW:** `https://3mni7nx5bf.execute-api.ap-south-1.amazonaws.com/staging`
- **Staging Cognito user pool:** `ap-south-1_7cACPnKJn`; client `2ftnillsoguru5u2em58t6pllk`.
- **Staging bastion:** `i-0f2acdf1a96ee24a6`. RDS endpoint: `carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com`. Tunnel port `55433`.
- **APK installed on phone (RFCT10C1GSZ):** debug variant built from `3414708`, BuildConfig API_BASE_URL points at staging.
- **Credentials:**
  - Caregiver: `sanyalsubhajit2010+cg@gmail.com` / `BenchStg2026.` (reset 2026-05-15 via `admin-set-user-password --permanent`)
  - Patient (Asha Devi, CL-TPUX54): `sanyalsubhajit2010+staging-pt@gmail.com` — temp password unknown; reset via `admin-set-user-password` if you need to log in.
  - Test patient added during bench (Priya Nair, CL-R18V51): `subhajit.sanyal+att1@gmail.com` — temp password `mX$S4Gm$` (per session log; reset if it doesn't work).
- **Soak clock:** continues to 2026-05-22. No alarms in ALARM state at last check.

---

## 1. Pre-flight checks (~2 min)

After reboot completes and you've logged in at the Mac mini keyboard:

```bash
# Sanity: audio recovered?
afplay /System/Library/Sounds/Pop.aiff && echo OK
# Expected: silent pop sound + "OK" printed. If still -66681, this runbook can't proceed — file as voice_harness_lessons.md regression.

# Phone reachable?
adb devices
# Expected: RFCT10C1GSZ device

# App installed?
adb shell pm list packages | grep carelog
# Expected: package:com.carelog

# Network to AWS API GW?
curl -s -o /dev/null -w "%{http_code}\n" https://3mni7nx5bf.execute-api.ap-south-1.amazonaws.com/staging/health
# Expected: 200

# Bedrock router warm?
aws logs tail /aws/lambda/matika-staging-bedrock-router --since 5m --region ap-south-1 2>&1 | tail -3
# Expected: silence (no recent traffic since deploys yesterday) OR routine telemetry rollup
```

---

## 2. Quiet-bench rig setup (~5 min, recommended)

The earbud-against-mic rig avoids waking neighbors and works at extremely low Mac volume.

1. Plug **wired earbuds** (3.5mm) into the Mac mini's rear headphone jack.
2. macOS will auto-switch output to `External Headphones`; verify:
   ```bash
   SwitchAudioSource -c
   # Expected: External Headphones
   ```
3. Set Mac volume to **10%** (System Settings → Sound, or `osascript -e 'set volume output volume 10'`).
4. Tape **one earbud's speaker face directly against the phone's bottom mic** (the small holes near the USB-C port). They should be touching — 0–2 mm gap max.
5. Test signal:
   ```bash
   say -v Rishi -r 175 "Testing one two three"
   ```
   You should hear it faintly from across the room and clearly through the phone mic.
6. Verify STT pickup:
   ```bash
   adb logcat -c
   # Open F23 voice screen on phone, tap mic
   adb shell input tap 221 583
   sleep 0.6
   say -v Rishi -r 175 "Hello, I want to add a new patient."
   sleep 8
   adb logcat -d 2>&1 | grep -E "handleFinalResult|onResults" | tail -3
   # Expected: "#handleFinalResult: 1 hyp" with non-empty result
   ```

Fallback rig if earbuds don't work: bring the Mac mini's built-in speaker close to the phone, run at 5–15% volume. Slightly louder but tolerable.

---

## 3. Caregiver login + dashboard sanity

```bash
# If app is in any state other than fresh login, clear it:
adb shell pm clear com.carelog
adb shell monkey -p com.carelog -c android.intent.category.LAUNCHER 1
sleep 5

# Tap email field, type caregiver email, tap password, type password, sign in
# Coords on Samsung S22/S23 (RFCT10C1GSZ):
adb shell input tap 540 974
adb shell input text 'sanyalsubhajit2010+cg@gmail.com'
adb shell input tap 540 1206
adb shell input text 'BenchStg2026.'
adb shell input keyevent KEYCODE_BACK
adb shell input tap 540 1570
sleep 8

# Verify dashboard mounts with the 3 test patients
adb shell uiautomator dump /sdcard/win.xml && adb pull /sdcard/win.xml /tmp/win.xml
grep -oE 'text="[^"]*"' /tmp/win.xml | sort -u | grep -E "Jane PT|Asha Devi|Priya Nair"
# Expected: all 3
```

If consent screen blocks you, tick the checkbox + Accept (Stream C is canon now). Coords vary; use `uiautomator dump` to find them.

---

## 4. Voice journey test matrix

Execute in this order. Each journey has: ID, scope, utterances, success assertion (UI + RDS + CloudWatch), and a teardown step where relevant.

### Phase A — Caregiver voice journeys (3 journeys)

#### CG-V2-04 — Conversational patient onboarding (Sonnet, voice)

**Goal:** Drive F23 voice patient onboarding end-to-end. Verifies F30 (null Confidence) + F32 (FSM badge) + F33 (dashboard refresh) under the actual voice STT path (not text fallback).

**Setup:** caregiver dashboard visible with 3 patients. Tap voice FAB.
```bash
adb shell input tap 644 1949  # "Add a new patient through a voice conversation"
sleep 4
# Grant mic permission if prompted (taps for "While using the app"):
adb shell input tap 540 1821 2>/dev/null
sleep 3
```

**Utterances** (drive each turn with `matika-say.sh`; mic resets after every Matika response — wait for it to finish speaking + the mic to re-arm before the next utterance). For each: tap mic FIRST, then `matika-say.sh` with 800ms predelay:

| Turn | What Matika asks (≈) | Your utterance |
|------|---------------------|----------------|
| 1 | (opening) | `Hello, I want to add a new patient.` |
| 2 | "Could you tell me the patient's name?" | `The patient's name is Rajiv Menon.` |
| 3 | "Rajiv Menon — is that right?" | `Yes, that's correct.` |
| 4 | "How old is Rajiv?" | `He is seventy eight years old.` |
| 5 | "Does Rajiv have any medical conditions?" | `He has high blood pressure and type two diabetes.` |
| 6 | "Any medications or allergies?" | `He takes amlodipine. No allergies.` |
| 7 | "Email address?" | `sanyalsubhajit two zero one zero plus a t at gmail dot com.` (LLM should normalize) |
| 8 | (confirm everything) | `Yes, everything is correct.` |

Driver pattern per turn (replace `<utterance>`):
```bash
adb logcat -c
# Find mic coords from latest UI dump — bounds of resource-id="matika_mic"
adb shell input tap <mic_x> <mic_y>
bash scripts/matika-say.sh en 165 "<utterance>" 800
sleep 8
adb shell uiautomator dump /sdcard/win.xml && adb pull /sdcard/win.xml /tmp/win.xml
grep -oE 'text="[^"]*"' /tmp/win.xml | sort -u
```

**Mic position drifts** as the conversation log grows. Re-find each turn with:
```bash
python3 -c "
import re
content = open('/tmp/win.xml').read()
m = re.search(r'resource-id=\"matika_mic\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', content)
if m:
    x1,y1,x2,y2 = map(int, m.groups())
    print(f'mic center: {(x1+x2)//2} {(y1+y2)//2}')
"
```

**Pre-step (one-time): verify the email is fresh in Cognito:**
```bash
aws cognito-idp list-users --user-pool-id ap-south-1_7cACPnKJn --region ap-south-1 \
  --filter 'email="sanyalsubhajit2010+at@gmail.com"' --query 'Users[].Username' --output text
# Expected: empty (no existing user). If non-empty, pick a different verified SES identity.
```

**Asserts:**
- UI: state badge progresses CREATED → EXTRACTING_PROFILE → AWAITING_PROFILE_CONFIRMATION → PROFILE_CONFIRMED → completion. **No 503s, no UNKNOWN.**
- CloudWatch: `/aws/lambda/matika-staging-bedrock-router` shows clean turn handles; `/aws/lambda/carelog-staging-create-patient-from-voice` fires with "Patient created: CL-XXXXXX".
- RDS (via SSM tunnel — see §6): `SELECT short_id, name FROM patients WHERE short_id='CL-XXXXXX'` returns Rajiv Menon row; `persona_links` shows caregiver→patient link.
- Email: welcome email lands at `sanyalsubhajit2010+at@gmail.com` (verify inbox).
- Dashboard auto-refresh: after voice session completes + Done tapped, Rajiv Menon appears in "Your Patients" without manual pull. **F33 verified under voice path.**

#### CG-V2-03 — Conversational protocol configuration (T3 Sonnet, voice)

**Goal:** Configure Rajiv Menon's vital protocols via voice. Exercises the caregiver_protocol_config session type + `protocol_persister.upsertParameterConfig`.

**Setup:** From dashboard, tap Rajiv Menon's patient card → "Manage protocol" (or equivalent voice entry). If no entry exists post-F23-completion, this journey is exercised inline as part of CG-V2-04 (the protocol-config session auto-starts after patient creation — see PR-3 agent's "MATIKA_PROTOCOL_CONFIG_CONVERSATION" finding).

**Utterances:**

| Turn | Utterance |
|------|-----------|
| 1 | `Let's set up his blood pressure monitoring.` |
| 2 | `Check his BP every morning at eight a m and every evening at six p m.` |
| 3 | `Alert me if systolic goes above one fifty or below one hundred.` |
| 4 | `For glucose, check fasting every morning. Alert if above two hundred.` |
| 5 | `Yes, save these settings.` |

**Asserts:**
- RDS `parameter_configs` for Rajiv's `patient_id`: rows for `blood_pressure_systolic`, `blood_pressure_diastolic`, `blood_glucose` with `frequency_days=1`, `daily_deadline='08:00:00'` (or both), `threshold_min/max` populated. SQL:
  ```sql
  SELECT parameter_name, frequency_days, daily_deadline, threshold_min, threshold_max
    FROM parameter_configs
    WHERE patient_id = (SELECT id FROM patients WHERE short_id='CL-XXXXXX');
  ```
- CloudWatch: `protocol_extraction` event fires with extracted_count > 0 on `complete_session`.

#### CG-V2-13 — Configure reminders via voice (F26b voice-only)

**Goal:** Verify voice-only reminder configuration end-to-end (the F26b decision from launch-execution-4).

**Setup:** Same session as CG-V2-03 if reminder cadence was mentioned, OR start a fresh protocol-config voice session and only mention reminders.

**Utterances:**

| Turn | Utterance |
|------|-----------|
| 1 | `I want to update his reminder schedule.` |
| 2 | `Remind him every morning at seven a m and every evening at seven p m for blood pressure.` |
| 3 | `Once a week on Sundays for weight.` |
| 4 | `Yes, save.` |

**Asserts:**
- RDS `parameter_configs`: BP rows updated to `daily_deadline='07:00:00'` (or one BP row per time); weight row with `frequency_days=7`.
- Existing `cg_v2_13_voice_reminder_config.yaml` Maestro flow can be the regression hook for this run — execute via `scripts/maestro-run.sh cg_v2_13_voice_reminder_config` if you want CI evidence.

### Phase B — Patient voice journeys (5 journeys)

Log out caregiver → log in as Asha Devi (`sanyalsubhajit2010+staging-pt@gmail.com`). If the password is unknown, reset:
```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id ap-south-1_7cACPnKJn \
  --username "$(aws cognito-idp list-users --user-pool-id ap-south-1_7cACPnKJn --region ap-south-1 --filter 'email=\"sanyalsubhajit2010+staging-pt@gmail.com\"' --query 'Users[0].Username' --output text)" \
  --password 'BenchStg2026.' --permanent --region ap-south-1
```

After password reset: `adb shell pm clear com.carelog` BEFORE re-login (Amplify cache trap — see [[v2_open_blockers_endofday_20260515]]).

#### PT-V2-03 — Daily voice logging — single parameter (English)

**Goal:** Soda STT → Bedrock extraction round-trip. The canonical patient voice flow.

**Setup:** Patient home → Start Conversation.

**Utterances:**

| Turn | Utterance |
|------|-----------|
| 1 | `My blood pressure is one thirty over eighty five.` |
| 2 | `Yes, that's correct.` |

**Asserts:**
- UI: state → PENDING_CONFIRMATION → "Session complete" with BP card showing 130/85.
- CloudWatch `/aws/lambda/matika-staging-bedrock-router`: T2 Haiku call ~2-3s, `extracted=2` for systolic + diastolic.
- WorkManager S3 sync (may lag): `aws s3 ls s3://carelog-v2-staging-documents-316643066568/observations/CL-TPUX54/2026/05/16/` — eventually shows new `obs-*.json`.

#### PT-V2-04 — Multi-parameter voice logging (English)

**Utterances:**

| Turn | Utterance |
|------|-----------|
| 1 | `My BP is one twenty over seventy eight, my sugar this morning was one ten, and I weigh seventy two kilograms.` |
| 2 | `Yes, that's right.` |
| 3 | `Yes, save all three.` |

**Asserts:**
- 3 observations persist (BP systolic + diastolic + glucose + weight). Older note from `journeys_voice.md`: "F6 residual — Soda flakes on short utterances". If turn-2 confirmation gets `NO_SPEECH_DETECTED`, type "Yes" via fallback to keep moving.
- S3: 3 new `obs-*.json` files for CL-TPUX54.

#### PT-V2-05 — Hindi voice (single parameter)

**Setup:** Settings → Language → select हिन्दी (Hindi). Back to home, Start Conversation.

**Utterances** (via `matika-say.sh hi 165 "..."`):

| Turn | Hindi utterance | Translation |
|------|----------------|-------------|
| 1 | `मेरा ब्लड प्रेशर एक सौ तीस बटा अस्सी है।` | My BP is 130/80 |
| 2 | `हाँ, सही है।` | Yes, correct |

**Asserts:**
- CloudWatch shows `lang=hi-IN` in session_config; T2 Haiku response is in Hindi.
- RDS `interaction_sessions.session_language='hi'`.

#### PT-V2-06 — Bengali voice (single parameter, audio-file driven)

**Goal:** The journey that's been bench-blocked on the Core Audio wedge since 2026-05-11. Now finally runnable.

**Pre-step:** Pre-recorded Bengali `.aiff` must exist. Find it:
```bash
ls test-automation/audio/bn-IN-bp-*
# Expected: bn-IN-bp-130-85.{aiff,mp3}
export MATIKA_BN_AUDIO=$PWD/test-automation/audio/bn-IN-bp-130-85.aiff
# Set language to Bengali via Maestro helper (set DataStore + UI flag):
scripts/maestro-run.sh _bench_set_language_bn
```

**Then drive:**
```bash
scripts/matika-voice-run.sh patient_voice_bp_bn_single_turn \
  --turn "bn|160|$MATIKA_BN_AUDIO|800"
```

**Asserts:** Same as PT-V2-03 but with `session_language='bn'` and Bengali Matika response.

#### PT-V2-08 — Implausible value challenge (voice variant)

**Utterance:**

| Turn | Utterance |
|------|-----------|
| 1 | `My blood pressure is three hundred over two hundred.` |
| 2 | `Yes, that's what I measured.` (challenge response) |

**Asserts:**
- RDS `interaction_sessions.fsm_state='PLAUSIBILITY_CHALLENGE'` at turn-1 end.
- UI shows the plausibility challenge card.
- No observation persisted unless user re-confirms after challenge.

### Phase C — Edge case (1 journey, optional)

#### EDGE-V2-17 — STT offline pack missing (route-reachable, awaits Maestro flow)

Lower priority; flow not yet authored. Skip unless Phase A + B all pass and you want to push further.

---

## 5. Beyond-voice next steps (Streams remaining)

After voice bench wraps, these are the open Streams from `v2_launch_plan.md` v1.2 carried into the next session:

### Stream A5 — Phase 2 telemetry dashboards
- 4 telemetry tables (`vital_coverage_daily`, `conversation_session_daily`, `alert_flow_daily`, `patient_engagement_daily`) are populated.
- **TODO:** QuickSight / Grafana dashboards bound to these tables. Devops, not engineering. Per launch plan §7.3.

### Stream E — Manual journey runbooks (9 cases)
- PT-V2-10 / 11 / 12 — Photo OCR (manual, needs real glucometer/printed mock)
- PT-V2-14 — Per-patient hard rate limit (cost-conscious, defer)
- PT-V2-24 — Reminder push → opens conversation (needs `aws lambda invoke check-daily-deadline` + second device for push receipt)
- EDGE-V2-05 / 06 / 10 / 12 — Wall-clock JWT / idle timeout
- EDGE-V2-15 — Mic permission revoke

Each needs a 1-pager runbook describing setup, execution, and assertion.

### Stream F — Voice journey bench (this runbook)
- Covered above. Once green, mark PT-V2-06 PASS in `journeys_voice.md` (was bench-blocked since 2026-05-11).

### Stream G — Doc backfill (surgical edits remaining)
- `docs/matika_prd_v2.md` §1.1 — v2.0 scope one-pager matching launch plan §1.
- `docs/matika_implementation_plan_v2.md` — F-number closeouts for F5/F7/F8/F28/F29/F17/F26b/F30/F31/F32/F33/F34/F35/F36/F37/F38.
- `docs/privacy-policy.md` — cross-region disclosure update; consent_records version 2.0 hash recorded alongside.

### Stream H — Staging soak observation
- Continues to **2026-05-22** (1-week clock started 2026-05-15 evening when monitoring re-apply landed alarms + ops SNS topic).
- Daily check:
  ```bash
  aws cloudwatch describe-alarms --region ap-south-1 \
    --alarm-name-prefix carelog-staging --state-value ALARM \
    --query 'MetricAlarms[].AlarmName' --output table
  # Expected: empty table or No alarms in ALARM
  ```
- If any Critical alarm fires before 2026-05-22, soak clock resets.
- Promote to prod first-apply after 2026-05-22 if no Critical alarms fired.

### SES production-access ticket (pre-GA gate)
- Deferred to post-beta per `v2_open_blockers_endofday_20260515.md`. Beta volume fits the 200-msg/day sandbox cap with per-recipient verification.
- **MUST submit before GA.** Ticket-ready evidence: config-set ARN `arn:aws:sesv2:ap-south-1:316643066568:configuration-set/matika-staging-default` + SNS topic ARN + suppression handler `matika-staging-ses-suppression-handler`.

### Bedrock production quota requests (pre-GA gate)
- Filing depends on prod first-apply (post-soak). Templates ready in `docs/v2_launch_plan.md` §12.

### Two cleanup orphans flagged 2026-05-16
- `infrastructure/terraform/modules/lambda/main.tf:320-344` — `aws_iam_role.lambda_healthlake` + inline policy now orphaned (PR-4 removed the only consumer). Low priority; can fall in next terraform pass.
- `MacMiniDiscovery` + `AppSettings.macMiniBaseUrl` + `MacMiniApi*` Retrofit interfaces — still consumed by v1 stack behind `USE_V2_INFERENCE` feature flag. Full removal goes with v2.1 rename pass.

---

## 6. Reference card

### SSM tunnel to staging RDS
```bash
nohup aws ssm start-session --target i-0f2acdf1a96ee24a6 --region ap-south-1 \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters host="carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com",portNumber="5432",localPortNumber="55433" \
  > /tmp/ssm-staging.log 2>&1 &
disown $!
sleep 5
# Now connect:
PGPASSWORD=$(aws secretsmanager get-secret-value --secret-id carelog/staging/rds_password --region ap-south-1 --query SecretString --output text | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])') \
  /opt/homebrew/opt/libpq/bin/psql -h localhost -p 55433 -U postgres -d carelog
# Always: unset PGPASSWORD when done.
```

### Voice harness scripts
- `scripts/matika-say.sh <en|hi|bn> <rate> "<utterance>" [predelay_ms]` — speaks one utterance through External Headphones. Bengali requires `MATIKA_BN_AUDIO=<path>` env var.
- `scripts/matika-voice-run.sh <flow_name> --turn "<lang>|<rate>|<utterance>|<predelay>" --turn ...` — orchestrates a Maestro flow + multi-turn say with logcat-trigger synchronization.

### Useful CloudWatch tails
```bash
aws logs tail /aws/lambda/matika-staging-bedrock-router --since 2m --region ap-south-1 --follow
aws logs tail /aws/lambda/carelog-staging-create-patient --since 2m --region ap-south-1 --follow
aws logs tail /aws/lambda/matika-staging-ses-suppression-handler --since 5m --region ap-south-1 --follow
```

### Rebuild + reinstall APK (if needed)
```bash
cd android && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Clear app state (Cognito cache trap)
```bash
adb shell pm clear com.carelog
# After this, re-grant mic permission + re-accept consent on next launch.
```

### Lambda redeploy (if you fix a backend bug mid-bench)
**Critical:** Include `prompts/` in the zip for `bedrock-router` or it ENOENTs at cold-start — see [[lambda_deploy_prompts_dir]].
```bash
cd backend/lambdas/bedrock-router
npm install && npm run build
rm -f /tmp/bedrock-router.zip
zip -rq /tmp/bedrock-router.zip dist node_modules prompts package.json output_schema.json
aws lambda update-function-code --function-name matika-staging-bedrock-router \
  --zip-file fileb:///tmp/bedrock-router.zip --region ap-south-1
aws lambda wait function-updated --function-name matika-staging-bedrock-router --region ap-south-1
```

---

## 7. Capture results at end-of-bench

Each voice journey passed: update `docs/journeys_voice.md` row with date + evidence (CloudWatch RequestId + RDS row reference).
Each voice journey failed: capture as a new F-number gap in `docs/testing_todos_v2.md` with root-cause hypothesis, owner, and severity.

Then:
1. `git add docs/journeys_voice.md docs/testing_todos_v2.md`
2. Commit with message `Voice bench results 2026-05-16: PT-V2-* + CG-V2-*` listing pass/fail counts.
3. Push.
4. Update memory file `v2_open_blockers_endofday_20260515.md` (or create a new dated successor) with the latest PASS count and any new gaps.

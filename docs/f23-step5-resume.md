# F23 Step 5 — resume after Mac mini reboot

Session-state snapshot from the 2026-05-10 drive-through. The bench hit
a Mac-mini Core Audio wedge that needs a reboot to clear; this doc
captures everything the next session needs to pick up Step 5 cleanly.

## Where things stand

### Committed and shipped (in git, in dev)

| ref | what |
|---|---|
| `c9fc7f4` | F23 step 3 fixups (rate-limiter sentinel bypass + handler user_id resolution + output_schema name minLength drop) |
| `206913a` | F23 step 4 — Android voice patient onboarding UI |
| `0e55fb7` | F23 step 5 smoke iteration (handler sessionType→sentinel gating; AlertDialog testTagsAsResourceId; TextFallback IME Send action; two new Maestro flows) |

Branch: `main`, 3 commits ahead of `origin/main`. **No pushes were made.**

### Deployed live to dev

- `matika-dev-bedrock-router` — CodeSha256 `n1gm2nhhDNuV9n/JaCl0yRwzCUQBGtpLPcSDBH6eKlo=` deployed `2026-05-11T00:36:01Z` via `aws lambda update-function-code` (NOT terraform — per `terraform_lambda_drift_pattern.md`). Includes c9fc7f4 + the handler.ts change from 0e55fb7.
- `carelog-dev-create-patient-from-voice` — unchanged from f6caff5 step-3 deploy.

### Live-verified during this session

| What | Evidence |
|---|---|
| Placeholder bootstrap path (turn 1 → 200, fsmState=EXTRACTING_PROFILE) | Direct lambda invoke + Maestro-driven UI turn 1 |
| `add_patient_voice_fab` is visible on caregiver dashboard | Maestro `assertVisible` passed |
| Voice FAB tap routes to `MATIKA_PATIENT_VOICE_ONBOARDING` and mounts MatikaConversationScreen with `isVoicePatientOnboarding=true` | `matika_text_fallback` + `use_form_instead_button` visible after FAB tap |
| Turn 2+ no longer errors on missing sessionType (handler sessionType→sentinel fix lands) | `matika_turn_counter` advanced to "turn 2" cleanly post-deploy |
| Credentials modal renders correctly with testTags exposed (AlertDialog testTagsAsResourceId fix) | uiautomator dump shows `patient_credentials_email`/`_phone`/`_submit` resource-ids on screen |

### Not yet live-verified

The last 20% of Step 5 — modal submit → pivot → new patient rows in RDS → CloudWatch `caregiver_onboarding pivot ok`. Blocked on the audio wedge.

## The block: Mac-mini Core Audio wedge

`afplay` and `say` hang indefinitely on a 1s system sound across **all** three available output devices (External Headphones, Mac mini Speakers, DELL S3222HN HDMI). `osascript -e 'beep 1'` works — so NSBeep is fine and only the AudioToolbox/AudioQueue path is wedged. Recovery attempts during the session:

- `killall say` — orphan say processes only, didn't clear the wedge
- `kill -9` and `launchctl kickstart` of the user-level `com.apple.audio.AudioComponentRegistrar` — didn't help
- User ran `sudo killall -9 coreaudiod` — coreaudiod respawned (new pid) but afplay/say still hang

The wedge persists across coreaudiod restarts. **A Mac-mini reboot is the remaining fix.**

## Post-reboot resume — exact commands

### 0. Verify audio is back

```bash
afplay -t 1 /System/Library/Sounds/Pop.aiff   # should return in ~1s
say "audio works"                              # should be audible from External Headphones
```

If either hangs, audio is still wedged — re-attempt or escalate. Don't proceed otherwise.

### 1. Bench preflight

```bash
killall say 2>/dev/null
SwitchAudioSource -t output -s "External Headphones"
osascript -e 'set volume output volume 90'
adb shell settings put system volume_music 15
adb shell am force-stop com.carelog
adb logcat -c
```

### 2. Run the voice flow (PRIMARY path — voice harness)

```bash
export PATH="$HOME/.maestro/bin:$PATH"   # maestro is at ~/.maestro/bin; not on default PATH in non-interactive shells
source ~/.matika-test-creds.env
cd /Users/subhajitsanyal/Work/Projects/Matika/appdevel/matika
scripts/matika-voice-run.sh f23_voice_patient_onboarding \
  --turn "en|170|I want to set up monitoring for my mother. Her name is Asha Devi. She is 68 years old, female. She has hypertension and is otherwise healthy. Her primary language is English.|800" \
  --turn "en|175|Yes, that is all correct.|500" \
  --turn "en|175|I have no other information. Please proceed to set up her account.|500" \
  --turn "en|175|Yes, everything is correct, please confirm.|500"
```

### 3. After the flow exits, fill the credentials modal manually if Maestro didn't

If the Maestro YAML didn't drive the modal cleanly (the voice flow's modal handling has the same `patient_credentials_*` testTags as the text flow, which is now fixed in 0e55fb7), the device may be sitting on the modal. Type the test credentials directly:

```bash
# email field
adb shell input tap 540 1100   # approximate — verify with `adb shell uiautomator dump`
adb shell input text "f23-smoke-2026-05-10@example.invalid"
# phone field
adb shell input tap 540 1280
adb shell input text "+919999999999"
# submit
adb shell input tap 800 1500
```

Then tap mic again, say "yes, everything is correct, please confirm" (via `scripts/matika-say.sh en 175 "..." 500`), wait for the response.

### 4. Verify the pivot fired (live evidence)

```bash
bash /tmp/f23_verify.sh   # SSM tunnel + psql + CloudWatch — already written to /tmp this session
```

Expect:
- New `patients` row joined to a fresh `users` row with `persona_type=patient`
- New `persona_links` row from John CG → new patient, `relationship='caregiver'`, `is_active=true`
- `interaction_sessions.patient_id` UPDATEd from NULL → the new UUID
- CloudWatch `caregiver_onboarding pivot ok` log line in bedrock-router

### 5. If `/tmp/f23_verify.sh` is gone (e.g., system reboot wiped /tmp)

It was written this session. Recreate with:
- SSM tunnel pattern from `dev_rds_ssm_tunnel.md`
- Query snippets at the bottom of this doc

### 6. Cleanup after smoke (when verified)

Delete the synthetic test patient + Cognito user to keep dev clean:

```sql
-- via psql on the SSM tunnel
DELETE FROM persona_links WHERE patient_id = '<new-patient-uuid>';
DELETE FROM patients      WHERE id         = '<new-patient-uuid>';
DELETE FROM users         WHERE id         = '<new-patient-users-id>';
-- (interaction_sessions FK ON DELETE CASCADE; will go with the patient row)
```

```bash
# Cognito user (use the cognito_sub returned by the pivot, NOT the synthetic email)
aws cognito-idp admin-delete-user \
  --user-pool-id <pool-id-from-tf-state-or-aws-console> \
  --username <new-patient-cognito-sub> \
  --region ap-south-1
```

## Open follow-ups beyond Step 5

- `docs/testing_todos_v2.md` F23 entry should flip to RESOLVED once steps 4-6 above pass with live evidence.
- The streaming handler still has no F23 pivot wiring — Android client routes around it by forcing `preferStreaming=false` while the `pending-<sessionId>` sentinel is in use. Flag TODO at `handler.ts:~1497`.
- The Maestro flows were authored against Samsung S21+ + Android 14. Other devices may need the patterns re-tuned (especially the IME Send + pressKey: Enter substitution, which depends on the device's keyboard honoring `imeAction=Send`).

## Smoke-bench gotchas learned this session

(Worth folding into `voice_harness_lessons.md` and `maestro_lessons.md` memories.)

1. **Mac-mini Core Audio can wedge in a way that survives `sudo killall coreaudiod`.** Symptom: `afplay` and `say` hang on any output device; `osascript beep` still works (NSBeep is a separate path). Diagnostic: try afplay on HDMI vs External Headphones vs internal — if all three hang, it's AudioQueue. Recovery: reboot. Lighter `killall say` and `launchctl kickstart` don't help.
2. **Compose `AlertDialog` renders in its own Popup window; the root activity's `testTagsAsResourceId = true` does NOT propagate.** Re-apply it on the AlertDialog's modifier when you want Maestro to address its inner fields by id.
3. **Maestro's `hideKeyboard` on Samsung One UI intermittently fires KEYCODE_BACK** when the soft keyboard auto-dismissed between `inputText` and the next step. On the conversation screen that pops back to the caregiver dashboard mid-flow. Workaround: wire `imeAction=ImeAction.Send` + `KeyboardActions(onSend = ...)` on the TextField and use `pressKey: Enter` from the YAML — no hideKeyboard needed.
4. **Compose Button bottoms occluded by the soft keyboard look like "Element not found" to Maestro**, even though `uiautomator dump` shows the resource-id. Don't trust the error message — verify with uiautomator before assuming a real bug.

## Verification SQL snippets (in case /tmp/f23_verify.sh is gone)

```sql
-- recent caregiver_onboarding sessions (which one is post-pivot?)
SELECT id, patient_id, user_id, session_type, fsm_state, status, started_at, ended_at
FROM interaction_sessions
WHERE session_type = 'caregiver_onboarding'
  AND started_at > NOW() - INTERVAL '2 hours'
ORDER BY started_at DESC;

-- new patients in the last hour
SELECT p.id, p.patient_id, u.name, u.email, p.date_of_birth, p.gender,
       p.medical_conditions, p.created_at
FROM patients p
JOIN users u ON u.id = p.user_id
WHERE p.created_at > NOW() - INTERVAL '2 hours'
ORDER BY p.created_at DESC;

-- caregiver-to-new-patient links
SELECT pl.id, pl.patient_id, pl.linked_user_id, pl.relationship, pl.is_active,
       p_user.name AS patient_name, cg_user.email AS caregiver_email, pl.created_at
FROM persona_links pl
JOIN patients p           ON p.id = pl.patient_id
JOIN users    p_user      ON p_user.id = p.user_id
JOIN users    cg_user     ON cg_user.id = pl.linked_user_id
WHERE pl.created_at > NOW() - INTERVAL '2 hours'
ORDER BY pl.created_at DESC;
```

```bash
# Pivot-ok CloudWatch log line
SINCE_MS=$(python3 -c "import time; print(int((time.time() - 2*3600)*1000))")
aws logs filter-log-events \
  --log-group-name "/aws/lambda/matika-dev-bedrock-router" \
  --start-time "$SINCE_MS" \
  --filter-pattern '"caregiver_onboarding pivot ok"' \
  --region ap-south-1 \
  --query 'events[].message' --output text
```

## Test-account identifiers (for cross-reference)

- John CG (caregiver, the actor in this flow): Cognito sub `2193bdfa-d001-70da-aa9a-395dabbe8122`, internal `users.id` `a2b0af09-86a7-4156-8e24-7837c311f7de`.
- Test creds: `~/.matika-test-creds.env` (sourced before `scripts/*.sh`).
- Patient we're creating: Asha Devi, 68, female, hypertension, en-IN, `f23-smoke-2026-05-10@example.invalid`, `+919999999999`.

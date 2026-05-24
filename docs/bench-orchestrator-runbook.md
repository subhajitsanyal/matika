# Bench orchestrator runbook — exhaustive v2-beta journey sweep (staging)

> **Audience:** an orchestrator agent (Claude Code session) tasked with running every in-scope-for-v2-beta journey against the staging environment from a known-clean state. **Snapshot date:** 2026-05-23.
>
> **Goal:** produce a single end-of-run report listing every journey, its PASS/FAIL/BLOCKED status, the captured evidence (RDS rows, CloudWatch RequestIds, S3 keys, screenshots), and any new bugs surfaced. The user reads the report; they don't watch the bench live.

---

## 0. Memories to read first

Before doing anything, read these memories — they prevent known-class mistakes:

- `voice_harness_lessons.md` — Samsung-vs-Pixel logcat trigger, wedged say queue, DataStore language override, clearState wipes DataStore.
- `maestro_lessons.md` — full-string regex, scroll-into-view, contentDescription targeting, no shell-out from runScript, explicit `-e` env passing.
- `feedback_verify_live_pattern.md` — never declare a backend fix done without inspecting live RDS row + CloudWatch log.
- `v2_no_attendant_persona.md` — `attendant` enum exists but v2 never writes it; only `caregiver` and `doctor`.
- `terraform_lambda_drift_pattern.md` — full applies revert hot-deployed lambda code; avoid running `terraform apply` without `-refresh=false -target=...`.
- `jane_dev_test_account.md` — covers DEV pair; staging pair is documented in §2 below (don't conflate).

---

## 1. Bench prerequisites

### 1.1 Rig
- **macOS host** (current Mac mini — F41 Core Audio wedge is active, voice flows MUST use the remote-TTS bypass).
- **Android device:** Samsung RFCT10C1GSZ connected via USB, USB debugging authorized. Verify with `adb devices`.
- **Remote TTS:** running on the second Mac at `http://10.0.0.171:8765`. Verify with `curl -s http://10.0.0.171:8765/health` — should return `{"ok": true, "voices": ["en", "hi"], "gtts_langs": ["bn"]}`.
- **Maestro CLI:** ≥ 2.5.1 on PATH.
- **aws CLI:** authenticated with profile that can read staging RDS secret, list Cognito users, write S3, deploy lambdas. Region `ap-south-1` default.
- **libpq psql:** `/opt/homebrew/opt/libpq/bin/psql` installed.

### 1.2 Env vars
```bash
source ~/.matika-test-creds.env       # exports MATIKA_CAREGIVER_EMAIL/_PASSWORD + MATIKA_PATIENT_EMAIL/_PASSWORD
export MATIKA_SAY_REMOTE_URL="http://10.0.0.171:8765"
export MATIKA_TURN_TIMEOUT_S=150      # raised from default 90 (see F23 partial diagnosis in pre-beta-todos.md)
```

For per-bench invite emails (CG-V2-19/20/21 reuse this), use a date-stamped suffix:
```bash
export MATIKA_INVITE_ATTENDANT_EMAIL="sanyalsubhajit2010+atinv-${RUN_DATE}@gmail.com"
export MATIKA_INVITE_ATTENDANT_NAME="Bench attendant ${RUN_DATE}"
```

### 1.3 SSM tunnel to staging RDS (port 55433)
```bash
aws ssm start-session --target i-0f2acdf1a96ee24a6 \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["55433"]}' \
  --region ap-south-1 &
# Wait for "Waiting for connections..." before issuing the first psql.
```
SSM idle-timeouts in ~20 min — re-open if `Connection refused` mid-run.

DB password:
```bash
export PGPASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id carelog-staging-db-password --region ap-south-1 \
  --query SecretString --output text \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['password'])")
PSQL="/opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 55433 -U carelog_staging_admin -d carelog_staging"
```
Always `unset PGPASSWORD` when done.

### 1.4 APK
Build + install a fresh debug APK before the run — the in-tree code may have changes since the last bench-installed build. Per CLAUDE.md:
```bash
cd android && ./gradlew assembleDebug --quiet
adb install -r app/build/outputs/apk/debug/app-debug.apk
cd ..
```

### 1.5 Staging-active lambda hashes (sanity-check before run)
```bash
for fn in carelog-staging-remove-team-member carelog-staging-invite-attendant \
         matika-staging-bedrock-router carelog-staging-create-patient \
         carelog-staging-create-patient-from-voice carelog-staging-care-team \
         carelog-staging-sync-observation; do
    aws lambda get-function-configuration --function-name $fn --region ap-south-1 \
        --query '{Fn:FunctionName, Sha:CodeSha256, At:LastModified}' --output text
done
```
Compare against the known-good hashes captured in the most-recent session wrap. If any drifted, decide whether to roll back via CLI redeploy (see `terraform_lambda_drift_pattern.md`) before starting.

---

## 2. Staging seed pair (preserved across cleanup)

| Role | Cognito email | users.id | Notes |
|---|---|---|---|
| Caregiver (John CG) | `sanyalsubhajit2010+cg@gmail.com` | `f375ce5e-3d1b-4f6b-9c4f-e1fc1484f411` | Primary caregiver. `custom:linked_patient_id` is forced to `CL-012W6M` by the cleanup script. Group: `caregivers`. |
| Patient (Jane PT) | `sanyalsubhajit2010+pt9@gmail.com` | `75564941-09f8-4381-b1e6-4554f23755e8` | Patient short code `CL-012W6M`, UUID `d4d38abb-af57-4658-a9e4-32b8701d12da`. 7 active `parameter_configs`: BP sys/dia, blood_glucose, body_temperature_c, body_weight, heart_rate, spo2. |
| Persona link | — | `0bfb8a8e-0dd9-4a6d-b834-000806ede5ae` | John ↔ Jane, `relationship='caregiver'`, `is_primary=true`. |

Passwords live in `~/.matika-test-creds.env` (out of repo).

> **Cognito subs are NOT pinned here.** They auto-generate on `admin-create-user` so any cleanup-recovery cycle gives them new values (e.g. 2026-05-23 incident regenerated both). `users.cognito_sub` is reconciled by the cleanup script's post-create step. Use `users.id` UUIDs (stable) or email-as-username (stable) for any operation that needs to address these accounts.

---

## 3. Cleanup step (RUN FIRST)

The cleanup script wipes everything in staging EXCEPT the §2 seed pair. Idempotent + reversible-via-re-create-from-scratch (but the seed pair itself is NOT re-creatable from the script if you delete it by accident — handle with care).

```bash
# Dry-run first — prints what would change, makes no changes
scripts/matika-staging-cleanup.sh

# Once satisfied with the dry-run plan:
scripts/matika-staging-cleanup.sh --execute --yes
```

What it does:
1. Truncates 20+ transactional tables (alerts, audit_log, interaction_sessions, model_call, etc.).
2. Deletes non-preserved parameter_configs, persona_links, patients, users.
3. Deletes all Cognito users except the two preserved emails.
4. Deletes all S3 keys under `observations/` except `observations/CL-012W6M/`.
5. Forces John CG's `custom:linked_patient_id` Cognito attribute back to `CL-012W6M`.
6. Prints a post-state inventory.

Expected post-state:
```
users: 2  patients: 1  persona_links: 1  parameter_configs: 7
alerts: 0  audit_log: 0  interaction_sessions: 0  model_call: 0
```

If the script fails mid-way, re-run it — idempotent.

---

## 4. Journey list (run in this order)

Each journey row gives: ID, Maestro flow OR command, env vars needed, what to assert, evidence to capture.

**Output format per journey:** append to a single results file `/tmp/bench-run-<DATE>/results.md` with one line per journey:
```
- PT-V2-01 | PASS | login_email → add_patient_voice_fab visible in 23s | flow stdout: ... | RDS check: users.is_active=true for +cg | screenshot: /tmp/bench-run-<DATE>/screenshots/pt-v2-01.png
```

Stop the run on the FIRST failure that's not an expected partial/blocked row, capture the failure state (screenshot + adb logcat + RDS snapshot of in-flight session if any), and report back. Don't try to "fix-as-you-go" beyond the documented retries below.

### 4.1 Auth + nav (run first — every later journey depends on login)
| # | Run | Pass criteria | Evidence |
|---|---|---|---|
| **PT-V2-01** | `patient_logging_happy_path.yaml` (first half — login section) | `add_patient_voice_fab` visible within 60s of tap-login | Cognito `last_login_at` updated for `+pt9` |
| **CG-V2-23** *(implicit)* | Any caregiver flow that logs in successfully — no standalone Maestro file. Covered by every CG-V2-* below. | — | — |
| **PT-V2-02** | `patient_dashboard_orientation.yaml` | `patient_home_start_conversation` testTag visible | screenshot |

### 4.2 Patient text + manual entry (no acoustic deps; cheap)
| # | Run | Pass criteria |
|---|---|---|
| **PT-V2-07** | `patient_logging_happy_path.yaml` | text-fallback round-trip; `matika_response_card` mounts |
| **PT-V2-08** | `patient_implausible_text.yaml` | RDS session `fsm_state='PLAUSIBILITY_CHALLENGE'` |
| **PT-V2-09** | `patient_emergency_text.yaml` | RDS session `escalations_triggered=['emergency_keyword']` |
| **PT-V2-13** | `scripts/matika-connectivity-test.sh` (3-flow orchestration) | "Turn failed" Snackbar then recovery |
| **PT-V2-15..20** | `patient_manual_log_blood_pressure / glucose / temperature / weight / pulse / spo2 .yaml` | Snackbar `"Saved <vital> ..."` + S3 obs under `observations/CL-012W6M/YYYY/MM/DD/` |
| **PT-V2-21** | `patient_vital_history_grid.yaml` | All 6 `vital_tile_*` testTags visible |
| **PT-V2-22** | `pt_v2_22_patient_care_team.yaml` | `patient_care_team_screen` mounts + John CG row + Primary badge |
| **PT-V2-23** | (bundled into CG-V2-01 part 2 — verify here that re-login as Jane doesn't re-prompt) | No consent prompt on Jane's re-login (`consent_records` already has her row) |
| **PT-V2-25** | *no flow yet — write inline:* login as Jane → tap `patient_home_history` → assert "History" title + at least one obs row | Flow YAML below in §6.1 |
| **PT-V2-26** | *no flow yet — write inline:* login → Settings → `settings_sign_out` → assert `login_email` reappears | Flow YAML in §6.2 |
| **PT-V2-27** | *no flow yet — write inline:* login → Settings → `language_option_hi` → relaunch → assert language persisted | Flow YAML in §6.3 |

### 4.3 Patient voice (acoustic; requires remote-TTS)
Voice journeys use `scripts/matika-voice-run.sh`. Per `voice_harness_lessons.md`: clearState wipes DataStore so re-set language inside the flow if needed; previous language sticks across sessions otherwise.

| # | Run | Pass criteria |
|---|---|---|
| **PT-V2-03** | `matika-voice-run.sh patient_voice_bp_en_single_turn --turn "en\|175\|My blood pressure is one thirty over eighty five.\|600" --turn "en\|175\|Yes that's correct.\|400"` | RDS `interaction_sessions.fsm_state='EXTRACTING'`, `extracted=2` (BP sys 130 + dia 85 with LOINC) |
| **PT-V2-04** | `matika-voice-run.sh patient_voice_bp_en_multi_param --turn ... --turn ...` | RDS extracted=2 (glucose 110 + body_weight 65) in addition |
| **PT-V2-05** | First set language to Hindi via `_bench_set_language_hi.yaml`, then `matika-voice-run.sh patient_voice_bp_hi_single_turn --turn "hi\|165\|मेरा रक्तचाप एक सौ चालीस के ऊपर नब्बे है।\|600" --turn "hi\|165\|हाँ सही है।\|400"` | Session `language=hi-IN`, Devanagari STT, Hindi LLM response, BP 140/90 extracted |
| **PT-V2-06** | Set language to Bengali, run `matika-voice-run.sh patient_voice_bp_bn_single_turn --turn "bn\|175\|আমার রক্তচাপ ১৪০ উপর ৯০\|600" --turn "bn\|175\|হ্যাঁ ঠিক আছে।\|400"` (rate ignored on gTTS path but server validates 80..300) | Session `language=bn-IN`, `stt_offline_used=false` in logcat (F25 fallback), BP 140/90 |
| **PT-V2-08 voice variant** | (already covered by `patient_implausible_text.yaml` in §4.2; voice version is optional re-verify) | — |

**F23 caveat:** if the existing `cg_v2_04` voice patient onboarding flow is re-run, turn 3 mic-active trigger may not fire (pre-beta-todos.md §3.2). Skip if encountered; capture state and move on.

### 4.4 Caregiver core (in dependency order)
| # | Run | Pass criteria |
|---|---|---|
| **CG-V2-01** | `cg_v2_01_self_register_part1.yaml` + `_part2.yaml` | New caregiver registers + consents; **NOTE:** this CREATES a new Cognito user → the cleanup script would have wiped any prior one. Use a unique email per run: `sanyalsubhajit2010+cgreg-${RUN_DATE}@gmail.com`. Login as the new caregiver works. |
| **CG-V2-02** | `caregiver_form_onboard_patient.yaml` (or inline if missing) | Form submit creates patient row + Cognito user. **NOTE:** the new patient is owned by the NEW caregiver from CG-V2-01, not John CG — keep this scope separate from the §2 seed pair. |
| **CG-V2-05** | `caregiver_dashboard_overview.yaml` | Login as John CG → Jane row visible; PullToRefresh works |
| **CG-V2-24** | *(new in this runbook)* Login as John → tap Jane's row → `PatientLogScreen` mounts | Flow YAML in §6.4 |
| **CG-V2-06** | `caregiver_view_patient_logs.yaml` | Patient log timeline + vitals render for Jane |
| **CG-V2-17** | `caregiver_trends_view.yaml` | `trends_screen` + "Recent Readings" header OR "No data for this period" |
| **CG-V2-22** | *(new)* Tap `caregiver_home_history` → "History" title mounts | Flow YAML in §6.5 |
| **CG-V2-12** | `caregiver_thresholds_manual.yaml` (or inline if missing) | Edit a parameter_config threshold; verify DB row changed |
| **CG-V2-19** | `cg_v2_invite_attendant_email.yaml` | Invite created; the `Invite Created` (delivery_failed) dialog mounts |
| **CG-V2-20** | `cg_v2_care_team_list.yaml` | New caregiver row + "Primary" badge for John |
| **CG-V2-21** | `cg_v2_care_team_remove.yaml` | Lambda invocation in CloudWatch + `users.is_active=false` + `audit_log` row |
| **CG-V2-23** *(alerts list)* | *(new)* requires E2E-V2-02 alerts seeded first | Flow YAML in §6.6 — run after E2E-V2-02 |
| **CG-V2-18** | `caregiver_sign_out.yaml` | Login screen reappears |
| **CG-V2-16** | `cg_v2_16_delete_patient_cascade.yaml` driven via `scripts/cognito-harness-maestro.sh cg-v2-16` | **DESTRUCTIVE** — deletes a patient. Don't run against Jane PT (would unseat the seed pair). Use a freshly-onboarded patient from CG-V2-02 instead. |

### 4.5 Caregiver voice
| # | Run | Pass criteria |
|---|---|---|
| **CG-V2-03** | voice flow + turns per docs/journeys_voice.md | RDS protocol-config session |
| **CG-V2-04** | `f23_voice_patient_onboarding` via `matika-voice-run.sh` | turns 1+2 PASS in transcript_history; **turn 3 timeout is the known F23 PARTIAL — capture state and continue** |
| **CG-V2-13** | voice reminder-config flow | RDS `reminder_configs` row |

### 4.6 End-to-end
| # | Run | Pass criteria |
|---|---|---|
| **E2E-V2-01** | onboarding → first log chain | new patient + first observation in S3 |
| **E2E-V2-02** | direct `aws lambda invoke evaluate-thresholds-batch` with a 210/- BP for Jane → notification-sender consumes SQS → alerts row + push attempt | `alerts` row with `vital_value=210`, `is_sent=f`, `send_error='no_transport_or_no_device_token'` (F17 — Jane has no device_tokens row in dev/staging, so the push fails at the transport layer; structural alert chain is what we're testing) |
| **E2E-V2-03** | missed-measurement (no log before deadline) | `alerts` row `alert_type='missed_measurement'` |
| **E2E-V2-06** | reminder lapse → patient logs after reminder | sequence of `audit_log` + `alerts` entries |

### 4.7 Edge cases (non-voice, applicable to v2-beta)
| # | Run | Pass criteria |
|---|---|---|
| **EDGE-V2-01** | `edge_registration_validation.yaml` | All four invalid-input rejections fire client-side |
| **EDGE-V2-02** | `edge_login_validation.yaml` | Wrong-password reject + lockout messaging |
| **EDGE-V2-03** | `patient_guardrail_block_text.yaml` | Guardrail-blocked message "I can't help with that here..." + RDS `model_call.guardrail_blocked=true` |
| **EDGE-V2-04** | first-time-login flow | FORCE_CHANGE_PASSWORD prompt + change → re-auth |
| **EDGE-V2-08** | force a Bedrock cross-region failover (cap on primary region quota) | RDS `inference_region` shifted |
| **EDGE-V2-09** | parse-failure replay | F19 covered; `guardrail_blocked` path |
| **EDGE-V2-10** | idle-session-timeout (advance the device clock or wait 30 min) | session-ended snackbar |
| **EDGE-V2-11** | pause + resume mid-session | RDS `status` flips PAUSED → in_progress |
| **EDGE-V2-13** | implausibility per parameter | F10 PLAUSIBILITY_CHALLENGE for non-BP vitals |
| **EDGE-V2-14** | network drop during sync of manual log | observation queued; auto-syncs on reconnect |
| **EDGE-V2-15** | mic-permission-denied | text fallback offered |
| **EDGE-V2-16** | `cross_region_disclosure_scan.yaml` | "AWS regions outside India" substring on registration screen |

### 4.8 Explicitly OUT of this run
- DR-V2-* (8 doctor journeys) — web-portal lacks `data-testid`s; Phase 2.
- PT-V2-10/11/12 (photo OCR) — manual, needs real photos.
- PT-V2-14 (rate limit) — needs ~500-call loop driver, cost-prohibitive.
- PT-V2-24 (reminder push) — needs second device.
- F23 turn-3 deep-dive — known partial, defer per pre-beta-todos.md §3.2.

---

## 5. Evidence capture pattern

For each journey, capture **all four** of these where applicable:

### 5.1 Maestro output
Save full stdout to `/tmp/bench-run-<DATE>/maestro/<journey-id>.log`.

### 5.2 RDS state
After the journey, run the relevant query and append to `/tmp/bench-run-<DATE>/rds/<journey-id>.txt`. Examples below.

### 5.3 CloudWatch
Capture the lambda log line that proves backend execution. `aws logs tail /aws/lambda/<fn> --since 3m --region ap-south-1 | grep <pattern>` — append matched lines to `/tmp/bench-run-<DATE>/cloudwatch/<journey-id>.txt`.

### 5.4 Screenshot
At the moment of the final assertion: `adb exec-out screencap -p > /tmp/bench-run-<DATE>/screenshots/<journey-id>.png`. Note: for voice flows, screenshot at the point of final session-end card.

### 5.5 Per-journey RDS query templates

**Vital-save journeys (PT-V2-15..20):**
```sql
SELECT key, last_modified, size FROM (
  SELECT 'placeholder' AS key, NOW() AS last_modified, 0 AS size
) t;  -- use aws s3 ls instead:
-- aws s3 ls s3://carelog-v2-staging-documents-316643066568/observations/CL-012W6M/ --recursive --region ap-south-1 | tail -5
```

**Voice round-trip (PT-V2-03/04/05/06):**
```sql
SELECT id, fsm_state, language, turn_count, status,
       jsonb_array_length(transcript_history::jsonb) AS history_len,
       captured_this_session
  FROM interaction_sessions
  WHERE patient_id = 'd4d38abb-af57-4658-a9e4-32b8701d12da'
  ORDER BY created_at DESC LIMIT 1;
```

**Threshold breach (E2E-V2-02):**
```sql
SELECT id, alert_type, vital_value, vital_unit, threshold_min, threshold_max,
       is_sent, sent_at, send_error, created_at
  FROM alerts
  WHERE patient_id = 'd4d38abb-af57-4658-a9e4-32b8701d12da'
    AND created_at > NOW() - INTERVAL '10 minutes'
  ORDER BY created_at DESC LIMIT 5;
```

**Care-team flows (CG-V2-19/20/21):**
```sql
SELECT pl.id, u.email, pl.relationship, pl.is_primary, pl.is_active, pl.updated_at
  FROM persona_links pl JOIN users u ON u.id = pl.linked_user_id
  WHERE pl.patient_id = 'd4d38abb-af57-4658-a9e4-32b8701d12da'
  ORDER BY pl.updated_at DESC;

SELECT id, action, resource_type, details->>'memberEmail' AS member, created_at
  FROM audit_log
  WHERE action IN ('INVITE', 'REMOVE_MEMBER')
    AND created_at > NOW() - INTERVAL '30 minutes'
  ORDER BY created_at DESC;
```

**Consent (PT-V2-23 / CG-V2-01):**
```sql
SELECT id, user_id, consent_type, consent_version, is_accepted, created_at
  FROM consent_records
  WHERE created_at > NOW() - INTERVAL '30 minutes'
  ORDER BY created_at DESC;
```

---

## 6. Net-new Maestro flows (write inline before the run)

These rows in §4 don't have a flow file in `.maestro/flows/` yet. Write them, save under `.maestro/flows/`, commit them at the end of the run.

### 6.1 `pt_v2_25_patient_history_view.yaml`
```yaml
appId: com.carelog
---
- launchApp:
    clearState: true
- extendedWaitUntil: { visible: { id: login_email }, timeout: 15000 }
- tapOn: { id: login_email }
- inputText: ${MATIKA_PATIENT_EMAIL}
- tapOn: { id: login_password }
- inputText: ${MATIKA_PATIENT_PASSWORD}
- hideKeyboard
- tapOn: { id: login_button }
- extendedWaitUntil: { visible: { id: patient_home_history }, timeout: 60000 }
- tapOn: { id: patient_home_history }
- extendedWaitUntil: { visible: "History", timeout: 15000 }
# After PT-V2-15..20 have run, the empty-state shouldn't be visible.
# If it is, that's the "Room DB clears on clearState" gap (separate follow-up).
- assertNotVisible: "No history yet"
```

### 6.2 `pt_v2_26_patient_sign_out.yaml`
```yaml
appId: com.carelog
---
- launchApp:
    clearState: true
- extendedWaitUntil: { visible: { id: login_email }, timeout: 15000 }
- tapOn: { id: login_email }
- inputText: ${MATIKA_PATIENT_EMAIL}
- tapOn: { id: login_password }
- inputText: ${MATIKA_PATIENT_PASSWORD}
- hideKeyboard
- tapOn: { id: login_button }
- extendedWaitUntil: { visible: { id: patient_home_start_conversation }, timeout: 60000 }
- tapOn: { text: "Settings" }
- extendedWaitUntil: { visible: { id: settings_sign_out }, timeout: 15000 }
- scrollUntilVisible:
    element: { id: settings_sign_out }
    direction: DOWN
- tapOn: { id: settings_sign_out }
- extendedWaitUntil: { visible: { id: login_email }, timeout: 30000 }
```

### 6.3 `pt_v2_27_patient_language_switch.yaml`
```yaml
appId: com.carelog
---
- launchApp:
    clearState: true
- extendedWaitUntil: { visible: { id: login_email }, timeout: 15000 }
- tapOn: { id: login_email }
- inputText: ${MATIKA_PATIENT_EMAIL}
- tapOn: { id: login_password }
- inputText: ${MATIKA_PATIENT_PASSWORD}
- hideKeyboard
- tapOn: { id: login_button }
- extendedWaitUntil: { visible: { id: patient_home_start_conversation }, timeout: 60000 }
- tapOn: { text: "Settings" }
- extendedWaitUntil: { visible: { id: settings_language_card }, timeout: 15000 }
- tapOn: { id: language_option_hi }
# Relaunch without clearState to verify persistence
- stopApp
- launchApp:
    clearState: false
- extendedWaitUntil: { visible: { id: login_email }, timeout: 15000 }
- tapOn: { id: login_email }
- inputText: ${MATIKA_PATIENT_EMAIL}
- tapOn: { id: login_password }
- inputText: ${MATIKA_PATIENT_PASSWORD}
- hideKeyboard
- tapOn: { id: login_button }
- extendedWaitUntil: { visible: { id: patient_home_start_conversation }, timeout: 60000 }
- tapOn: { text: "Settings" }
- extendedWaitUntil: { visible: { id: settings_language_card }, timeout: 15000 }
# Hindi RadioButton should be the selected one; if Maestro can't see RadioButton state,
# fall back to asserting the Hindi label is in the picker card.
- assertVisible: "हिन्दी"
```

### 6.4 `cg_v2_24_caregiver_patient_detail.yaml`
```yaml
appId: com.carelog
---
- launchApp:
    clearState: true
- extendedWaitUntil: { visible: { id: login_email }, timeout: 15000 }
- tapOn: { id: login_email }
- inputText: ${MATIKA_CAREGIVER_EMAIL}
- tapOn: { id: login_password }
- inputText: ${MATIKA_CAREGIVER_PASSWORD}
- hideKeyboard
- tapOn: { id: login_button }
- extendedWaitUntil: { visible: { id: add_patient_voice_fab }, timeout: 60000 }
# Patient list is rendered under "Your Patients" header. Jane PT row contains "Jane PT".
- tapOn: { text: "Jane PT" }
- extendedWaitUntil: { visible: "Jane PT", timeout: 15000 }
# PatientLogScreen-specific testTag (verify what exists in PatientLogScreen.kt first):
- assertVisible: { id: patient_log_screen }
```

### 6.5 `cg_v2_22_caregiver_history_view.yaml`
```yaml
appId: com.carelog
---
- launchApp:
    clearState: true
- extendedWaitUntil: { visible: { id: login_email }, timeout: 15000 }
- tapOn: { id: login_email }
- inputText: ${MATIKA_CAREGIVER_EMAIL}
- tapOn: { id: login_password }
- inputText: ${MATIKA_CAREGIVER_PASSWORD}
- hideKeyboard
- tapOn: { id: login_button }
- extendedWaitUntil: { visible: { id: caregiver_home_history }, timeout: 60000 }
- tapOn: { id: caregiver_home_history }
- extendedWaitUntil: { visible: "History", timeout: 15000 }
```

### 6.6 `cg_v2_23_caregiver_alerts_list.yaml`
Run AFTER E2E-V2-02 so there's at least one alert in the DB.
```yaml
appId: com.carelog
---
- launchApp:
    clearState: true
- extendedWaitUntil: { visible: { id: login_email }, timeout: 15000 }
- tapOn: { id: login_email }
- inputText: ${MATIKA_CAREGIVER_EMAIL}
- tapOn: { id: login_password }
- inputText: ${MATIKA_CAREGIVER_PASSWORD}
- hideKeyboard
- tapOn: { id: login_button }
- extendedWaitUntil: { visible: { id: add_patient_voice_fab }, timeout: 60000 }
# AlertListScreen nav path — confirm testTag in AlertListScreen.kt first.
# Likely route: tap the alert badge on Jane's row, OR a dedicated Alerts entry in Settings.
- tapOn: { id: caregiver_alerts_nav }     # adjust if wrong tag
- extendedWaitUntil: { visible: { id: alert_list }, timeout: 15000 }
- assertVisible: "Blood Pressure"        # or whatever alert was seeded by E2E-V2-02
```

If the `caregiver_alerts_nav` testTag doesn't exist, the orchestrator should **STOP**, file the missing-affordance as a new bug (analogous to the History gap closed 2026-05-23), and skip CG-V2-23.

---

## 7. Reporting template

End-of-run, the orchestrator writes `/tmp/bench-run-<DATE>/SUMMARY.md`:

```markdown
# Bench run <DATE> — staging

## Headline
- Total journeys attempted: N
- PASS: N
- FAIL: N (list with one-line per: ID, what failed, where)
- BLOCKED: N (list with reason)
- SKIPPED-by-design: N (per §4.8)

## New bugs surfaced
For each, file under `docs/testing_todos_v2.md` as a new F-row before closing the run.
- F<NN>: <one-line title>. Severity. Where surfaced. Reproduction.

## Per-journey table
| ID | Status | Maestro log | RDS evidence | CloudWatch | Screenshot |
| ... | ... | ... | ... | ... | ... |

## Lambda hash drift check
| Function | Before | After | Delta? |

## Next-session recommendations
- ...
```

Commit the bench-run dir at the end (or just summarize and discard the raw evidence — the user's call).

---

## 8. Failure recovery cheatsheet

| Symptom | Likely cause | Recovery |
|---|---|---|
| Voice flow's `RecognitionListener.onReadyForSpeech` never fires | F23 turn-3 bug OR SpeechRecognizer wedged | adb logcat capture, screenshot, mark journey as PARTIAL, continue |
| afplay hung >3s on Pop.aiff | F41 Core Audio wedge (this Mac) | Verify `MATIKA_SAY_REMOTE_URL` is set + reachable; the remote-TTS bypass is documented in `voice_harness_lessons.md` |
| `Connection refused` on psql 127.0.0.1:55433 | SSM tunnel timed out (~20 min idle) | Re-open the tunnel per §1.3 |
| `BadRequestException: No integration defined for method` from API GW | Stale terraform state (F53-class) | Do NOT run `terraform apply` mid-bench. File the bug and continue with other journeys |
| Cognito user collision on registration (CG-V2-01) | Email reused across runs | Use date-stamped suffix per §1.2 |
| Maestro `notVisible` passes but the element is actually still on screen, just off-viewport | The CG-V2-21 race-condition lesson | Prefer DB-side count assertions over `notVisible` for list operations |
| Lambda returns 500 mid-run | Either a real regression OR drift from the §1.5 hash baseline | Capture full CloudWatch trace; do NOT CLI-redeploy mid-run unless explicitly needed. Mark journey FAIL and continue |
| Maestro env var renders as literal `undefined` in the app form | Wrapper doesn't pass that var | Add to `scripts/maestro-run.sh` `-e` list (memory `maestro_lessons.md` item 5) |

---

## 9. After the run

1. **DO NOT** re-run the cleanup script — the bench results accumulated in RDS are the evidence.
2. Push the new Maestro flows from §6 to `.maestro/flows/` and commit them.
3. Update `docs/journeys_non_voice.md` + `docs/journeys_voice.md` per-row status fields with the captured evidence.
4. Update `docs/pre-beta-todos.md` §3.2 row counts and close any items that this run upgraded to PASS.
5. Add a memory entry summarizing the run's surprises (if any) so future sessions inherit the lessons.

---

## 10. Quick start (TL;DR)

```bash
# Pre-flight
adb devices                                                 # Samsung visible
curl -s http://10.0.0.171:8765/health                       # remote-TTS OK
source ~/.matika-test-creds.env
export MATIKA_SAY_REMOTE_URL="http://10.0.0.171:8765"
export MATIKA_TURN_TIMEOUT_S=150
export RUN_DATE=$(date -u +%Y%m%d-%H%M)
mkdir -p /tmp/bench-run-$RUN_DATE/{maestro,rds,cloudwatch,screenshots}

# Tunnel
aws ssm start-session --target i-0f2acdf1a96ee24a6 \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["55433"]}' \
  --region ap-south-1 &

# Build + install
(cd android && ./gradlew assembleDebug --quiet) && \
  adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# Cleanup (DESTRUCTIVE — confirm before running)
scripts/matika-staging-cleanup.sh                # dry-run
scripts/matika-staging-cleanup.sh --execute --yes

# Then walk §4 top-to-bottom, capture per §5, report per §7.
```

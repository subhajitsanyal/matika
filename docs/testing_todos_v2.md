# Matika v2 — Testing Backlog (Path to Exhaustive Coverage)

**Date:** 2026-05-08
**Source:** Sweep `20260508_215314` (Standard, English voice). See report at `test-automation/results/journey-results/20260508_215314/report.md` (local-only; gitignored).
**Status:** First-sweep findings recorded. Exhaustive coverage is **2–3 weeks of focused work** away, not "rerun with bigger sleeps."

---

## Why this file exists

The first Standard sweep covered **6 of 79 catalog journeys** by execution; the other 73 were paper-classified. Each non-executed journey has a documented reason — but a "reason" is not a result. This file is the durable backlog of work needed to convert "blocked" / "manual" status into actual execution.

Items below are ordered by **leverage** (journeys-unblocked-per-effort). Pick from the top of each section.

---

## Sweep harness fixes (highest leverage first)

### Backend-chain audit summary (2026-05-09)

A pass over every Lambda that reads or writes the `alerts` / `alert_reads` / `device_tokens` tables surfaced a partial-migration class of bugs: V001 renamed `alerts.value → vital_value`, `alerts.user_id → recipient_user_id`, dropped `alerts.deleted_at`, dropped `alert_reads`, and lowercased the `alert_type` enum — but most consumer Lambdas were never updated. F11 (resolved) was the first instance; F12-F16 below are siblings discovered tonight by direct SQL replay against the live dev schema.

### F12 — `check-daily-deadline` writes uppercase `'PATIENT_REMINDER'` enum literal (RESOLVED — verified live 2026-05-09)

**Severity:** High. With this bug present, the daily reminder cycle (E2E-V2-06, PT-V2-24) silently fails: the per-patient try/catch swallows the enum error and the lambda returns `0 reminders sent` with no observable failure. No `patient_reminder` row has ever landed in the dev `alerts` table.
**Owner:** `backend`.
**Status:** Fixed and verified end-to-end. Lowercased the two `'PATIENT_REMINDER'` literals in `backend/lambdas/check-daily-deadline/index.js` (the dedup `SELECT 1` and the `INSERT INTO alerts`). Replayed the exact INSERT against dev RDS post-fix: succeeds and returns the new row's id + `alert_type='patient_reminder'`. Lambda redeployed via `aws lambda update-function-code`. Existing 14-test jest suite still green.

**Why the lambda hadn't crashed visibly today.** The time-of-day gate (deadline 18:00 IST + Jane's daily_deadline=18:00) only triggers the INSERT branch between 18:00 and 23:59 IST. At the moment of the audit (02:04 IST = 20:34 UTC of 2026-05-09 PT), the gate excluded all patients before reaching the INSERT, so the bug was dormant. The next 18:00–23:59 IST window would have hit the per-patient catch and silently dropped the reminder.

---

### F13 — `alert-crud` reads non-existent `alerts.value`, `alerts.deleted_at`, `alert_reads` table, and `persona_links.user_id` (RESOLVED — verified live 2026-05-09)

**Severity:** High. Was: every caregiver alerts UI route (list, mark-read, delete) returned HTTP 500. Worse: the lambda was DOA — it required `pg` but had no `package.json` / `node_modules` shipped, so cold starts crashed before reaching SQL. CloudWatch had **0 invocation events ever recorded** before tonight's fix.
**Owner:** `backend`.
**Status:** Fixed and verified end-to-end. Rewrote the lambda against the live schema; added `package.json` + lockfile + 10-test jest regression-guard suite; deployed via `aws lambda update-function-code` (terraform can pick up the change next time it runs). Three paths verified live (John CG → Jane's alerts):

| Path | Result |
|---|---|
| `GET /patients/{patientId}/alerts` | 200; returns 6 rows (2 threshold_breach + 4 missed_measurement) with `vitalValue`, `vitalUnit`, `thresholdMin/Max` populated correctly. |
| `PATCH /alerts/{alertId}` `{read: true}` | 200; `alerts.is_read=true`, `read_at` populated. |
| `DELETE /alerts/{alertId}` | 200; row removed (hard delete — schema has no `deleted_at`). |

**Drift inventory** (all of these had to change in the rewrite):
- `a.value` → `a.vital_value`; response field renamed `value → vitalValue`. Added `vitalUnit / thresholdMin / thresholdMax` to the response so caregiver UI can render the breached side without a second round-trip.
- `LEFT JOIN alert_reads ar ON …` → direct `a.is_read` / `a.read_at` (the `alert_reads` table doesn't exist in V001+ schema; read state lives on `alerts` itself).
- `UPDATE alerts SET deleted_at = NOW()` → `DELETE FROM alerts WHERE id = $1` (hard delete; schema has no `deleted_at` column).
- `persona_links.user_id` → `persona_links.linked_user_id` (and `status='active'` → `is_active=true`).
- Added `resolveUserIdFromCognitoSub` helper — the lambda's incoming `sub` is the Cognito sub, but `persona_links.linked_user_id` and `alerts.recipient_user_id` are internal `users.id` UUIDs. The previous code passed `cognito_sub` straight in, which would never match.
- Authorization: `recipient_user_id` is the source of truth for "who can mark / delete this alert". Mark-read and delete now check `alerts.recipient_user_id = caller_user_id` and 403 otherwise.

---

### F14 — `notification-sender` legacy `storeAlert` writes to `user_id` and `value` columns that no longer exist (NEW — surfaced by audit)

**Severity:** Medium. Dormant in the v2 hot path: the new `evaluate-thresholds-batch` produces lowercase `type:'threshold_breach'` SQS messages, which the v2 handlers in this Lambda consume *without* writing to `alerts`. The legacy paths (`sendThresholdBreachNotification`, `sendPatientReminder`, `sendReminderLapseNotification`) all funnel through `storeAlert` and would crash if invoked with a legacy SQS payload.
**Owner:** `backend`.
**Estimated effort:** 2 hours (collapse legacy paths or rewrite `storeAlert` against the live schema).

**Reproduction.** `backend/lambdas/notification-sender/index.js` line 608:
```js
INSERT INTO alerts (patient_id, user_id, alert_type, vital_type, value, message, created_at)
VALUES ($1, $2, $3, $4, $5, $6, NOW())
```
- `user_id` → live schema is `recipient_user_id`.
- `value` → live schema is `vital_value`.
- Same uppercase-enum trap on the legacy `'PATIENT_REMINDER'` literal in lines 452, 481, 489.

**Recommendation.** Either delete the legacy paths entirely (the v1 sender flow they targeted is gone in v2), or fold them into the v2 handlers. Today they are pure dead code that keeps reappearing in audits.

---

### F15 — `notification-sender` device-token resolution is broken: UUID vs cognito_sub join + non-existent `endpoint_arn` column (NEW — surfaced by audit)

**Severity:** **Critical** for the second-device push verification path (CG-V2-07, CG-V2-08, CG-V2-09, E2E-V2-02 UI side). Even after F11/F12, the FCM push delivery side of the threshold-breach chain cannot work today.
**Owner:** `backend`.
**Estimated effort:** Half a day (schema reconcile + SNS endpoint plumbing).

**Reproduction.**
1. `device_tokens` schema (live):
   - `user_id` is `uuid NOT NULL`
   - The platform-token column is `device_token VARCHAR(512)` — there is **no `endpoint_arn` column**
2. `notification-sender` queries (multiple call sites):
   ```sql
   SELECT dt.endpoint_arn, dt.platform, ...
   FROM users u JOIN device_tokens dt ON dt.user_id = u.cognito_sub
   ```
   - Joins UUID-typed `device_tokens.user_id` against `users.cognito_sub` (varchar). Always returns 0 rows.
   - Selects `dt.endpoint_arn` which doesn't exist; even if the join worked, the SELECT would error.

**Net effect.** When E2E-V2-02 enqueues a `threshold_breach` SQS message (now correctly populated post-F11), notification-sender consumes it but `getCaregiverDeviceEndpoints` returns `[]` → no `sendPushNotification` call → caregiver phone never rings. Tonight's "SQS messages went `NotVisible=2`" log line tells us notification-sender accepted the message; it does *not* tell us a push was sent.

**Fix sketch.**
- Decide whether to register SNS platform endpoints (then add an `endpoint_arn` column to `device_tokens` + the registration plumbing), or to skip SNS and call FCM Admin SDK / direct HTTP push from the lambda using `device_token` directly.
- Either way, fix the join: `dt.user_id = u.id` (UUID = UUID).

---

### F16 — `doctor-patients` references non-existent `alert_reads` table and `alerts.deleted_at` column (NEW — surfaced by audit)

**Severity:** Low (today). All 8 DR-V2-* journeys are already blocked on `data-testid` and Playwright-runner work. Once the web portal is unblocked, this lambda will crash on the doctor's patient list.
**Owner:** `backend`.
**Estimated effort:** 30 min.

**Reproduction.** `backend/lambdas/doctor-patients/index.js` line 92 builds:
```sql
SELECT COUNT(*)
FROM alerts a
LEFT JOIN alert_reads ar ON ar.alert_id = a.id AND ar.user_id = $1
WHERE a.patient_id = p.id AND ar.id IS NULL AND a.deleted_at IS NULL
```
- `alert_reads` doesn't exist (`Did not find any relation named "alert_reads"`).
- `a.deleted_at` doesn't exist (same as F13).
- Plus uses `pl.role = 'doctor'` and `pl.status = 'active'` — `persona_links` schema actually exposes `relationship` and `is_active` (verified earlier when I ran the persona_links lookup for Jane).

**Fix.** Use the schema-correct columns: `recipient_user_id`-based unread count (per `patient-summary` already does this correctly), `relationship='doctor'`, `is_active=true`, drop the deleted_at filter.

---

### F11 — `evaluate-thresholds-batch` writes `alerts` row with the wrong column name and no recipient (RESOLVED — verified live 2026-05-09)

**Severity:** High. Was: **no `threshold_breach` alert could ever land in the `alerts` table** — the entire E2E-V2-02 / E2E-V2-03 caregiver-notification chain was silently broken end-to-end.
**Owner:** `backend`.
**Status:** Fixed and verified end-to-end. Direct invoke of `carelog-dev-evaluate-thresholds-batch` with a 200/110 BP payload now creates two `alerts` rows (systolic + diastolic) and enqueues two SQS messages on `carelog-dev-alerts`. Lambda code updated via `aws lambda update-function-code` (terraform path was carrying unrelated cognito drift; bypassed it to keep blast radius narrow).

**Reproduction (2026-05-09).** After provisioning Jane with a BP `parameter_configs` row (systolic 90–160 / diastolic 50–95), direct invoke of `carelog-dev-evaluate-thresholds-batch` with a clearly-breaching payload (200/110) returns:
```
StatusCode=200, FunctionError=Unhandled
errorMessage: 'column "value" of relation "alerts" does not exist'
trace: createAlertRecord (/var/task/index.js:102:18)
```

**Root cause(s)** (all in `backend/lambdas/evaluate-thresholds-batch/index.js`):
1. **Column-name mismatch.** `createAlertRecord` does `INSERT INTO alerts (..., value, ...)` but the live schema has `vital_value` (and `vital_unit`, neither of which is populated).
2. **Missing required column.** `alerts.recipient_user_id` is `NOT NULL` but the INSERT omits it. The lambda already calls `findLinkedCaregiver(...)` for the SQS message but never threads the caregiver's `linked_user_id` into the alert row.
3. **Threshold values lost.** The `alerts.threshold_min` / `alerts.threshold_max` columns are never populated, so caregiver UI can't render the breached limits without re-querying `parameter_configs`.

**Fix sketch.**
```diff
-INSERT INTO alerts (patient_id, alert_type, vital_type, value, message, created_at)
-VALUES ($1, $2, $3, $4, $5, NOW())
+INSERT INTO alerts (
+  patient_id, recipient_user_id, alert_type, vital_type,
+  vital_value, vital_unit, threshold_min, threshold_max, message, created_at
+) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
```
plus pulling the caregiver's `linked_user_id` from the existing `findLinkedCaregiver` call into the params, and reading `matchingConfig.threshold_min[0]` / `[0]` (or `null`) for the breached-side bound.

**Why this wasn't caught before.** E2E-V2-02 was never executed — it was paper-classified as "blocked: Jane lacks config." Provisioning Jane (this evening) was the first time the chain ran end-to-end against the real RDS schema.

**Adjacent risk:** double-check `notification-sender` for the same kind of column-name drift against `alerts` reads before relying on push delivery for verification.

**Verification (2026-05-09 19:48Z).**
- Direct invoke (`200/110` BP payload, Jane's `patient_id`):
  ```
  StatusCode=200 (no FunctionError)
  breaches_found=2; alert_id=c6502587-…(systolic), 0088f6e6-…(diastolic)
  ```
- RDS `alerts`:
  | id | alert_type | vital_type | vital_value | vital_unit | threshold_max | recipient_user_id |
  |---|---|---|---|---|---|---|
  | c650… | threshold_breach | blood_pressure_systolic | 200.00 | mmHg | 160.00 | a2b0…(John CG) |
  | 0088… | threshold_breach | blood_pressure_diastolic | 110.00 | mmHg |  95.00 | a2b0…(John CG) |
- SQS `carelog-dev-alerts`: 2 messages enqueued (`ApproximateNumberOfMessagesNotVisible=2` immediately after, indicating notification-sender picked them up for processing).
- CloudWatch confirmed: `Enqueued threshold breach notification for blood_pressure_systolic` × 2 + `Evaluation complete: 2 breaches found out of 2 values`.

**Bonus fix on the way.** While verifying, also surfaced and fixed a sibling bug in the same file: `createAlertRecord` was passing the literal string `'THRESHOLD_BREACH'` to the `alerts.alert_type` column, but the live `alert_type` enum only contains lowercase values (`threshold_breach`, `reminder_lapse`, `system`, `missed_measurement`, `patient_reminder`). Changed to `'threshold_breach'` to match.

**Side note: terraform drift parked.** The dev cognito module has unrelated drift (SES `email_configuration`, `device_configuration`, `invite_message_template`) introduced in commit `66ca57c` and never applied. Targeted `terraform plan` for any lambda in this module currently surfaces the cognito changes too, even with `-target`. Investigate + apply (or revert) the cognito drift in a dedicated change before the next non-targeted apply.

---

### F10 — State-machine allowlist rejects CREATED -> PLAUSIBILITY_CHALLENGE (RESOLVED — verified live 2026-05-09)

**Severity:** Medium. Was: implausible-value handling on the **very first turn** crashed with HTTP 500.
**Owner:** `backend`.
**Status:** Fixed and verified end-to-end. PT-V2-08-via-text now round-trips cleanly; `interaction_sessions.fsm_state='PLAUSIBILITY_CHALLENGE'` recorded immediately after submit, no `StateTransitionError` in logs. Bedrock-router live alias bumped to v30.

**Problem.** When a patient's first utterance is an implausible value (e.g. "my BP is 300 over 200"), the LLM correctly emits `stateTransition: "CREATED -> PLAUSIBILITY_CHALLENGE"` and the response text "could you re-check the reading?". The `bedrock-router` Lambda then **rejects** the LLM output with `StateTransitionError: Transition CREATED -> PLAUSIBILITY_CHALLENGE is not in the allowed set` and returns HTTP 500 to the app.

**Reproduction.** PT-V2-08-via-text in sweep `20260509_000226`:
```
MatikaConversationVM: submitTurn seq=1 sessionId=... chars=51
MatikaConversationVM: submitTurn failed seq=1
retrofit2.HttpException: HTTP 500
```
Lambda log:
```
ERROR handleTurn failed StateTransitionError: Transition CREATED -> PLAUSIBILITY_CHALLENGE is not in the allowed set.
```

**Why it's not a regression from F2.** F2 only added `status` / `endedAt` columns + COALESCE in SQL + `computeSessionTerminus` helper. None of those touch state-transition validation. PT-V2-09 emergency text passed cleanly in the same sweep — `CREATED -> EMERGENCY` is in the allowlist (incidentally), proving the allowlist itself is the issue, not transition logic.

**Fix.** Extend the allowed-transition set in the bedrock-router state machine to include first-turn shortcuts:
- `CREATED -> PLAUSIBILITY_CHALLENGE` (covers PT-V2-08)
- `CREATED -> EMERGENCY` (already works but should be explicit not incidental)
- `GREETING -> PLAUSIBILITY_CHALLENGE` (covers the case where the patient's first content turn after a greeting is implausible)
- `GREETING -> EMERGENCY` (same)

**Verification (2026-05-09 18:13Z).** PT-V2-08-via-text re-run after deploy:
- UI: `matika_response_card` mounted; flow PASSES.
- RDS `interaction_sessions` (id=`dabd26ae-…`): `fsm_state='PLAUSIBILITY_CHALLENGE'`, `status='in_progress'`, started 18:13:22Z. Exactly the transition that previously crashed.
- RDS `model_call`: T2 Haiku (`global.anthropic.claude-haiku-4-5-20251001-v1:0`), latency 2840ms, no guardrail block, `escalation_reason` empty.
- No `StateTransitionError` in `/aws/lambda/matika-dev-bedrock-router` logs.

**Note vs original spec.** This finding's original "fix" hypothesis predicted a **T3 Sonnet escalation with `escalation_reason='implausible_value'`**. In practice, T2 Haiku itself proposes the `CREATED -> PLAUSIBILITY_CHALLENGE` transition without escalation — the LLM detected the implausibility on its own and emitted the correct stateTransition. The allowlist was the only blocker. This is **cheaper than expected** (T2 vs T3) and arguably better behaviour. EDGE-V2-13 (which testing_todos previously called out as "same allowlist root cause") should now also unblock — schedule for next sweep.

---

### F9 — STT result not routed from Android STT to /conversation/turn (RESOLVED — verified live in voice flow)

**Severity:** High. Was the root cause of "voice journeys never produce model_call rows."
**Owner:** `android-app`.
**Status:** Fixed and verified end-to-end (sweep iteration after `20260508_230704`).

**Root cause.** Two-layer drop:
1. `SttResult.kt::extractFirstTranscript` returned `null` when only the *first* hypothesis was blank — even if subsequent hypotheses were non-blank. Soda sometimes ranks an empty/whitespace hyp first under noisy/short utterances.
2. `SttManager::onResults` converted the `null` to `""` via `.orEmpty()` and emitted `SttResult.Final("")`. `MatikaConversationViewModel` then silently skipped `submitTurn` due to its `isNotBlank()` guard — no log, no UI feedback, no error.

**Fix.**
- `extractFirstTranscript` now picks the first non-blank hypothesis (`firstOrNull { !it.isNullOrBlank() }`).
- `SttManager::onResults` logs success (`chars=N`) AND surfaces all-blank hyps as `SttResult.Error(NO_MATCH, ...)` instead of silently emitting `Final("")`.
- VM's blank-text branch now logs + surfaces a user-visible error so any future regression upstream doesn't disappear.

**Verified.** Single-turn voice flow (`patient_voice_bp_en_single_turn.yaml`) produced:
```
SttManager: RecognitionListener.onResults chars=32
MatikaConversationVM: STT final transcript chars=32; submitting turn
MatikaConversationVM: submitTurn seq=1 sessionId=... chars=32
```
Followed by a new `model_call` T2 row in RDS (`latency_ms=2653`, no guardrail block) and `extractedValues` populated in bedrock-router output.

**Companion finding (unfixed):** the multi-turn voice flow's vacuous F6 assertion lets Maestro double-tap mic in <1s, which `onMicPressed()` interprets as a CANCEL of the in-flight STT job. Real fix is F6 (response-card testTag → non-vacuous post-turn assertion). Until then, voice journeys should use the single-turn flow variant or wait on a response card by content.

---

### F7 — Logcat-trigger voice orchestration ⭐

**Severity:** High for voice journeys (8+).
**Owner:** `qa-testing` / orchestrator.
**Estimated effort:** 0.5 day.

**Problem.** `scripts/matika-say.sh` is invoked from a fixed-sleep orchestration: `sleep N ; matika-say …`. `N` is a guess at "when has Maestro reached mic-active?" The first Standard sweep tried 8s and 25s — both spoke before the mic was actually listening (cold install + login + nav takes ~45s on Samsung S21+).

**Fix.** Replace the `sleep` with `adb logcat` waiting on `SodaSpeechRecognizer.*Offline recognizer - start listening`. When that line appears, mic is active for ~4–5s; speak immediately (with `matika-say`'s 600ms predelay).

**Implementation.**
- New script `scripts/matika-voice-run.sh` that: backgrounds `maestro-run.sh`, tails logcat, waits for the trigger pattern, calls `matika-say`, repeats per turn, joins.
- Update `.maestro/flows/patient_voice_bp_en.yaml` header to point at the new orchestrator.
- Update `docs/matika_test_plan_v2.md` §Phase 4 coordination matrix to use logcat-trigger instead of fixed sleep.
- Update `.agents/journey-orchestrator.md` Pattern B accordingly.

**Unlocks (immediately after F7):** PT-V2-03 (single-param en), PT-V2-04 (multi-param en), PT-V2-05 (Hindi), PT-V2-08 (implausible value, T3), PT-V2-09 (emergency, T3), CG-V2-03 (voice protocol config), CG-V2-04 (voice patient onboarding). **7 journeys.**

### F5 — `scripts/maestro-run.sh --no-install` is positional-only

**Severity:** Low (cosmetic; ~5s wasted per run).
**Owner:** `qa-testing`.
**Estimated effort:** 5 minutes.

**Fix.** Parse args order-independently — loop over `$@`, recognise `--no-install` anywhere.

### F6 — Voice flow `notVisible: thinking` assertion is vacuous (RESOLVED)

**Severity:** High for voice journeys (silently masks failures).
**Owner:** `qa-testing` + `android-app`.
**Status:** Fixed and verified.

**Problem.** When STT got no speech, no transcript was submitted, "thinking" never appeared on screen, and `notVisible: thinking` evaluated true. Maestro reported the journey green; the round-trip never happened.

**Fix.** Four new testTags on `MatikaConversationScreen`:
- `matika_response_card` — only mounts when `lastResponseText` is non-blank (post-Bedrock-round-trip). The non-vacuous `assertVisible` for single-turn voice flows.
- `matika_turn_counter` — surface the `"turn N"` text so multi-turn flows can assert on `text: "turn 2"` (since `matika_response_card` stays visible across turns).
- `matika_speaking_indicator` — multi-turn flows wait for `notVisible` before tapping mic for turn 2; otherwise TTS playback bleeds into Soda's listening window and the second turn returns NO_MATCH.
- `matika_thinking_indicator` and `matika_listening_indicator` — companion tags for diagnostic assertions.

**Verified.** Single-turn flow `patient_voice_bp_en_single_turn.yaml` exit=0 with `Assert that id: matika_response_card is visible... COMPLETED` and `submitTurn ok fsm=PENDING_CONFIRMATION extracted=2`. Multi-turn flow now **honestly** detects when turn 2 fails instead of false-passing.

**Residual acoustic flakiness (NOT a F6 bug):** the multi-turn flow's turn 2 ("Yes, that value is correct") still hits Soda NO_MATCH intermittently — short confirmation utterances are at the edge of Soda's offline-pack confidence threshold even when TTS playback has finished. Solutions:
- Use longer / more distinct turn-2 utterances ("Yes, the value is correct, please save it")
- Boost speaker volume / tighten phone-to-speaker placement during voice-test runs
- Switch second-turn from voice to text fallback when only confirmation is needed (text round-trips deterministically)

This is a tuning matter for the test environment, not a code defect. The first-turn voice path works deterministically.

---

## Real product bugs from the sweep

### F1 — `users.last_login_at` never updated post-login

**Severity:** Medium. Login telemetry is broken; ops dashboards reading the field show stale data.
**Owner:** `backend`.
**Estimated effort:** 0.5 day.

**Surfaced by:** PT-V2-07. Jane logged in via the app; `SELECT last_login_at FROM users WHERE id=<jane>` returns NULL.

**Fix.** Identify where post-Cognito-login state is written and add the `users.last_login_at = NOW()` update. Likely candidates: `post-confirmation` Lambda is for sign-up only; need a separate path for sign-in. Could be:
- A new `post-authentication` Lambda trigger on the Cognito user pool (preferred — server-side).
- Or, an app-side `PUT /users/me/login` call after Cognito returns tokens.

**Verification.** PT-V2-07 backend-checks.json regression: re-run sweep and assert `users.last_login_at IS NOT NULL` and within `[started_at, ended_at]` window.

### F2 — `interaction_sessions` never marked complete

**Severity:** Medium. Session state machine doesn't transition to TERMINAL; rows stay `status='in_progress'` indefinitely.
**Owner:** `backend` + `android-app` (depending on where the transition is owned).
**Estimated effort:** 1 day.

**Surfaced by:** PT-V2-07 + Phase 5 query — three Jane sessions across this and prior runs all `status='in_progress'`, `ended_at=NULL`.

**Fix options.**
- **App-side explicit close:** `MatikaConversationViewModel` sends `POST /sessions/{id}/end` when the user navigates away or the session reaches `complete_session` action.
- **Server-side timeout sweep:** EventBridge cron fires hourly, marks sessions older than 30 min idle as `terminal_incomplete`.
- Probably want both: explicit close for the happy path + timeout for crashes / app kills.

**Verification.** PT-V2-07 leaves a `status='in_progress'` row today. After fix, re-run sweep and assert: either (a) Maestro flow ends with explicit close → `status='complete'`, OR (b) post-sweep timeout sweep collapses to `terminal_incomplete`.

### F3 — `create-patient` masks `UsernameExistsException` as generic 500

**Severity:** Low–Medium. Real users hitting the email-collision case get a useless error.
**Owner:** `backend`.
**Estimated effort:** 1 hour.

**Surfaced by:** CG-V2-02 in this sweep (the journey that "skipped" because Jane already existed). Lambda log shows the real cause; UI shows `Failed to create patient: HTTP 500 {"error":"Failed to create patient"}`.

**Fix.** In `backend/lambdas/create-patient/index.js`, catch `UsernameExistsException` specifically and return `409 Conflict` with body `{error: "An account with this email already exists. Use a different email or contact support."}`. Surface via the existing `onboarding_error` testTag with the same string.

**Verification.** Re-run CG-V2-02 against pre-existing Jane → expect `409` in Lambda log + `onboarding_error` text matching the new copy.

---

## Architecture / journey-doc divergence

### F4 — v2 home is voice-first; v1 vital screens still ship

**Severity:** Medium (test coverage cliff + APK bloat).
**Owner:** `android-app` (decision) + `qa-testing` (journey doc).
**Estimated effort:** 1 day for either resolution path.

**Problem.** `PatientHomeScreen.kt` has only "Start Conversation" — no vital tile grid. But `BloodPressureScreen.kt`, `GlucoseScreen.kt`, `TemperatureScreen.kt`, `WeightScreen.kt`, `PulseScreen.kt`, `SpO2Screen.kt` all still exist with `<param>_save_button` testTags, and routes are still wired in `CareLogNavHost.kt`. They are unreachable from the home UI. `docs/journeys.md` PT-V2-15..21 describes a v1 UX.

**Same orphan pattern on the caregiver side (added 2026-05-09).** `ThresholdConfigScreen`, `ReminderConfigScreen`, and `TrendsScreen` all exist with reasonable testTags (e.g. `threshold_<vital>_min/max`), but their *only* navigator is `RelativeDashboardScreen` — and the v2 persona-mapping in `CareLogNavHost.kt` routes `PersonaType.RELATIVE → CAREGIVER_DASHBOARD`, never to `RELATIVE_DASHBOARD`. So caregivers literally cannot reach those three screens from the v2 home/settings flow. Adds CG-V2-12, CG-V2-13, CG-V2-17 to the F4 journey list.

**Updated journey list (12 affected):**
- Patient side: PT-V2-15 (BP), -16 (glucose), -17 (temperature), -18 (weight), -19 (pulse), -20 (SpO₂), -21 (vitals overview), EDGE-V2-14 (vital edit).
- Caregiver side: CG-V2-12 (configure thresholds), CG-V2-13 (configure reminders), CG-V2-17 (view trends).

**Resolution paths (need product decision — applies to both patient and caregiver orphans).**
- **Path A — restore tile/menu nav.** Add a "Quick Log" button to `PatientHomeScreen` → tile grid; add "Thresholds / Reminders / Trends" entries to `SettingsScreen` (or to the expanded patient card in `CaregiverHomeScreen`). All 12 journeys become runnable as written.
- **Path B — delete the orphan code.** Remove patient vital screens + routes; remove `RelativeDashboardScreen` + `ThresholdConfigScreen` / `ReminderConfigScreen` / `TrendsScreen` + their routes; rewrite the affected journeys to describe "manual entry within the voice conversation" / "thresholds set by the v2 caregiver_protocol_setup conversation" or mark them v1-only.

**No agentic action until decision made.** Flag for product owner.

---

## Informational / spec alignment

### F8 — Bedrock inference profile name divergence

**Severity:** Informational.
**Owner:** `devops` or `inference-platform`.
**Estimated effort:** 30 min.

**Problem.** `model_call.model` reads `global.anthropic.claude-haiku-4-5-20251001-v1:0`. Spec §3.3 documents `apac.anthropic.claude-haiku-4-5-v1:0`. The deployment uses the GLOBAL profile; spec says APAC. They're both valid cross-region profiles; just align the docs to reality (or change the env var if APAC was intended).

**Fix.** Update `docs/matika_spec_v2.md` §3.3 + §7.5 + §14.3 to read `global.*`, OR update `BEDROCK_HAIKU_MODEL_ID` / `BEDROCK_SONNET_MODEL_ID` in the Lambda env to `apac.*`.

---

## Coverage expansion (not from this sweep)

The remaining ~73 catalog journeys group into work categories:

### Caregiver management Maestro flows (CG-V2-10..18) — 13 journeys

**Owner:** `qa-testing`.
**Estimated effort:** 2–3 days (mechanical).

Author Maestro flows for: invite-doctor, manage care team, configure thresholds manually, configure reminders manually, view trends, sign out. Each needs a testTag audit on the relevant settings screen. Some require the response from earlier flows (e.g. CG-V2-14 needs a doctor recommendation, which needs DR-V2-05, which is web-blocked).

### Edge cases EDGE-V2-01..17 — 17 journeys

**Owner:** `qa-testing` for input-validation cases; `inference-platform` / `devops` for fault-injection.
**Estimated effort:** 1–5 days depending on subclass.

- **Trivial (~30 min each):** EDGE-V2-01/02 — registration + login validation; just feed bad inputs.
- **Medium (~2 hours each):** EDGE-V2-13 (plausibility ranges), EDGE-V2-14 (network drop), EDGE-V2-15 (mic permission denied) — flow + adb svc cycle.
- **Hard (~1 week total):** EDGE-V2-08 (cross-region failover), EDGE-V2-09 (parse failure), EDGE-V2-03 (Guardrail block) — need fault-injection harness or Bedrock mock layer.
- **Out-of-budget by design (~5):** EDGE-V2-05/06/10/12/17 — JWT 1-hour / 30-day / idle-30min / pause-5min / fresh-install. Run as scheduled long-tail jobs.

### Web portal doctor journeys DR-V2-01..08 — 8 journeys

**Owner:** `web-portal` (testid first), then `qa-testing` (Playwright runner).
**Estimated effort:** 1–2 days.

1. `web-portal` agent adds `data-testid` to LoginPage, PatientListPage, PatientViewPage, DoctorRegistrationPage. Inventory via the same approach as the Android testTag inventory.
2. `qa-testing` writes `web-portal/scripts/run-journey.mjs` Playwright runner.
3. New agent spec `.agents/web-journey-runner.md` if patterns diverge meaningfully from `journey-runner`.

### Push-notification verification CG-V2-07/08/09, E2E-V2-02/03, PT-V2-24

**Owner:** `qa-testing` + `devops`.
**Estimated effort:** 3–5 days.

Either (a) emulate a second device on the Mac (a second AVD running the caregiver build) and observe FCM delivery; or (b) intercept FCM at the SNS layer in dev and assert payload shape. (b) is more reliable but needs SNS sandboxing.

### Photo-OCR journeys PT-V2-10/11/12

**Owner:** Manual (human in the loop).
**Estimated effort:** 1 hour each, ad hoc.

Genuinely require a real glucometer, BP cuff, or thermometer. Stage in the Photo OCR runbook + require a smoke run before any Bedrock-vision deploy.

### Out-of-scope per PRD §12 — 6 journeys

No work — deliberate exclusions: Bluetooth, iOS, full offline mode, in-app messaging, doctor-onboards-patient, v1 attendant.

---

## Estimated effort summary to reach "exhaustive"

| Workstream | Effort | Journeys unblocked |
|---|---|---|
| F7 logcat-trigger voice | 0.5 day | 7 (voice) |
| F1 last_login_at | 0.5 day | (fixes regression in already-running journeys) |
| F2 session never completes | 1 day | (fixes regression in already-running journeys) |
| F3 UsernameExists mapping | 1 hour | (improves CG-V2-02) |
| F5 maestro-run.sh args | 5 min | — |
| F6 response-card testTag | 1 hour | (makes voice assertions non-vacuous) |
| Caregiver Maestro flows | 2–3 days | 13 |
| Edge case input + adb-cycle flows | 2 days | ~10 |
| Edge case fault-injection | 1 week | ~5 |
| Web portal data-testid + Playwright | 1–2 days | 8 |
| Push-notification verification harness | 3–5 days | 6 |
| Photo OCR (manual smoke) | ad hoc | 3 |
| **Total to exhaustive** | **~2–3 weeks** | **~50 unblocked** |

After this work, ~73 of 79 are runnable; remaining ~6 are deliberately out-of-scope per PRD §12.

---

## How to track progress

This file is the durable backlog. Per-sweep status (which TODOs were closed, which surfaced new ones) is tracked in each sweep's `report.md` — see `test-automation/results/journey-results/<sweep-id>/`. Update this file when:

- A TODO is fixed and re-verified by a sweep
- A new finding from a sweep adds an item
- Effort estimates change after attempting

---

*Last updated: 2026-05-08 after first Standard sweep (`20260508_215314`).*

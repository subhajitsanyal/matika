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

**Resolution paths (need product decision).**
- **Path A — restore tile nav.** Add a "Quick Log" button on home → 6-tile screen → existing per-vital screens. PT-V2-15..21 become runnable as written.
- **Path B — delete the orphan code.** Remove vital screens + routes; rewrite PT-V2-15..21 to describe "manual entry within the voice conversation" or mark them as "v1-only".

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

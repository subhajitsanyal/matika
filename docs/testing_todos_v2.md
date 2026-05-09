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

### F9 — STT result not routed from Android STT to /conversation/turn (NEW — surfaced by F7 fix)

**Severity:** High. Root cause of "voice journeys never produce model_call rows."
**Owner:** `android-app`.
**Estimated effort:** 0.5 day.

**Problem.** With F7 in place, `SodaSpeechRecognizer` produces `#handleFinalResult: 3 hyp` and `RecognitionClient #onResults withSpeech: true` — STT is working. But there is **no subsequent `MatikaConversationVM` log line** indicating the transcript was received, and **no new `model_call` row** for the turn window. The app-side bridge between `SttManager.RecognitionListener` and the conversation VM appears to be dropping the result.

**Reproduction.** Run F7 voice flow, grep logcat for `MatikaConversationVM` after a successful `#onResults withSpeech: true`. Today there's only the initial "Started v2 session" log — nothing after.

**Investigation candidates.**
- `audio/stt/SttManager.kt` — does `onResults` fire the listener with the top hypothesis? Or is it filtering?
- `inference/ConversationStateMachine.kt` — does it accept STT events when in `EXTRACTING` state?
- `inference/MatikaConversationViewModel.kt` — does it have a `submitTranscript()` path that's hooked to STT?

**Verification.** After fix, voice flow turn 1 should produce: `MatikaConversationVM: Submitting turn N transcript chars=...` followed by a new `model_call` row with `tier='T2'`.

This finding was hidden until F7 fixed orchestration timing — STT was failing earlier (no audio reaching mic), so no one noticed the pipeline downstream from STT was also broken.

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

### F6 — Voice flow `notVisible: thinking` assertion is vacuous

**Severity:** High for voice journeys (silently masks failures).
**Owner:** `qa-testing` (`.maestro/flows/`) + `android-app` (testTag).
**Estimated effort:** 1 hour (split: tag + flow update).

**Problem.** When STT gets no speech, no transcript is submitted, "thinking" never appears on screen, and `notVisible: thinking` evaluates true. Maestro reports the journey green; the round-trip never happened.

**Fix.** Add `matika_response_card` testTag (or `matika_user_utterance_chip`) on the response render. Voice flow asserts `extendedWaitUntil visible: id: matika_response_card` after each turn. Now the assertion only passes if Bedrock actually responded.

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

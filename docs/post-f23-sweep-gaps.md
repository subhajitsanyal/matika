# Post-F23 sweep — identified gaps

Compiled at the end of the 2026-05-10 post-F23 journey-testing sweep
(commits `eb60a55` → `7cfb2e1` on `origin/main`). The sweep landed
9 new PASSes (PT-V2-15..21, CG-V2-12, CG-V2-17) and exposed one
critical regression plus a handful of smaller infra/code gaps.

This document is the **fix backlog** that the next session's
orchestrator works against. Each gap has: severity, owner, current
state, repro, fix sketch, verification path. The corresponding
F-item entries in `docs/testing_todos_v2.md` are the canonical
source of truth — this doc is a focused dispatch summary, not a
duplicate catalog.

---

## Gap 1 — F27 (CRITICAL): legacy v1 Mac Mini health check gates v2 patient conversation Button

**Severity:** Critical. Regresses the CI gate (`patient_logging_happy_path`) and every flow that taps `patient_home_start_conversation`. In-scope journeys directly blocked: EDGE-V2-03, PT-V2-06. Legacy passes presumed at-risk (not re-verified during sweep): PT-V2-07, PT-V2-08, PT-V2-09, PT-V2-13, EDGE-V2-11, EDGE-V2-13.

**Owner:** `android-app`.

**Where it lives in code:**
- Gate: `android/app/src/main/java/com/carelog/dashboard/ui/PatientHomeScreen.kt:205-238` — `Button(onClick = onStartConversation, enabled = degradation.canConverse, ...)`.
- Source of `canConverse`: `android/app/src/main/java/com/carelog/dashboard/ui/ModelStatusBanner.kt:135-182` — `computeDegradationState(status: ModelHealthStatus)`. Maps `OFFLINE → canConverse = false`.
- Source of `status`: `android/app/src/main/java/com/carelog/discovery/HealthCheckService.kt` — polls a Mac Mini `:8000/health` endpoint after mDNS-discovering `_carelog._tcp.`. v2 dropped Mac Mini (Bedrock + on-device STT/TTS replaced it) but this service still drives `canConverse`.

**Repro:**
```bash
source ~/.matika-test-creds.env
scripts/maestro-run.sh patient_logging_happy_path
# Fails at: Assert that id: matika_text_fallback is visible
# UI dump shows: text="Conversation Unavailable", contentDescription="Conversation unavailable. CareLog device services are not ready."
adb logcat -d -s MacMiniDiscovery   # shows "mDNS discovery started" but no match
```

**Root cause:** After `launchApp: clearState: true`, `appSettings.macMiniBaseUrl` is null. The dev LAN no longer advertises a Mac Mini (`_carelog._tcp.` resolves to nothing). `HealthCheckService._healthStatus` stays at `ModelHealthStatus.OFFLINE`. `computeDegradationState(OFFLINE)` returns `canConverse = false`. The Compose `Button` honors `enabled = false` and refuses tap dispatch — Maestro sees the tile is visible and "taps" it but nothing navigates.

**Fix Path A (recommended for v2.0):** Drop the v1 gate on the patient home Button. Edit `ModelStatusBanner.computeDegradationState` so the `OFFLINE` branch returns `canConverse = true` (the actual v2 health surface is the Bedrock backend, not a LAN-local Mac Mini). Keep the warning banner copy so users see degraded-mode messaging when the legacy service is reachable but partially down — but stop letting an absent Mac Mini gate the v2 conversation entry. Smallest blast radius; ~30 min change + verify.

```kotlin
// Sketch — ModelStatusBanner.kt:174 onwards
OverallStatus.OFFLINE -> DegradationState(
    canConverse = true,          // ← v2: Bedrock backs the conversation; the v1 Mac Mini gate is misleading
    ttsAvailable = false,        // on-device TTS is independent of this poller anyway
    visionAvailable = false,
    severity = DegradationSeverity.NONE,   // ← drop the ERROR severity
    message = null               // ← stop showing "CareLog device not found" — v2 has no such device
)
```

**Fix Path B (saves for v2.1 rename):** Replace `HealthCheckService` with a v2 backend health poller (e.g. `GET /v2/health` against the `bedrock-router` lambda surface). Drive `canConverse` off that. Wider blast radius — touches `discovery/`, `network/`, and likely DI wiring. ~1 day of work; aligns with the v2.1 `carelog-*` → `matika-*` rename and lets us actually surface "Bedrock unreachable" as a real degraded state.

**Verification after fix:**
1. `scripts/maestro-run.sh patient_logging_happy_path` → PASS (CI gate restored).
2. `scripts/maestro-run.sh patient_guardrail_block_text` → re-verifies F19 (parser fix from 2026-05-10) at the same time. PASS = F19 + F27 both green.
3. `scripts/matika-voice-run.sh patient_voice_bp_bn_single_turn` with `MATIKA_BN_AUDIO=<path>` → PT-V2-06 re-run.
4. Re-run the legacy conversation-path passes (PT-V2-08, PT-V2-09, PT-V2-13, EDGE-V2-11, EDGE-V2-13) to confirm no other regression in that cluster.

---

## Gap 2 — EDGE-V2-14 wifi-cycle harness blocked by auth-survives-offline

**Severity:** Medium. Blocks the dedicated wifi-cycle test for EDGE-V2-14 ("Network drop during sync of manual log"). The journey is currently **PARTIAL PASS** via implicit timing evidence from Phase-1 (some Phase-1 manual-vital saves had 4–5min sync lag, demonstrating WorkManager backoff/retry). The deliberate test still cannot run.

**Owner:** `android-app`.

**Where it lives in code:**
- Splash routing: `android/app/src/main/java/com/carelog/auth/AuthRepository.kt` (token-validation HTTP call on app launch).
- The Maestro harness already authored: `scripts/matika-bp-network-drop.sh` + `.maestro/flows/edge_v2_14_part1_navigate.yaml` + `.maestro/flows/edge_v2_14_part2_save_offline.yaml`. The orchestrator script has a `KNOWN BLOCKER` block at the top documenting this gap.

**Repro:**
```bash
source ~/.matika-test-creds.env
scripts/matika-bp-network-drop.sh
# Part 1 (wifi=ON): login + nav to BP — PASS
# adb svc wifi disable
# Part 2 (wifi=OFF): launchApp clearState:false → splash → AuthRepository
#   token validation fails (no network) → app routes to login screen instead
#   of resuming on BloodPressureScreen. Assert id=vital_tile_blood_pressure
#   fails because login is in foreground.
```

**Fix Path A:** In `AuthRepository`, when both (a) cached Cognito tokens are present in DataStore AND (b) network is unreachable AND (c) the build is debug, skip the remote token validation and treat the cached tokens as valid. Gate strictly on `BuildConfig.DEBUG` so prod can't ship the bypass. ~30 min change + 1 testcase.

**Fix Path B:** Make the splash routing "optimistic" in general: render the patient/caregiver home from cached tokens immediately, and only fall back to login on a 401 from a real API call. Removes the test-only branch but is a wider UX behavior change — needs product review.

**Verification after fix:**
1. `scripts/matika-bp-network-drop.sh` runs to completion: Part 1 PASS → wifi off → Part 2 reaches BP screen + save_acknowledgement PASS → wifi on → CloudWatch poller confirms `Stored observation` log line. Exit code 0.
2. Flip the EDGE-V2-14 row in `docs/journeys_non_voice.md` from PARTIAL to PASS, citing the script's exit-0 + CloudWatch line.

---

## Gap 3 — Missing testTags inventory (recorded for future authors)

These were added during the sweep and are noted here so any future
test author looking for them can find them without re-discovering. The
testTags now live in code (commits `eb60a55` + `3397cfc`).

| Surface | testTag(s) added | File |
|---|---|---|
| BloodPressureScreen inputs | `bp_systolic_input`, `bp_diastolic_input` | `android/app/src/main/java/com/carelog/ui/vitals/BloodPressureScreen.kt` |
| LargeNumericInput (shared) | parametric `testTagId` arg | `android/app/src/main/java/com/carelog/ui/vitals/VitalInputComponents.kt` |
| Glucose / Temperature / Weight / Pulse / SpO₂ inputs | `<vital>_value_input` | each respective `<Vital>Screen.kt` |
| ThresholdConfigScreen save button | `threshold_<param>_save` (per row) | `android/app/src/main/java/com/carelog/ui/relative/ThresholdConfigScreen.kt` |
| ThresholdConfigScreen success snackbar | `threshold_save_success` | same |
| TrendsScreen root | `trends_screen` | `android/app/src/main/java/com/carelog/ui/relative/TrendsScreen.kt` |
| TrendsScreen chart list | `trends_chart_list` | same |

**Gap (not a bug, but worth noting):** every new vital/config screen
should ship with testTags on its primary action button + primary
inputs from day one. Establish a convention so future screens don't
need a retro-fit pass.

---

## Gap 4 — Sync-delay observability (informational, not a bug)

During Phase-1 verification, the first CloudWatch poll for the
`sync-observation` lambda showed only 2 of 6 expected writes. A
later poll showed all 6 — sync lag of 4–8 minutes on some of them.
This is **expected WorkManager backoff** (not a bug), but it bit
the test-bench polling logic during the sweep.

**Lesson worth adding to `maestro_lessons.md` or a new `bench_lessons.md`:** when verifying offline-first saves via CloudWatch, wait at least 10 minutes after the last save before declaring "no sync happened" — the WorkManager backoff can stretch the first retry that far.

**Optional product follow-up:** expose the pending-sync count somewhere on the patient home screen (the codebase already has `getPendingObservationCount(): Flow<Int>` in `LocalFhirRepository`) so users can see when their saves are still queued. Out of scope for the fix sweep, but a good v2.1 polish.

---

## Gap 5 — F3 (existing): `create-patient` masks `UsernameExistsException` as generic 500

**Severity:** Low — only bites EDGE-V2-07 (re-registration with same email), which already has a PASS via different code path. Cosmetic-leaning but a real correctness issue (a 500 should never come back when the failure is a known client error).

**Owner:** `backend`.

**Where it lives in code:** `backend/lambdas/create-patient/index.js`. The Cognito SDK error class needs to be caught and mapped to HTTP 409 + an `EMAIL_ALREADY_EXISTS` error code in the response body.

**Fix:** Standard `catch (err) { if (err.name === 'UsernameExistsException') return { statusCode: 409, body: ... } }` pattern. ~15 min change. Re-deploy via `aws lambda update-function-code`.

**Verification:** invoke `create-patient` with an existing email; expect HTTP 409 + body `{"error":"EMAIL_ALREADY_EXISTS"}`.

---

## Out of scope for the fix sweep (documented; do NOT pick up)

These were surfaced earlier or have ownership outside `android-app` /
`backend` agents:

- **F16** (doctor-patients query references non-existent tables/columns) — dormant; mechanical fix once DR-V2-* unblocks (web-portal data-testid + Playwright runner work).
- **F17** (push transport infra not provisioned in dev) — `devops` ticket; needs FCM service-account JSON + SNS Platform App provisioning + `IOS/ANDROID_PLATFORM_ARN` env vars. ~1 day end-to-end.
- **F26 reminders** (CG-V2-13) — product call needed on whether manual reminder editing remains in v2 or becomes voice-only. v1 UX shape (windowHours+gracePeriodMinutes) doesn't map cleanly to v2 semantics (frequency_days+daily_deadline).
- **PT-V2-22** — design-blocked (no patient-side Care Team view).
- **PT-V2-14** — cost-prohibitive (~500-call rate-limit loop).
- **Terraform/cognito drift** — recommend resolving the `66ca57c` cognito SES drift before the next non-targeted `terraform apply`, but this is its own work stream (see `terraform_lambda_drift_pattern.md` memory).

---

## Suggested sequence for the fix sweep

1. **F27 Path A** first (highest unlock — restores the CI gate + 5+ legacy passes + opens EDGE-V2-03 + PT-V2-06 verification).
2. **EDGE-V2-14 Path A** second (small, surgical, gets one more journey to PASS).
3. **Re-verification batch** (rerun every conversation-path journey post-F27 + the EDGE-V2-14 orchestrator).
4. **F3** as a stretch goal if there's session budget left.

After the fix sweep, the non-voice PASS count should be 38–40 of 64.

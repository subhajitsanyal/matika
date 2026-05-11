# Post-F23 fix sweep — kickoff prompt

You are the orchestrator for a v2 product-fix sweep that picks up
the moment the post-F23 journey-testing sweep wrapped (commit
`7cfb2e1` on `origin/main`). The testing sweep landed 9 new
PASSes and surfaced one critical regression (F27) plus a handful
of smaller code/infra gaps. Your job is to drive the F27 fix
end-to-end, re-verify the journeys it unblocks, fix the smaller
gap that blocks EDGE-V2-14 dedicated coverage, and optionally
clean up the F3 cosmetic correctness issue if time permits.

Don't re-litigate decisions that are already in the gaps doc.
Read it, pick the smallest blast-radius fix path, ship the fix,
verify live, update status.

---

## Authoritative state — read in order

1. **`docs/post-f23-sweep-gaps.md`** — the canonical gap inventory written by the previous session. Lists Gap 1 (F27), Gap 2 (EDGE-V2-14 auth-survives-offline), Gap 3 (testTags inventory — informational), Gap 4 (sync-delay observability — informational), Gap 5 (F3 masking). Each has severity, owner, fix-path-A and fix-path-B sketches, verification path. **You should be able to implement everything in this sweep without reading anything else first.**
2. **`docs/testing_todos_v2.md`** — F-item entries are canonical (F27 + F19 + F25 + F22 + F26 + F4 etc). The F27 entry has the full fix-path-A code sketch.
3. **`docs/journeys_non_voice.md`** + **`docs/journeys_voice.md`** — catalogs. F27-blocked rows: PT-V2-07 (REGRESSED), EDGE-V2-03 (blocked by F27), PT-V2-06 (blocked by F27). Legacy passes presumed at-risk: PT-V2-08, 09, 13, EDGE-V2-11, 13.
4. MEMORY.md (auto-loaded) — the entries `maestro_lessons.md`, `voice_harness_lessons.md`, `terraform_lambda_drift_pattern.md`, `dev_rds_ssm_tunnel.md`, `jane_dev_test_account.md`, `v2_open_blockers_endofday_20260510.md`, and `feedback_verify_live_pattern.md` are bench knowledge. Don't re-discover the gotchas they document.
5. Recent commits `git log --oneline 78d975d..HEAD` — the F23 chain plus the three journey-sweep commits (`eb60a55`, `3397cfc`, `7cfb2e1`). Confirm `origin/main` is current.

## What just shipped (handoff context)

The prior session ran the post-F23 journey-testing sweep. 9 new
PASSes landed (PT-V2-15..21 + CG-V2-12 + CG-V2-17). One critical
regression surfaced: F27 (legacy v1 Mac Mini health check disables
the v2 conversation Button after `clearState`). The CI gate
(`patient_logging_happy_path`) FAILS today. Documented thoroughly
in `testing_todos_v2.md` F27 entry + `post-f23-sweep-gaps.md`.

Bench state worth remembering:
- Jane Doe (`CL-63NRGO`) parameter_configs were edited + restored
  during CG-V2-12 verification. Baseline: systolic min={90},
  max={160}; diastolic min={50}, max={95}. If a fresh dev DB reset
  happens, re-seed per `jane_dev_test_account.md`.
- 7 vital flows authored in `.maestro/flows/patient_manual_log_*.yaml`
  + `patient_vital_history_grid.yaml`. Use them as templates for
  any new vital-screen flows.
- `caregiver_threshold_edit.yaml` + `caregiver_trends_view.yaml`
  newly authored. Both green.
- `scripts/matika-bp-network-drop.sh` + `edge_v2_14_part{1,2}_*.yaml`
  authored but blocked at part 2 by the EDGE-V2-14 gap. The
  orchestrator script has a `KNOWN BLOCKER` header documenting it.

## Goal of this sweep

Restore the CI gate + unblock the 5+ conversation-path journeys
that F27 currently breaks. Land EDGE-V2-14 as a full PASS by
unblocking the wifi-cycle harness. Optionally clean up F3.

**Targets:**
- v2 non-voice PASS count from **32 of 64** to **≥ 38 of 64**.
- CI gate (`patient_logging_happy_path`) back to PASS.
- F27 entry in `testing_todos_v2.md` flipped to RESOLVED.
- EDGE-V2-14 row in `journeys_non_voice.md` flipped from PARTIAL to PASS.

**In scope this sweep:**

| ID | What | Driver | Path |
|---|---|---|---|
| **F27** | Drop legacy v1 Mac Mini health gate on patient conversation Button | `android-app` | Path A per gaps Gap 1: edit `ModelStatusBanner.computeDegradationState` OFFLINE branch |
| **CI gate re-run** | `patient_logging_happy_path` flips to PASS | `qa-testing` | Re-run via Maestro |
| **EDGE-V2-03** | Re-run `patient_guardrail_block_text.yaml` | `qa-testing` | Re-verifies F19 (parser fix) at the same time |
| **PT-V2-06** | Re-run `patient_voice_bp_bn_single_turn` post-F25 | `qa-testing` | Voice harness — `MATIKA_BN_AUDIO=<aiff>` required |
| **PT-V2-07/08/09/13, EDGE-V2-11/13** | Re-run legacy conversation-path passes | `qa-testing` | Confirm no other regression in the cluster |
| **EDGE-V2-14 auth-survives-offline** | Skip token-validation on offline-debug build | `android-app` | Path A per gaps Gap 2: `BuildConfig.DEBUG`-gated branch in `AuthRepository` |
| **EDGE-V2-14 dedicated test** | `scripts/matika-bp-network-drop.sh` runs to exit 0 | `qa-testing` | Verify CloudWatch picks up the post-recovery sync |

**Stretch goal (only if time):** Gap 5 — fix F3 (`create-patient` masks `UsernameExistsException` as 500). ~15 min change + 1 invoke to verify.

**Out of scope this sweep:**
- F16, F17, F26 reminders, PT-V2-22, PT-V2-14, terraform/cognito drift — all surfaced in `post-f23-sweep-gaps.md` "Out of scope" section. Don't pick them up.
- Web portal data-testid plumbing + Playwright runner — separate stream.
- The 7 PT-V2-15..21 manual-vital + CG-V2-12 + CG-V2-17 flows shipped last sweep — re-run only if you want cheap insurance that the F27 fix didn't break the home-screen vitals-tile grid.

## Pre-flight (run once at session start)

```bash
# Bench
killall say 2>/dev/null
adb devices                      # expect RFCT10C1GSZ device
adb shell am force-stop com.carelog
adb logcat -c

# Confirm credentials + Maestro on PATH
source ~/.matika-test-creds.env
[[ -n "$MATIKA_CAREGIVER_EMAIL" && -n "$MATIKA_PATIENT_EMAIL" ]] && echo "creds ok"
export PATH="$HOME/.maestro/bin:$PATH"
maestro --version | head -1

# Audio (for PT-V2-06 voice re-run later)
afplay -t 1 /System/Library/Sounds/Pop.aiff   # if hangs → sudo killall -9 coreaudiod

# RDS access only if you need it for a fix-verification (F27 doesn't,
# EDGE-V2-14 doesn't directly). Most of this sweep is Android-only.
# If needed, the tunnel one-liner is in the dev_rds_ssm_tunnel memory.

# Confirm the F27 regression is still live before fixing it
scripts/maestro-run.sh patient_logging_happy_path
# Expected: FAIL at matika_text_fallback assertion. If it passes, the
# bench state has changed since the journey sweep — investigate before
# spending time on the F27 fix.
```

## Per-fix workflow (the recipe)

For each in-scope fix, execute these steps in order. Don't skip the
live-verification step — `feedback_verify_live_pattern.md` is
non-negotiable.

1. **Read the fix sketch.** Open `docs/post-f23-sweep-gaps.md`, find the gap, read Path A. The sketch is in the doc — don't re-derive.
2. **Implement the smallest possible change.** F27 Path A is ~5 lines in one method. EDGE-V2-14 Path A is ~10 lines in `AuthRepository`. F3 is one `catch` clause. Don't refactor or expand scope.
3. **Rebuild + reinstall.**
   ```bash
   (cd android && ./gradlew :app:assembleDebug 2>&1 | tail -3)
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```
4. **Re-run the regression-detector flow first.** For F27, that's `patient_logging_happy_path`. It must flip from FAIL to PASS. If it still fails, your fix is wrong — diagnose with `adb shell uiautomator dump` + `adb logcat`.
5. **Re-run the unblocked in-scope flows.** Sequential discipline — dev RDS + device are shared singletons; never parallelize Maestro runs.
6. **Verify live evidence** per `feedback_verify_live_pattern.md`. For conversation-path passes: the `interaction_sessions` row in dev RDS with the new session id, OR the bedrock-router CloudWatch log line, OR the response-card mount with the correct copy. For EDGE-V2-14: the `Stored observation` line in `/aws/lambda/carelog-dev-sync-observation` after wifi recovery.
7. **Update status rows.** Flip F27 in `testing_todos_v2.md` to **RESOLVED — verified live YYYY-MM-DD**. Flip PT-V2-07 (CI gate) + EDGE-V2-03 + PT-V2-06 + the legacy conversation passes to **PASS (YYYY-MM-DD)** in the journey docs. Flip EDGE-V2-14 from PARTIAL to PASS.
8. **Commit per fix-cluster.** F27 fix + re-verifications can batch-commit as `F27: drop v1 Mac Mini health gate — CI gate + 5 journeys PASS`. EDGE-V2-14 fix + dedicated harness PASS as `EDGE-V2-14: auth-survives-offline debug bypass — wifi-cycle harness PASS`. Body always includes live evidence (RDS row snippet, CloudWatch line, or screenshot of the Maestro PASS).

## Phased agent orchestration

Drive everything serially because dev RDS + the test device are
shared singletons. Within each phase, the agents listed are
appropriate to delegate to.

### Phase 0 — confirm F27 still bites (one Bash run, ~2 min)

Run `scripts/maestro-run.sh patient_logging_happy_path`. Expected:
FAIL at the matika_text_fallback assertion. If PASS, bench state
changed — investigate via mDNS / `appSettings.macMiniBaseUrl`
inspection. Don't proceed with the F27 fix until you've confirmed
the gap is present.

### Phase 1 — implement F27 Path A + re-verify (the big phase)

The fix is in `android/app/src/main/java/com/carelog/dashboard/ui/ModelStatusBanner.kt`. Exact code sketch is in `post-f23-sweep-gaps.md` Gap 1. Implementation:

1. Edit `computeDegradationState` so the `OverallStatus.OFFLINE` branch returns `canConverse = true, severity = NONE, message = null`.
2. Rebuild + install.
3. Re-run `patient_logging_happy_path` — expect PASS.
4. Run `patient_guardrail_block_text` — expect PASS (this also re-verifies F19 from 2026-05-10).
5. Run the legacy conversation-path passes (`patient_implausible_text`, `patient_emergency_text`, `patient_pause_resume_text`, `patient_implausible_glucose_text`, `matika-connectivity-test.sh`) — expect PASS or a NEW F-item if something else regressed.

Live evidence to capture in the commit body:
- One Maestro PASS screenshot URL.
- One bedrock-router CloudWatch log line per session (matikaformatted: `interaction_session=<uuid>` + `t2_latency_ms=<n>` etc).
- For the connectivity-test flow, all 3 parts must PASS.

Batch commit: `F27: drop legacy v1 Mac Mini health gate on patient conversation Button`.

### Phase 2 — PT-V2-06 Bengali voice re-run (post-F27 + post-F25)

Pre-condition: `MATIKA_BN_AUDIO=<path-to-staged-aiff>` exported. The Bengali audio file lives on the test bench somewhere — check `~/voice-test-recordings/` or similar; the prior F25 session staged one. If absent, generate one via `gTTS` per `voice_harness_lessons.md`.

```bash
killall say 2>/dev/null
afplay -t 1 /System/Library/Sounds/Pop.aiff
export MATIKA_BN_AUDIO=<path>
scripts/matika-voice-run.sh patient_voice_bp_bn_single_turn \
  --turn "bn|160|${MATIKA_BN_AUDIO}|800"
```

Expected: `stt_offline_used=false` in logcat, `matika_response_card` mounts with Bengali text, RDS `interaction_sessions.language='bn-IN'`. Flip PT-V2-06 to PASS.

Commit: `journey: PT-V2-06 Bengali voice PASS post-F27+F25`.

### Phase 3 — EDGE-V2-14 auth-survives-offline + dedicated test

The fix is in `android/app/src/main/java/com/carelog/auth/AuthRepository.kt` (or wherever splash routing happens — read the file first to confirm the right injection point). Sketch in `post-f23-sweep-gaps.md` Gap 2.

Implementation:
1. Find the token-validation HTTP call in the splash flow.
2. Wrap it: if `BuildConfig.DEBUG && !networkMonitor.isConnected() && hasCachedTokens()`, skip validation and trust the cache.
3. Rebuild + install.
4. Run `scripts/matika-bp-network-drop.sh` — expect exit 0. The script polls CloudWatch and self-asserts.

Commit: `EDGE-V2-14: debug-build offline auth bypass + wifi-cycle harness PASS`.

### Phase 4 — F3 (stretch, optional)

`backend/lambdas/create-patient/index.js`. Catch `UsernameExistsException`, return 409. Deploy via `aws lambda update-function-code` per `terraform_lambda_drift_pattern.md` (do NOT `terraform apply` — there's drift). Re-run `caregiver_protocol_setup` against a pre-existing email to verify the 409.

Commit: `F3: create-patient returns 409 on UsernameExistsException`.

### Phase 5 — wrap-up

1. Re-run `patient_logging_happy_path` one last time (the CI gate).
2. Update `docs/testing_todos_v2.md` — F27 RESOLVED, F3 RESOLVED (if shipped), date header bumped.
3. Update the `v2_open_blockers_endofday_20260510.md` memory file → rename to `_endofday_<YYYY-MM-DD>.md` and rewrite the body (new PASS count, F27 removed from the open-list, EDGE-V2-14 moved to RESOLVED).
4. Single `wrap-up` commit.
5. `git push origin main`.

## Agent orchestration rules

- **Plan agent** — use for the F27 fix only if you want a second pair of eyes on Path A vs Path B trade-off. The gaps doc already recommends Path A; skip Plan unless something surprises you in `ModelStatusBanner.kt`.
- **Explore agent** — use sparingly. The state is well-mapped already. Reach for direct Read for `AuthRepository.kt`, `ModelStatusBanner.kt`, and the splash-routing call site.
- **general-purpose** — reserve for cross-codebase regression hunts if Phase 1 unearths something unexpected (e.g., a journey that used to PASS suddenly fails for an unrelated reason).
- **No parallel Agent calls in this sweep.** Same singleton reason as the prior sweep.

## Memory + commit hygiene

- New bench gotchas → append to `maestro_lessons.md` or `voice_harness_lessons.md` as a numbered lesson. Use the same voice the existing lessons use (concrete repro, why it bit, fix pattern).
- New F-items go in `docs/testing_todos_v2.md` with the standard header shape.
- Commit messages: `F<n>: <one-liner>` for fix commits, `journey: <ID> — <one-liner>` for re-verification PASSes. Body should always include live-evidence snippet.
- Don't commit `~/.maestro/tests/` debug artifacts, package-locks, `.docx` files, or anything in the pre-existing untracked set from `git status` at session start.

## Stopping criteria

End the session when ANY of these hits:
- F27 RESOLVED + EDGE-V2-14 PASS + CI gate green + ≥ 5 legacy conversation-path passes re-verified, OR
- F27 fix attempt hits a wall (e.g., Path A breaks something else; need to fall back to Path B which is a larger change) — write up a new F-item and stop, OR
- 3 consecutive infra issues unrelated to the fix (bench/Maestro/RDS) — surface what's broken and stop.

## What success looks like

End of session: `git log --oneline 7cfb2e1..HEAD` shows F27 + 1–2 re-verification commits + EDGE-V2-14 fix commit + wrap-up. `docs/testing_todos_v2.md` shows F27 RESOLVED. `docs/journeys_non_voice.md` shows ≥ 6 new PASS rows (CI gate + EDGE-V2-03 + PT-V2-06 + 3 legacy passes) and EDGE-V2-14 PASS. Memory has the renamed blockers file + 0–2 new lessons. `origin/main` is current.

If F27 Path A turns out wrong and Path B is the correct call — that's also a valid outcome. Write up the finding in a new F-item or extend F27 with the Path B sketch, ship Path B if it fits the session budget, otherwise stop early and surface for the next session.

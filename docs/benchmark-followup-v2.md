# Benchmark follow-up — v2 voice & multi-turn sweep

**Author:** Subhajit + Claude (session ending 2026-05-24 22:00 IST)
**Last commit:** `9995680` — Voice multi-turn sweep round 2 — LV-V2-01/03/04/05/17 voice flows + F59 finding
**Scope:** resume point for the next bench session. Captures (1) where the multi-turn voice catalog stands, (2) open findings that need code fixes, (3) parked journeys + what's needed to unblock each, (4) suggested first action.

---

## State at session start

1. `git pull origin main`. HEAD should be `9995680` or newer.
2. **Bench check** (only if running voice flows):
   ```bash
   adb devices                              # expect: RFCT10C1GSZ (Samsung S21+) attached
   curl -s http://10.0.0.171:8765/health    # expect: {"ok": true, "voices": [...], "gtts_langs": ["bn"]}
   scripts/matika-voice-preflight.sh        # exit 0 = ready
   ```
   - TTS server is on the second Mac (per F41). If unreachable, voice runs cannot proceed — restart `scripts/matika-tts-server.py` on that Mac first.
   - Samsung S21+ is the canonical test device. ADB serial `RFCT10C1GSZ`.
3. **Memory pointers to reload:**
   - `[[v2_open_blockers_endofday_20260517]]` — last blocker snapshot (now stale; superseded by this doc for voice work).
   - `[[voice_harness_lessons]]` — 9 entries; remote-TTS workaround is the key one.
   - `[[maestro_lessons]]` — 15 entries; #14 (visible-then-invisible pattern) + #15 (`-e` matches message not tag) are most relevant for new flow authoring.
   - `[[feedback_verify_live_pattern]]` — RDS + CloudWatch evidence required for any fix claim.

---

## Voice multi-turn journey status

Authoritative catalog: `docs/voice_multi_turn_journeys.md`. Summary as of `9995680`:

| Journey | Status | Notes |
|---|---|---|
| LV-V2-01 voice | PASS 2026-05-24 | 3-turn EN happy-path |
| LV-V2-02 voice | PASS (3-turn subset) 2026-05-24 | Full 6-vital extension still TODO |
| LV-V2-03 Hindi voice | PASS 2026-05-24 | First-ever Hindi multi-vital E2E |
| LV-V2-04 Bengali voice | PASS 2026-05-24 | gTTS path, F41 sidestepped |
| LV-V2-05 voice | PASS + **F59** finding | AI cross-maps off-protocol number onto configured vital |
| LV-V2-06 voice | PASS 2026-05-24 | Off-topic redirect |
| LV-V2-07 voice | FAIL → **F58** finding | One-line state_machine.ts fix needed |
| LV-V2-08 text | unrun | Text-only; pause/resume mid-session |
| LV-V2-09 | characterized (F56) | No flow needed |
| LV-V2-10/11/12/13 | PARKED — gate | Fresh caregiver creds needed |
| LV-V2-14 voice | PASS 2026-05-24 | Threshold edges |
| LV-V2-15 voice | PARKED — harness | adb wifi-toggle wrapper needed |
| LV-V2-16 text | unrun | Text + chaos header |
| LV-V2-17 voice | PASS 2026-05-24 | Guardrail mid-chain |
| LV-V2-18 voice | PARKED — manual setup | Bengali STT pack uninstall pre-step |

---

## Open findings (need code fixes)

### F58 — PLAUSIBILITY_CHALLENGE → PENDING_CONFIRMATION blocked by state machine
**Severity:** Medium · **Effort:** trivial (one line) · **Owner:** founder

- File: `backend/lambdas/bedrock-router/src/state_machine.ts`
- Fix: add `PENDING_CONFIRMATION` to `ALLOWED_TRANSITIONS.PLAUSIBILITY_CHALLENGE` (currently `Set(['EXTRACTING', 'EMERGENCY', 'PAUSED', 'TERMINAL'])`). Symmetric to GREETING → PENDING_CONFIRMATION which is already allowed.
- Verify: re-run `lv_v2_07_implausibility_midchain_voice` after lambda redeploy; T3 should succeed.
- Open question (from F58 entry): audit other `_CHALLENGE`-class states for matching missing edges.

Full details: `docs/testing_todos_v2.md` F58.

### F59 — patient_logging cross-maps off-protocol numeric onto configured vital
**Severity:** Medium / clinical safety · **Effort:** prompt change · **Owner:** founder

- Discovered in `lv_v2_05_off_protocol_reading_voice` 2026-05-24 21:40Z. After patient mentioned cholesterol 220, vitamin D 18, blood urea 32 (all NOT in Jane's `parameter_configs`), AI offered "two twenty" back as a `blood_glucose` PENDING_CONFIRMATION on turn 4.
- Recommended fix: add a stage to the patient-logging system prompt forbidding cross-parameter inference when patient names an unconfigured parameter. See F59 entry for the exact wording.
- File: prompts under `backend/lambdas/bedrock-router/prompts/` (deploy via `lambda_deploy_prompts_dir` memory note — zip MUST include `prompts/` or cold-start fires ENOENT).
- Verify: re-run `lv_v2_05_off_protocol_reading_voice` post-fix; AI must not pre-populate a PENDING_CONFIRMATION for a configured vital when patient named only off-protocol values. Also: re-run `lv_v2_05_off_protocol_reading_text` with response-text inspection to confirm the bug exists on text-fallback path too.

Full details: `docs/testing_todos_v2.md` F59.

### F57 — patient-logging prompt-level refinement (not the handler guard)
**Status:** handler guard already shipped (commit `66064d9`). The LLM prompt itself still tries to close prematurely; the guard catches it. Prompt-level fix would obsolete the guard but is lower-priority since the guard works.

---

## Parked journeys — what unblocks each

### LV-V2-10 / 11 / 12 / 13 — caregiver-onboarding voice flows
**Blocker:** one-caregiver-one-patient FAB gate. John CG (only caregiver creds locally) is already linked to Jane — the Add-Patient FAB path errors out.

**Unblock options:**
1. **Create a fresh caregiver Cognito account** via the register flow (manual: registration → MFA email confirm → save creds to `~/.matika-test-creds.env` as `MATIKA_CAREGIVER2_EMAIL/_PASSWORD`). Then update the four flows to accept `MATIKA_CAREGIVER2_*` env vars. ~30 min including Cognito MFA.
2. **Revisit the gate.** If it's purely UI-side (FAB hidden when caregiver already has a patient), a debug-build override could allow adding a second patient. If it's enforced server-side in `create-patient` lambda, it needs a relaxation flag.
3. **Bypass via direct lambda invoke + Cognito group injection.** Hackier; would only unblock for testing not for real CG-V2 coverage.

Recommended: option 1 for the next bench session.

### LV-V2-15 — network drop mid-voice-session
**Blocker:** `matika-voice-run.sh` runs maestro + logcat-trigger orchestration linearly; injecting `adb shell svc wifi disable` between turns requires either:
1. A wrapper script (`scripts/matika-voice-network-drop.sh`) that splits the journey into 2 maestro runs around an `adb shell svc wifi disable/enable` boundary — pattern lives in `scripts/matika-bp-network-drop.sh` (manual-log path).
2. A new `--wifi-action` turn-spec field in `matika-voice-run.sh` that toggles wifi between turns. Cleaner but invasive.

**Effort:** ~1 hour (wrapper script approach).

### LV-V2-18 — STT pack missing mid-chain
**Blocker:** Bengali Soda offline pack is currently installed on the test S21+. To verify F25 online-fallback fires *mid-conversation* (vs only at session start, already covered by PT-V2-06), we need the pack uninstalled.

**Unblock options:**
1. Manual: Settings → General Management → Language → Speech → uninstall bn-IN.
2. `adb shell pm clear com.google.android.tts` (clears all packs; collateral wipe of en/hi).

Recommended: option 1, with operator pre-step before running the flow.

---

## TODO (not parked, just unrun)

- **LV-V2-02 full 6-vital chain.** Currently exercises the 3-turn subset (BP → confirm → glucose) that proves F57 guard walks. Jane has all 7 vitals seeded on staging, so the full chain (BP → confirm → glucose → weight → temp → heart_rate → spo2) is straightforward — duplicate the LV-V2-02 voice flow with 14+ turn specs.
- **LV-V2-08 text** (pause/resume) — text-only, no voice harness needed.
- **LV-V2-16 text + chaos** (backend 500 mid-session) — uses `x-test-chaos: malformed_json` header per F19. Need to confirm chaos header is still wired in `bedrock-router` (last verified during EDGE-V2-09).

---

## Useful commands (copy-paste)

### Voice flow run
```bash
source ~/.matika-test-creds.env
export MATIKA_SAY_REMOTE_URL=http://10.0.0.171:8765
scripts/matika-voice-run.sh <flow_name> --no-install \
    --turn "en|175|<utterance>|600" \
    --turn "en|175|<utterance>|400"
```

### Language switch (helper flow)
```bash
scripts/maestro-run.sh --no-install _bench_set_language_hi    # or _bn
# Then run the voice flow with --turn entries using hi or bn lang/rate.
```

### Staging RDS query (libpq tunnel)
See `[[dev_rds_ssm_tunnel]]` memory — but for staging use:
- bastion `i-0f2acdf1a96ee24a6`
- local port `55433`
- secret `carelog-staging-db-password`
- host `carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com`
- db `carelog_staging`, user `carelog_staging_admin`
- psql: `/opt/homebrew/opt/libpq/bin/psql`

### CloudWatch tail (staging lambdas)
```bash
aws logs tail /aws/lambda/matika-staging-bedrock-router --since 10m --region ap-south-1 --follow
```

### Quick screenshot to /tmp
```bash
adb shell screencap -p > /tmp/state_$(date +%s).png
```

---

## Suggested first action for next session

**Order of leverage (highest first):**

1. **Ship F58.** One-line `state_machine.ts` fix + redeploy bedrock-router + re-run `lv_v2_07_implausibility_midchain_voice`. Should take <30 min including verify. Unblocks the natural implausibility-recovery UX.
2. **Ship F59.** Prompt-level guard against cross-parameter inference. Higher clinical-safety severity but also higher fix complexity (needs prompt iteration + judgment on regression risk for normal flows). Re-verify with both LV-V2-05 voice + text.
3. **Create fresh caregiver creds + run LV-V2-10/11/12/13.** Unblocks the entire caregiver-side multi-turn surface. ~2 hours including Cognito setup + 4 journey runs.
4. **Extend LV-V2-02 to full 6-vital chain.** Validates F57 guard at full depth + LLM context retention across many turns. ~45 min.

The remaining (LV-V2-08 text, LV-V2-15 harness, LV-V2-16 chaos, LV-V2-18 STT-pack) can be deferred until #1–#4 are clear.

---

*Cross-references: `docs/voice_multi_turn_journeys.md` (catalog), `docs/testing_todos_v2.md` F56/F57/F58/F59 (findings), `docs/journeys_voice.md` (single-vital basic flows), `docs/v2_launch_plan.md` §13 (Phase 2 doctor deferral).*

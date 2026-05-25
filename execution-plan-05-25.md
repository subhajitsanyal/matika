# Execution Plan — 2026-05-25 bench follow-up

**Source:** `docs/benchmark-followup-v2.md` (resume point after commit `9995680`).
**Author:** Claude (planner) + Subhajit (operator + bench).
**Scope:** ship F58 + F59 fixes, extend LV-V2-02 to full protocol, prep parked YAMLs, plan caregiver-creds wave.

---

## Leverage map — what unblocks the most

| Big-ticket item | Direct unblock | Cost | Order |
|---|---|---|---|
| **Bundle F58 + F59 in one bedrock-router redeploy** | LV-V2-07 voice rerun + LV-V2-05 voice/text rerun + restores natural implausibility-recovery UX + closes clinical-safety cross-map | 1 deploy cycle | **1st** |
| **Fresh caregiver Cognito account** | LV-V2-10 / 11 / 12 / 13 (4 caregiver-side multi-turn journeys) | ~30 min MFA + creds save | **2nd (operator)** |
| **LV-V2-02 full 6-vital flow** | Proves F57 guard at full protocol depth + validates LLM context retention | ~45 min YAML | **3rd** |
| Wifi-drop wrapper `matika-voice-network-drop.sh` | LV-V2-15 | ~1 hr | 4th (deferrable) |
| STT-pack pre-step doc | LV-V2-18 | 5 min operator note | 5th (deferrable) |

**Big insight:** F58 + F59 both touch the same lambda (`bedrock-router`). Packaging them into **one** zip + **one** `aws lambda update-function-code` saves a full deploy/verify loop and shares the live bench cycle. They are textually independent (different files, no merge conflict).

**Trivia closed during planning:** F58's open question — "audit other `_CHALLENGE`-class states" — already answered. `state_machine.ts` has exactly one `_CHALLENGE` state (PLAUSIBILITY_CHALLENGE). No siblings. Closing that sub-task without further work.

---

## Phase layout

### Wave 1 — Parallel code/prompt/YAML drafting (no bench needed)

All four agents run concurrently. None depend on each other.

#### Agent A — Ship F58 state-machine fix
- **File:** `backend/lambdas/bedrock-router/src/state_machine.ts:77`
- **Change:** add `'PENDING_CONFIRMATION'` to the `PLAUSIBILITY_CHALLENGE` allowed set.
  - Before: `new Set(['EXTRACTING', 'EMERGENCY', 'PAUSED', 'TERMINAL'])`
  - After:  `new Set(['EXTRACTING', 'PENDING_CONFIRMATION', 'EMERGENCY', 'PAUSED', 'TERMINAL'])`
- **Tests:** add a unit test to `backend/lambdas/bedrock-router/src/state_machine.test.ts` (or wherever the existing FSM tests live) asserting `isAllowedTransition('PLAUSIBILITY_CHALLENGE','PENDING_CONFIRMATION') === true`. Confirm existing tests still pass with `npm test` in `backend/lambdas/bedrock-router/`.
- **Build:** `npm run build` to refresh `dist/`.
- **No deploy yet** — wait for Wave 2 to bundle with F59.
- **Reference:** F58 entry in `docs/testing_todos_v2.md:538`.

#### Agent B — Draft F59 prompt guard
- **File:** `backend/lambdas/bedrock-router/prompts/system_v2.md`
- **Change:** insert a new conversation rule between current rule 8 (soft-out-of-range) and rule 9 (symptom not in parameter list). Parallel structure to rule 9 but for **numeric** off-protocol mentions. Suggested wording (refine in agent prompt):

  > **9. If the patient mentions a numeric value for a parameter NOT in `## Active monitoring protocol`** (e.g., cholesterol, vitamin D, blood urea), acknowledge the reading warmly and note it as not currently tracked. **Do NOT map the number to any other configured parameter.** Suggest the caregiver can add tracking for it later. Then continue with the next active parameter from the protocol. Never use a number the patient supplied for parameter X to pre-populate a PENDING_CONFIRMATION for parameter Y.

- Renumber subsequent rules (current 9 → 10, 10 → 11, etc.) and update the rule-12 references (the worked example explicitly cites "rule 12"). Verify no other prompt file references "rule N" by number.
- Re-emit the worked example unchanged — it still applies after renumber.
- **No build step required** — prompts are loaded from disk via `readFileSync`, so the bundle just needs to include `prompts/` in the zip (see Wave 2 packaging note).
- **Reference:** F59 entry in `docs/testing_todos_v2.md:512`.

#### Agent C — Extend LV-V2-02 to full 6-vital chain
- **Source:** `.maestro/flows/lv_v2_02_multi_vital_chain_voice.yaml` (3-turn subset: BP → confirm → glucose).
- **Target:** new flow `.maestro/flows/lv_v2_02_multi_vital_chain_voice_full.yaml` with 14 turn specs walking the full protocol: BP → confirm → glucose → confirm → weight → confirm → temp → confirm → heart_rate → confirm → spo2 → confirm → "that's all for today" → session-close assert.
- **Voice harness pattern:** copy the existing flow's `runScript`/turn-spec scaffolding verbatim. Use English Rishi voice (`en|175`).
- **Asserts:** `SessionCompleteCard` visible at end; `turn_counter >= 13`.
- **Do NOT run** in this wave — defer to Wave 3 bench. Author + lint only.
- **Reference:** kickoff §"TODO" item 1.

#### Agent D — Author parked Maestro YAMLs (caregiver side)
Discovery during planning: `lv_v2_10/11/12_*.yaml` referenced in the multi-turn catalog **do not exist on disk** (only `lv_v2_13_onboarding_off_topic_text.yaml` does). This wave authors the skeletons so the caregiver-creds wave (Wave 4) can run without YAML work in the loop.

- Author the four files using `lv_v2_13_onboarding_off_topic_text.yaml` and existing `caregiver_protocol_*.yaml` flows as templates:
  - `lv_v2_10_long_protocol_config_text.yaml` + `_voice.yaml` (15-turn extension of CG-V2-03)
  - `lv_v2_11_protocol_config_hi_voice.yaml` (Hindi protocol-config voice)
  - `lv_v2_12_multi_patient_sequence_text.yaml` (3 patients in sequence)
- **Env vars:** all four flows must read `MATIKA_CAREGIVER2_EMAIL` / `MATIKA_CAREGIVER2_PASSWORD` (not `MATIKA_CAREGIVER_*`) so John CG creds aren't consumed.
- **Bonus** (time permitting): author `lv_v2_08_pause_resume_text.yaml` (kickoff §"TODO" item 2) and `lv_v2_16_backend_500_midsession_text.yaml` (kickoff §"TODO" item 3). The `x-test-chaos: malformed_json` header for #16 — confirm `backend/lambdas/bedrock-router/src/bedrock_chaos.ts` still wires it (last verified EDGE-V2-09).
- **Lint only** — don't run.

### Wave 2 — Single bundled deploy + live bench verify (operator-in-loop)

Sequential because each step depends on the previous.

1. **Package zip** with both F58 (dist) + F59 (prompts) per `[[lambda_deploy_prompts_dir]]` memory:
   ```
   cd backend/lambdas/bedrock-router
   zip -rq /tmp/bedrock-router.zip dist node_modules prompts package.json output_schema.json
   ```
2. **Deploy to staging:**
   ```
   aws lambda update-function-code \
     --function-name carelog-staging-bedrock-router \
     --zip-file fileb:///tmp/bedrock-router.zip \
     --region ap-south-1
   ```
3. **Smoke check** — `aws lambda invoke` with a trivial patient-logging start payload; expect 200 + no ENOENT in CloudWatch.
4. **Rerun `lv_v2_07_implausibility_midchain_voice`** against staging Jane PT. Expected: T3 succeeds (no `StateTransitionError`). Capture: session UUID, CloudWatch request id, RDS row state for the recovered BP commit.
5. **Rerun `lv_v2_05_off_protocol_reading_voice`**. Expected: on turn 4 the AI does NOT pre-populate a PENDING_CONFIRMATION for any configured vital using the off-protocol numbers (cholesterol/vit-D/urea). Inspect raw `responseText` from CloudWatch — not just the SessionCompleteCard surface.
6. **Rerun `lv_v2_05_off_protocol_reading_text`** to confirm F59 also fires on the text-fallback path (kickoff F59 "Open question").
7. **Update findings:** mark F58 + F59 RESOLVED in `docs/testing_todos_v2.md` with session UUID + CloudWatch request id + timestamp evidence per `[[feedback_verify_live_pattern]]`.
8. **Update voice catalog:** `docs/voice_multi_turn_journeys.md` LV-V2-07 row → PASS; LV-V2-05 row → re-PASS notes.
9. **Commit** with message naming both fixes + the verified session UUIDs.

### Wave 3 — Run extended LV-V2-02 (operator-in-loop, post-deploy)

Depends on Wave 2 lambda being live (so post-F57-guard + post-F59 prompt behavior is what's tested).

- Run `lv_v2_02_multi_vital_chain_voice_full` (the new Agent C flow) against staging Jane PT. Expected: all 7 vitals committed in one session, F57 guard walks through, `complete_session` fires only after spo2 confirm or explicit "that's all".
- Capture session UUID + parameter rows from `observations` for all 7 vitals.
- Update `docs/voice_multi_turn_journeys.md` LV-V2-02 row from "3-turn subset PASS" → "full 7-vital PASS".

### Wave 4 — Fresh caregiver creds + caregiver-side parked journeys (operator)

Operator action — **not delegated to an agent**, since it requires Cognito MFA email handling and credential storage in `~/.matika-test-creds.env`.

1. Manual register flow (web portal or Android): new email, complete MFA email confirm, retrieve sub.
2. Save creds:
   ```
   export MATIKA_CAREGIVER2_EMAIL=...
   export MATIKA_CAREGIVER2_PASSWORD=...
   ```
   in `~/.matika-test-creds.env`.
3. Run in order: LV-V2-10 voice → LV-V2-11 voice → LV-V2-12 text → LV-V2-13 text (the existing one). Each ~20 min including evidence capture.
4. Update `docs/voice_multi_turn_journeys.md` rows for each.

### Wave 5 — Deferred harness work (only if bandwidth)

- **LV-V2-15** — author `scripts/matika-voice-network-drop.sh` modeled on `scripts/matika-bp-network-drop.sh`. Splits a voice journey across an `adb shell svc wifi disable` boundary. ~1 hour.
- **LV-V2-18** — document the manual Soda bn-IN uninstall pre-step in the flow header. No code work. ~5 min.

---

## Verification protocol (per `[[feedback_verify_live_pattern]]`)

Every fix declared "done" in Wave 2 must include:
- Staging RDS row inspection via SSM tunnel (libpq at `/opt/homebrew/opt/libpq/bin/psql`).
- CloudWatch log line for the affected lambda turn (`aws logs tail /aws/lambda/matika-staging-bedrock-router --since 10m --region ap-south-1`).
- Session UUID + CloudWatch request id quoted into the F-entry RESOLVED block.
- Same evidence pasted into the journey row in `docs/voice_multi_turn_journeys.md`.

A test rig PASS (`Maestro exit 0`) is **not** acceptance — the bug surface for F59 specifically is in AI semantic output and slipped past F59's original harness asserts.

---

## Deferred / explicitly out-of-scope this session

- **F57 prompt-level fix.** The 2026-05-24 handler guard (commit `66064d9`) still does its job; prompt-level fix is lower priority. Don't open during this session.
- **F41 structural fix** (Mac mini Core Audio HAL). Remote-TTS workaround remains the canonical answer per `[[voice_harness_lessons]]` lesson 7.
- **F40** (text-fallback never POSTs). Not exercised by any wave above; leave open.
- **Cognito drift detector** (F-class TBD per `[[v2_open_blockers_endofday_20260517]]` Stream A T4). Pre-prod-cutover wire-target.

---

## Agent assignments (Wave 1 — to dispatch in parallel)

| Agent | Type | Scope |
|---|---|---|
| A | `general-purpose` | F58 state_machine.ts edit + unit test + `npm run build` |
| B | `general-purpose` | F59 prompt edit in `system_v2.md` (renumber + insertion) |
| C | `general-purpose` | Author `lv_v2_02_multi_vital_chain_voice_full.yaml` (no run) |
| D | `general-purpose` | Author LV-V2-10/11/12 YAMLs + bonus 08/16 (no run) |

Wave 2 onward is operator-in-loop with me orchestrating — not delegated.

---

## Risk notes

- **F59 prompt iteration risk.** Renumbering rules + inserting a new rule could regress unrelated flows. The verification matrix above (re-run LV-V2-05 voice + text) is necessary but not sufficient. After Wave 2, sample-run one happy-path single-vital flow (PT-V2-03 BP English) to confirm no regression. If anything misbehaves, narrow the prompt edit to a single-sentence appendix on the **existing** rule 9 instead of inserting a new rule + renumbering.
- **Bundled deploy rollback.** If F58 unit-test fails post-Wave-1 OR if F59 introduces regression, deploy F58 alone (revert F59 in the zip's `prompts/` dir, keep the F58 `dist/` change). The lambda-update-function-code path is atomic per zip; we don't need staged rollouts.
- **Drift risk.** Per `[[terraform_lambda_drift_pattern]]`, `aws lambda update-function-code` is the right tool here — terraform apply would clobber the prompt edit. Document the drift in the commit message; don't try to fix it in this session.

---

*Cross-references:* `docs/benchmark-followup-v2.md` (kickoff), `docs/testing_todos_v2.md` F58/F59, `docs/voice_multi_turn_journeys.md` catalog, `[[lambda_deploy_prompts_dir]]` packaging recipe, `[[feedback_verify_live_pattern]]` evidence protocol, `[[voice_harness_lessons]]` bench pre-flight.

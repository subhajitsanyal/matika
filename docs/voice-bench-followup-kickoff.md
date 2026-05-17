You are driving the post-Mac-mini-reboot voice bench. Two outcomes
gate beta:

1. **F39 live verification** — the `PatientCredentialsDialog` fix
   landed in commit `af463b5` with unit-test evidence only. The
   live-evidence triad (RDS `patients` row + `carelog-staging-create-patient-from-voice`
   CloudWatch log + matching RequestId in `matika-staging-bedrock-router`)
   is what flips F39 from "CODE FIX SHIPPED" to "RESOLVED — verified
   live YYYY-MM-DD" in `docs/testing_todos_v2.md`.
2. **8 voice journeys** that have been bench-blocked since 2026-05-11
   or 2026-05-16 (PT-V2-03/04/05/06/08, CG-V2-03/04/13). Each needs
   PASS evidence in `docs/journeys_voice.md` with CloudWatch RequestId
   + RDS row reference.

`docs/runbook_voice_bench_post_reboot_20260516.md` is the long-form
runbook for each journey's setup, utterances, and asserts — **use it
as the per-journey playbook**. This file is just the kickoff prompt
that frames the scope, pacing, and stop-and-surface policy.

## State at session start (verify before touching anything)

1. `git pull origin main`. Last pushed commit was `<NEW_COMMIT>` (will
   be filled in when this kickoff itself is pushed — match `git log
   --oneline -1`). If HEAD doesn't match, surface and stop.
2. **Run the new preflight first, before anything else:**
   ```bash
   scripts/matika-voice-preflight.sh
   ```
   - Exit 0 = audio healthy, ready to drive. Continue.
   - Exit 2 = Core Audio is wedged (F41). **STOP.** Surface to the
     user that the post-reboot Mac is already wedged — that would
     mean the F41 mitigation hypothesis (drop the SwitchAudioSource
     re-assert) is wrong or insufficient. Do not attempt voice
     driving; record the state and ask the user how to proceed.
   - Exit 1 = adb/SwitchAudioSource environment issue (recoverable;
     fix the missing dep and rerun preflight).
3. Read these memory files in order — load-bearing for the run:
   - `[[v2_open_blockers_endofday_20260516]]` — the latest snapshot
     of what's open. F39 status (code shipped + live-verify pending),
     F40 (text-fallback never POSTs — do NOT use as a substitute when
     a voice path looks blocked), F41 (the wedge that pushed this
     session into existence).
   - `[[feedback_verify_live_pattern]]` — non-negotiable evidence
     standard. Per voice journey: device behavior + RDS row + lambda
     log. No exceptions.
   - `[[voice_harness_lessons]]` — five non-obvious behaviors of the
     Samsung S22 / Mac mini bench rig. Read all five before driving.
   - `[[dev_rds_ssm_tunnel]]` — for staging use the variant from the
     F39 kickoff: bastion `i-0f2acdf1a96ee24a6`, local port `55433`,
     secret `carelog-staging-db-password`, RDS host
     `carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com`,
     username `carelog_staging_admin`, dbname `carelog_staging`.
   - `[[jane_dev_test_account]]` — dev-only; don't touch during the
     staging bench but useful as a reference for the test-pair
     pattern.
4. Verify the rig matches what the operator configured before reboot:
   ```bash
   SwitchAudioSource -c
   # Expected: External Headphones  (operator selected this pre-reboot)
   ```
   If it returns something else, surface — the operator may have
   replugged or the OS reset to internal speakers post-reboot.
5. **Export the output-device pin BEFORE the first matika-say call**:
   ```bash
   export MATIKA_OUTPUT_DEVICE="External Headphones"
   ```
   With the F41 mitigation in `scripts/matika-say.sh` (shipped in
   this kickoff's commit), the script switches output ONCE if the
   current device doesn't match, then is a no-op for every subsequent
   utterance. The unconditional re-assert that was the leading F41
   hypothesis is gone.

## What changed in the harness (read before driving)

Three changes shipped in the same commit as this kickoff:

1. `scripts/matika-say.sh` — `SwitchAudioSource -t output -s
   "External Headphones"` is no longer unconditional. New behavior:
   - If `$MATIKA_OUTPUT_DEVICE` is unset → script does not touch the
     output device at all (leaves the operator's selection alone).
   - If set → script reads `SwitchAudioSource -c` first and only
     switches if the current device doesn't already match. So over a
     30-utterance bench, the device-switch event count drops from
     ~30 → 1 (or 0 if pre-selected). This is F41 mitigation #1 from
     the previous session's hypothesis.
   - Diagnostic override: `MATIKA_FORCE_OUTPUT_REASSERT=1` restores
     the old always-re-assert behavior — do NOT set this unless
     you're deliberately trying to reproduce the wedge.
2. `scripts/matika-voice-preflight.sh` — new. Runs an afplay sanity
   check with a 3s hard timeout (catches both fast-failing
   `AudioQueueStart -66681` and the slow-hanging-then-erroring
   variant — both observed in different F41 episodes), reaps orphan
   `say` processes (F21 mitigation), and verifies adb device + the
   audio environment. Exit 2 ⇒ rebooted Mac is still wedged. Exit 1
   ⇒ recoverable env issue. Exit 0 ⇒ proceed.
3. `scripts/matika-voice-run.sh` — now invokes preflight at the top.
   Skippable via `MATIKA_SKIP_PREFLIGHT=1` for diagnostic re-runs;
   default is enforced.

These mean: as you drive each journey, the harness will fast-fail at
the first sign of recurring F41 instead of burning a Maestro launch
on a wedged Mac. **Trust the preflight.** If it exits 2 mid-bench,
stop and surface — don't disable it to "see if voice works anyway."

## Hard scope rules

- **Voice bench + F39 live-verify ONLY.** Do not touch F40 (text-fallback
  no-op) or any other open finding. If you find a backend root cause
  for a voice failure, surface BEFORE making any code change — the
  prior 2026-05-16 session learned that mid-bench backend pivots eat
  the session.
- **Phase A + B only.** EDGE-V2-17 is explicitly out of scope (its
  Maestro flow isn't authored, lower priority). If A + B finish with
  ≥30 min remaining and audio is still healthy, surface to the user
  and ask before extending.
- **No script changes mid-bench** unless preflight uncovers a missing
  dep (e.g. `switchaudio-osx` not installed). Bench instability is the
  primary risk; further harness churn compounds it.
- **No code changes to F39's `PatientCredentialsDialog`** — the fix
  shipped in commit `af463b5` is what's being verified. If the live
  drive surfaces a defect, file it as a new F-number, do not patch
  in-flight.
- **Don't bench iOS, doctor portal, or web portal.** Per
  `docs/v2_launch_plan.md` v1.2 §1: caregiver + patient only;
  Android-only; iOS parked.

## Mid-bench F41 detection + stop-and-surface

Voice runs that hit F41 partway look like:
- `afplay` starts returning `AudioQueueStart failed (-66681)`
- `say` processes hang past `kill -9`
- The next preflight invocation exits 2

**Policy:** stop and surface to the user. Do not attempt soft
recovery (`sudo killall coreaudiod` / `audiomxd` did NOT unwedge
2026-05-16 even after reboot, so they almost certainly won't on
recurrence). Record what passed/failed up to that point, commit +
push the partial results to `docs/journeys_voice.md` /
`docs/testing_todos_v2.md`, and ask the user whether to reboot for a
second attempt or hand back what we have.

**Detection cadence:** call `scripts/matika-voice-preflight.sh`
between each Phase (A→B). If it exits 2 between phases, you've
caught F41 recurrence before it could pollute the journey results.

Update `[[v2_open_blockers_endofday_20260516]]` (or its successor)
with the new F41 data point: how many minutes / how many utterances
into the run before the wedge recurred, and whether the
SwitchAudioSource hypothesis held up. That datum is more useful for
the next mitigation iteration than another PASS journey would be.

## Phase A — Caregiver voice journeys (in order)

Use `docs/runbook_voice_bench_post_reboot_20260516.md` §3 + §4
Phase A for setup, utterances, and per-journey asserts. The deltas
from that runbook:

### A1. CG-V2-04 — F39 live verification (the headline)

This is the journey the entire kickoff exists to verify. Run it
exactly as the runbook §4 Phase A "CG-V2-04" entry describes (8
turns, acoustic Rishi via External Headphones). Two deltas from the
runbook:

1. **Email candidate:** still `sanyalsubhajit2010+at@gmail.com`
   unless Cognito-list-users shows it's now taken (the prior session
   attempted to use it but the form-submit blocker prevented patient
   creation; should still be fresh). If non-empty, pick another `+`
   alias (e.g. `+at2`, `+rajiv`) and verify fresh via
   ```bash
   aws cognito-idp list-users --user-pool-id ap-south-1_7cACPnKJn \
     --region ap-south-1 --filter 'email="<candidate>"' \
     --query 'Users[].Username' --output text
   ```
   Empty output = fresh.
2. **Form-submit step (where F39 lived):** with the fix shipped,
   typing valid email + valid `+91XXXXXXXXXX` phone should NOT leave
   Submit disabled. If you see helper text under either field, the
   format is invalid — read the helper and correct. If Submit is
   tappable and fires (dialog dismisses), the F39 fix is doing its
   job on-device. Continue the conversation to completion.

**Live evidence triad to capture for F39:**
- **Device behavior:** uiautomator dump showing the dialog dismissed
  cleanly after Submit; subsequent voice turn proceeds (no
  re-opening of the dialog unless the LLM re-pauses).
- **RDS row:** within 30 min of `Done` tap,
  ```sql
  SELECT p.short_id, u.name, u.email, p.created_at
    FROM patients p JOIN users u ON u.id = p.user_id
   WHERE u.email = 'sanyalsubhajit2010+at@gmail.com'
   ORDER BY p.created_at DESC LIMIT 1;
  ```
  returns the new Rajiv row with `short_id LIKE 'CL-%'` and
  `created_at` ≥ the session start time.
- **CloudWatch:**
  ```bash
  aws logs tail /aws/lambda/carelog-staging-create-patient-from-voice \
    --since 15m --region ap-south-1
  ```
  shows `Patient created: CL-XXXXXX` matching the RDS row. Cross-ref
  the RequestId with `/aws/lambda/matika-staging-bedrock-router` to
  confirm the credentials reached the lambda.

If F39 live-verify PASSES: flip the F39 entry header in
`docs/testing_todos_v2.md` to
`(RESOLVED — verified live 2026-05-17)` and add a `**Live evidence
(2026-05-17):**` block with the RDS row id + CloudWatch RequestId +
device-behavior note.

If F39 live-verify FAILS at the form-submit step (Submit still
disabled despite valid input, or fires but no lambda invocation):
- Capture uiautomator dump + CloudWatch absence + RDS no-row.
- Add a `**Re-bench attempt 2026-05-17:**` block to F39 with
  evidence.
- Do NOT patch the dialog in-flight; surface to user.

If F39 live-verify FAILS earlier in the conversation (Soda
mis-extraction, LLM hangs, 503, etc.): the F39 fix itself isn't
falsified — the form-submit step never got reached. File the upstream
failure as a separate F-gap and leave F39 status as
"CODE FIX SHIPPED; live re-bench pending" with a note.

### A2. CG-V2-03 — protocol config voice

Per runbook §4 Phase A. Likely auto-continues from CG-V2-04 (the
caregiver_onboarding session that ran F23 transitions into protocol
config after `complete_session`). If you can't reach a clean
protocol-config session inline, drive a separate one via the
caregiver dashboard → patient card → "Manage protocol".

Asserts: `parameter_configs` rows for Rajiv with `frequency_days`,
`daily_deadline`, `threshold_min/max` populated. SQL in runbook §4.

### A3. CG-V2-13 — reminder config voice (F26b voice-only)

Per runbook §4 Phase A. Verifies the voice-only reminder UX shipped
when F26b was resolved (memory: F26b voice-only decision 2026-05-15).
Asserts: `parameter_configs` BP rows updated with new
`daily_deadline`; weight row with `frequency_days=7`.

### Phase A → Phase B transition

Run `scripts/matika-voice-preflight.sh` BEFORE starting Phase B.
- Exit 0 → continue to Phase B.
- Exit 2 → F41 recurred. Stop, capture the cumulative-runtime data
  point (how many minutes into Phase A before wedge), commit Phase A
  results, surface to user.

If Phase A took > 30 min of total `say` activity, also consider
suggesting the user reboot once between phases as a precaution —
even if preflight is green, the cumulative-runtime hypothesis isn't
fully ruled out.

## Phase B — Patient voice journeys (in order)

Logout caregiver → log in as Asha Devi
(`sanyalsubhajit2010+staging-pt@gmail.com`). Password may need a
reset via the `admin-set-user-password` recipe in the runbook §4
Phase B preamble; after reset, `adb shell pm clear com.carelog`
before re-login (Amplify cache trap).

### B1. PT-V2-03 — single-param BP voice (English)
Runbook §4 Phase B "PT-V2-03". Critical re-bench because the
2026-05-16 session got blocked by F40 (text-fallback no-op) here
and never proved the voice path works for patient logging. Asserts
focus on `interaction_sessions` row, `bedrock-router` T2 Haiku call,
and S3 `obs-*.json` for `CL-TPUX54`.

### B2. PT-V2-04 — multi-param voice (English)
Runbook §4 Phase B "PT-V2-04". 3 observations expected (BP systolic
+ diastolic + glucose + weight). Tolerate Soda flake on short
confirmations per F6 residual — fall back to typing "Yes" via the
text field if confirmation utterance gets `NO_SPEECH_DETECTED`. Note:
fallback text-send was the F40 path that didn't POST — that finding
was about the `Type instead (fallback)` patient-logging flow's
end-to-end behavior, not the in-dialog confirmation typing here, but
double-check by querying `interaction_sessions` to confirm the
session row exists before declaring PASS.

### B3. PT-V2-05 — Hindi voice
Runbook §4 Phase B "PT-V2-05". Settings → Language → हिन्दी BEFORE
starting the conversation. Asserts: `interaction_sessions.language='hi'`,
Hindi Matika response.

### B4. PT-V2-06 — Bengali voice (audio-file driven)
Runbook §4 Phase B "PT-V2-06". Long-blocked since 2026-05-11. Uses
pre-recorded `.aiff` via `MATIKA_BN_AUDIO` env var. Helper flow
`_bench_set_language_bn.yaml` flips DataStore to bn. Asserts:
`interaction_sessions.language='bn'`, Bengali Matika response.

### B5. PT-V2-08 — implausibility voice
Runbook §4 Phase B "PT-V2-08". Drives a BP 300/200 utterance to
trigger PLAUSIBILITY_CHALLENGE FSM state. Asserts: no observation
persisted unless user re-confirms; FSM badge shows the challenge.

## When you finish (or stop early)

1. **`docs/journeys_voice.md`** — update each journey row driven:
   - PASS: status flipped to PASS with date + CloudWatch RequestId +
     RDS row reference.
   - FAIL: status updated to the new bench-blocked reason; add a
     short evidence note (what failed, where in the flow).
2. **`docs/testing_todos_v2.md`** — for any new F-gap discovered:
   add a section using the same template as F39/F40/F41 (Severity,
   Owner, Repro, Fix candidates). For F39 if it verified live: flip
   header to `(RESOLVED — verified live 2026-05-17)` + add the
   evidence block.
3. **Memory:**
   - Update `[[v2_open_blockers_endofday_20260516]]` (or create a
     dated successor `v2_open_blockers_endofday_20260517.md`) with:
     - F41 mitigation outcome (did the SwitchAudioSource drop hold
       up? cumulative-runtime threshold observed before any wedge?
       which journeys completed before any audio degradation?)
     - F39 live-verify outcome (RESOLVED with evidence, or rebench
       pending)
     - PASS count delta against the prior snapshot's 44/52
   - If you discover a new harness lesson (e.g. a specific
     utterance that consistently Soda-misheard, a Maestro-flow
     regression), append to `[[voice_harness_lessons]]` or write a
     new linked memory.
4. **Commit + push** — match the style of recent voice-bench commits
   (`8edb9b1`, `3414708`):
   - Subject: `Voice bench results 2026-05-17 — Phase A N/3 PASS,
     Phase B N/5 PASS, F39 <RESOLVED|pending>`
   - Body: per-journey one-line outcome + cumulative-runtime data
     point for F41 + any new F-numbers filed.
   - Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context)
     <noreply@anthropic.com>`
5. **Final report to user** — under 250 words:
   - F39 final state (RESOLVED with live evidence, or live-verify
     still pending and why).
   - Phase A + B PASS/FAIL counts.
   - Any new F-gaps filed.
   - F41 mitigation outcome — was the SwitchAudioSource drop
     sufficient?
   - What's now next from the beta-gate list.

## Surface immediately if any of these happen

- Preflight exit 2 at session start → post-reboot Mac is already
  wedged; F41 mitigation hypothesis falsified or insufficient. **Do
  not attempt voice driving.**
- Preflight exit 2 mid-bench (between phases) → F41 recurred;
  capture cumulative-runtime data point and stop.
- F39 form-submit step still disabled despite valid input → the
  shipped fix isn't working as designed on the device; capture
  uiautomator dump and stop.
- Staging Cognito password rejects multiple resets → as in F39
  kickoff, surface; don't loop on resets.
- Any unexpected backend regression (lambda 503s, RDS schema
  mismatch surfacing as silent failure) → file the F-gap and ask
  before patching backend mid-bench.

## Reference card (carry-forward from prior runbook)

Same as `docs/runbook_voice_bench_post_reboot_20260516.md` §6. Don't
duplicate here; refer.

Notable corrections from the prior runbook (apply when querying):
- DB secret name is `carelog-staging-db-password`, NOT
  `carelog/staging/rds_password`.
- DB user is `carelog_staging_admin`, dbname `carelog_staging`.
- `observations` table doesn't exist in RDS — clinical data lives in
  S3 (`carelog-v2-staging-documents-316643066568/observations/...`).
  RDS surfaces are `interaction_sessions` + `observation_sync_log`.
- `interaction_sessions` columns: `language` (not `session_language`),
  `ended_at` (not `completed_at`).

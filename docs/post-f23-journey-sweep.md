# Post-F23 journey-testing sweep — kickoff prompt

You are the orchestrator for a v2 journey-testing sweep that picks up the
moment F23 (voice patient onboarding) shipped. F23 + the cluster around
it unblocked ~14 journeys that were architecture-blocked yesterday;
your job is to drive each of them to a verified PASS, update
`docs/testing_todos_v2.md`, and refresh the open-blockers memory.

Don't re-litigate decisions that are already in commits. Read the
authoritative state, prioritize, drive serially, verify with live
evidence, ship.

---

## Authoritative state — read in order

1. `docs/testing_todos_v2.md` — single source of truth for F-item status. F1, F2, F4 (Path A), F17 (Android half), F18, F19, F20, F21, F22, F23, F25, F26 (partial) flipped to RESOLVED on 2026-05-10. F3, F5, F7, F8, F16 still open or NEW.
2. `docs/journeys_non_voice.md` — the catalog. Status column tells you what's PASS vs route-reachable vs blocked.
3. `docs/journeys_voice.md` — voice journeys; treat separately, may need acoustic harness.
4. MEMORY.md (auto-loaded) — the entries `maestro_lessons.md`, `voice_harness_lessons.md`, `terraform_lambda_drift_pattern.md`, `dev_rds_ssm_tunnel.md`, `jane_dev_test_account.md` are the bench knowledge base. Don't re-discover the gotchas they document.
5. Recent commits `git log --oneline c88ff17..HEAD` — F23 + Step 5 chain ending at `59ce64b`. Confirm `origin/main` is current (this sweep starts from a pushed `origin/main`).

## What just shipped (handoff context)

The prior session shipped F23 voice patient onboarding end-to-end +
landed nine other F-items along the way. Live evidence for F23: dev
session `fb2f7e87-…`, patient short_id `CL-LW0LEH` (test patient
already cleaned up — Cognito user `41e30d7a-…` deleted, RDS rows
purged via ON DELETE CASCADE on `users`).

Backend versions live in dev as of 2026-05-10 evening:
- `matika-dev-bedrock-router` — CodeSha256 starts `NQHaP4OS…` (pin
  profile-extraction prompt by `patientCtx.placeholder`; isPivotTurn
  drops `newFsmState=PROFILE_CONFIRMED` gating; wantsPivotButNoProfile
  recovery).
- `carelog-dev-create-patient-from-voice` — from `37d18cc`.
- Other v2 lambdas — see `v2_open_blockers_endofday_20260509.md`
  memory for the per-lambda version table. Terraform state is behind
  on a few of them; use `aws lambda update-function-code` not full
  `terraform apply` unless you've confirmed no cognito-drift class
  collisions (per `terraform_lambda_drift_pattern.md`).

## Goal of this sweep

Push the v2 non-voice journey count from **23 of 64 PASS** (2026-05-09
end-of-day) to **≥ 35 of 64 PASS**. The ~12 newly-unblocked journeys
plus 1 explicit re-verification (CG-V2-12 thresholds, post-F26-partial).

**In scope this sweep — 13 journeys** (drawn from `journeys_non_voice.md`):

| ID | Status today | Driver | New flow YAML needed? |
|---|---|---|---|
| **PT-V2-15** Manual log — Blood Pressure | route-reachable post-F4 | Maestro | yes |
| **PT-V2-16** Manual log — Glucose | route-reachable post-F4 | Maestro | yes |
| **PT-V2-17** Manual log — Temperature | route-reachable post-F4 | Maestro | yes |
| **PT-V2-18** Manual log — Weight | route-reachable post-F4 | Maestro | yes |
| **PT-V2-19** Manual log — Pulse | route-reachable post-F4 | Maestro | yes |
| **PT-V2-20** Manual log — SpO₂ | route-reachable post-F4 | Maestro | yes |
| **PT-V2-21** View vital history | route-reachable post-F4 | Maestro | yes — short, assert-6-tiles-visible |
| **EDGE-V2-14** Manual log path entry | route-reachable post-F4 | Maestro | maybe — may piggyback on PT-V2-15 |
| **EDGE-V2-03** Bedrock Guardrail block | post-F19 fix | Maestro voice OR direct lambda | yes — F19 just landed, never re-verified |
| **CG-V2-12** Caregiver threshold edit | post-F26 thresholds wiring | Maestro | yes — pre-F26 flow targeted v1 endpoints |
| **CG-V2-17** Caregiver trends view | post-F26 partial | Maestro | yes |
| **PT-V2-05** Hindi voice (was waiting on F22) | F22 RESOLVED — language picker shipped | Voice harness | extend existing |
| **PT-V2-06** Bengali voice (was waiting on F22+F25) | F22 + F25 RESOLVED | Voice harness | extend existing |

**Stretch goals (only if time):** Re-verify any 2026-05-09 PASSes you
suspect F23/F4 changes might have regressed (`patient_logging_happy_path`
is the canonical CI gate — running it once is cheap insurance).

**Out of scope this sweep:**
- The 8 web-portal-blocked DR-V2-* journeys (need data-testid plumbing
  + Playwright runner — that's a separate stream).
- The 5 F17-push-receipt journeys (still blocked on SNS Platform App
  + FCM service-account JSON — devops).
- Manual / out-of-agentic-scope: PT-V2-10/11/12/24, CG-V2-10/11/14/15,
  PT-V2-22 (design-blocked), PT-V2-14 (cost-prohibitive).

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

# Audio (for the two voice journeys at the end)
afplay -t 1 /System/Library/Sounds/Pop.aiff   # must return in ~1s
                                              # if it hangs → sudo killall -9 coreaudiod,
                                              # then if still wedged, reboot Mac mini
                                              # (per voice_harness_lessons.md lesson 6)

# RDS access sanity — open the SSM tunnel ONCE per session, reuse it
# (tunnel idles out after ~20 min of no traffic — restart it then)
aws ssm start-session \
  --target i-017956fca070240a7 \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["carelog-dev.c30qocsuk0zl.ap-south-1.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["55432"]}' \
  --region ap-south-1 &
# Wait for "Waiting for connections" before issuing psql

# Build + install the latest APK once
(cd android && ./gradlew :app:assembleDebug 2>&1 | tail -3)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Per-journey workflow (the recipe)

For each in-scope journey, execute these steps **in this order**.
Don't skip the live-verification step — the user's
`feedback_verify_live_pattern.md` memory makes this non-negotiable:
"never declare a backend fix done without inspecting the live RDS row +
CloudWatch log".

1. **Read the journey definition.** Open `docs/journeys_non_voice.md`,
   grep for the journey ID, read the full block. Note: trigger,
   pre-conditions, step-by-step UI actions, backend verification,
   pass criteria.
2. **Check for an existing Maestro flow** at `.maestro/flows/<id>*.yaml`
   (substring match — names vary). If present, run as-is via
   `scripts/maestro-run.sh <flow-name>`. If absent, author one
   (next step).
3. **Author the flow** if needed. Template it off the closest existing
   flow:
   - Vital screens (PT-V2-15..20): `patient_logging_happy_path.yaml`
     is the closest analog (login as patient → reach the screen →
     enter values → tap save).
   - Caregiver threshold edit (CG-V2-12): the orphaned
     `caregiver_view_patient_logs.yaml` pattern (login caregiver →
     tap into a patient).
   - Voice (PT-V2-05, PT-V2-06): extend `patient_voice_bp_en.yaml` —
     same structure, swap utterance language + `--turn` lang code +
     seed the DataStore language override per
     `voice_harness_lessons.md` lesson 3 + 5.
   - For modal-bearing screens that render in a Popup, remember
     `maestro_lessons.md` lesson 8 (apply
     `Modifier.semantics { testTagsAsResourceId = true }` on the
     dialog's modifier — if you author a new dialog Composable for
     this sweep).
4. **Bench preflight before each run.** `adb logcat -c &&
   adb shell am force-stop com.carelog`. If the journey is voice,
   also `killall say` and verify `afplay` doesn't hang.
5. **Run the flow.** `scripts/maestro-run.sh <flow-name>` (or
   `scripts/matika-voice-run.sh` with `--turn "en|170|…|800"` args
   for voice journeys). Monitor the output for the journey's
   asserted testTags; on failure, dump the device UI (`adb shell
   uiautomator dump /sdcard/ui.xml && adb pull`) and read the
   Maestro debug screenshot at `~/.maestro/tests/<timestamp>/`.
6. **Verify backend state live.** Each journey block in
   `journeys_non_voice.md` lists what to assert. Always do at least
   one of:
   - psql query against the relevant table via the SSM tunnel
     (`SELECT * FROM <table> WHERE … AND created_at > NOW() -
     INTERVAL '5 minutes'`).
   - CloudWatch log filter for the expected log line
     (`aws logs filter-log-events --filter-pattern '"<expected>"'
     --start-time "$(python3 -c 'import time; print(int((time.time()
     - 5*60)*1000))')"`).
   - S3 object existence (for FHIR Observation journeys).
7. **Update the status row.** Edit `docs/journeys_non_voice.md`'s
   "Status today" column for that journey to **PASS (YYYY-MM-DD)**.
   If a regression surfaced, write up an F-item in `testing_todos_v2.md`
   with severity / owner / reproduction / fix sketch — same shape as
   F1..F26.
8. **Commit per-journey.** One commit per journey works; a
   batch-commit at the end of a related cluster (e.g., all 6 vital
   screens at once) also fine. Title: `journey: PT-V2-15 BP manual
   log — PASS verified`. Include the Maestro flow path + the live
   evidence (RDS query result snippet, CloudWatch line) in the
   commit body.

## Phased agent orchestration

You (the orchestrator) drive everything serially because dev RDS +
the test device are shared singletons. Within each phase, the agents
listed are appropriate to delegate to.

### Phase 0 — state refresh (one Explore call, ~3 min)

Before touching any flow, fire **one Explore agent call** with a
~400-word prompt that:
- Reads every `### ` heading in `docs/journeys_non_voice.md` and
  tabulates: ID | current status | test path stub | testTags
  referenced
- Reads every `### F` heading in `docs/testing_todos_v2.md` and pulls
  status field
- Cross-refs the two to confirm the 13-journey in-scope list above is
  still accurate (an open blocker may have appeared while you were
  reading this doc)
- Reports any journey whose status says "route-reachable" but lacks a
  Maestro flow file (those are the ones you must author)
- Returns a punch list, < 300 words

Don't search journey-by-journey yourself afterward — trust the
Explore output and reach for direct Read only when you need the full
text of a specific journey block.

### Phase 1 — author + run flows for the 6 vital screens (PT-V2-15..20)

The vital screens share structure: login as patient → tap the home
tile → enter values → tap save → verify RDS write. Author the 6
flows as **near-duplicates** off `patient_logging_happy_path.yaml`.
Naming: `.maestro/flows/patient_manual_log_<vital>.yaml` (e.g.
`patient_manual_log_blood_pressure.yaml`).

For each flow:
1. Author the YAML (Write tool, ~30-50 lines each).
2. `scripts/maestro-run.sh patient_manual_log_blood_pressure`.
3. After PASS, verify the new row in `observations` table (or
   wherever the manual-log path lands data — confirm by reading
   `BloodPressureScreen` save handler + tracing what table it
   writes to).
4. Update `journeys_non_voice.md` row to PASS.
5. After all 6 are PASS, batch commit: `journey: PT-V2-15..20 — 6
   vital screens PASS verified`.

PT-V2-21 (view vital history) is shorter — it's just an
assertVisible-on-6-tiles flow. Author and commit alongside the
6 vital flows.

### Phase 2 — the bespoke journeys (EDGE-V2-03, CG-V2-12, CG-V2-17, EDGE-V2-14)

These are one-off flows that don't share much structure with each
other. Drive them serially.

- **EDGE-V2-03 (Bedrock Guardrail block)** — F19's fix just landed
  in this dev. The fastest verification is a direct lambda invoke
  with a guardrail-triggering transcript (e.g. medical advice
  beyond scope) and asserting the response is the configured
  `blocked_input_messaging` copy rather than HTTP 500. If it fails,
  the parser.ts fix probably regressed.
- **CG-V2-12 (caregiver threshold edit)** — post-F26, this flow
  should target `ThresholdConfigScreen` which now reads/writes
  `parameter_configs` via the v2 backend. testTags:
  `threshold_blood_pressure_systolic_min` etc.
  Verify: psql `SELECT threshold_min, threshold_max, updated_at
  FROM parameter_configs WHERE patient_id = '<jane>' AND
  parameter_name = 'blood_pressure_systolic';` — the values you
  edited should be there.
- **CG-V2-17 (caregiver trends view)** — `TrendsScreen` renders
  charts off `observations` rows for Jane. Flow: login caregiver →
  tap into Jane → tap Trends → assert chart-visible (the testTag
  scheme is in `TrendsScreen.kt`). No backend mutation; just
  presence + render.
- **EDGE-V2-14 (manual log path entry)** — re-uses the vital screens
  authored in Phase 1; this is just a different entry point. Likely
  a 1-line flow change off PT-V2-15.

### Phase 3 — voice journeys PT-V2-05 + PT-V2-06

Pre-condition: audio path healthy (see preflight). DataStore language
override per `voice_harness_lessons.md` lesson 3 (the Python protobuf
builder lives in `docs/testing_todos_v2.md` F22 entry). Voice harness
gotchas already in the memory; the F23 session learned that the
voice trigger fires on `RecognitionListener.onReadyForSpeech` on
Samsung One UI (`voice_harness_lessons.md` lesson 1), and you need
3-8s of predelay to absorb TTS tail (lesson 6 from this F23 session
isn't memorialized yet — add an entry if it bites you again).

Re-target `patient_voice_bp_en.yaml` to `…_hi.yaml` and
`…_bn.yaml`. The script wrapper is `scripts/matika-voice-run.sh`
with `--turn "hi|165|…|800"` or `"bn|160|<path-to-aiff>|800"`
(Bengali has no native Mac voice — needs pre-recorded
`MATIKA_BN_AUDIO=<path-to-aiff>`).

### Phase 4 — wrap-up (one batch)

After all in-scope journeys are either PASS or written up as new
F-items:

1. Re-run `patient_logging_happy_path` once (the CI gate). If it
   regressed, stop and bisect.
2. Update `docs/testing_todos_v2.md`'s top "Voice sweep 2026-05-10"
   section with this sweep's deltas. Bump the file's date header.
3. Update the `v2_open_blockers_endofday_20260509.md` memory file
   (rename to `_endofday_<YYYY-MM-DD>.md` and replace the body) to
   reflect new PASS counts + remaining blockers.
4. Single `wrap-up` commit: status updates + memory file rename.
5. `git push origin main`.

## Agent orchestration rules

- **Explore agent** — use for the Phase-0 mapping call AND for
  on-demand "find a testTag for X" searches. Cap each call at a
  ~400-word prompt and ask for ≤300-word output. Don't run more than
  3 Explore calls per phase — diminishing returns.
- **Plan agent** — use ONLY if a journey's flow architecture is
  genuinely non-obvious (e.g., a multi-screen orchestration that
  needs adb gymnastics between Maestro phases). Most of this
  sweep's 13 journeys won't need it.
- **general-purpose** — reserve for if you hit a regression that
  needs cross-codebase tracing (e.g., "why did PT-V2-07 stop
  passing"). Don't use it for routine "did the flow pass" checks.
- **No parallel Agent calls in this sweep.** Dev RDS + the device
  are singletons; a parallel pair of flows would clobber each
  other's state. Sequential discipline.

## Memory + commit hygiene

- New non-obvious bench gotchas → append to `maestro_lessons.md` or
  `voice_harness_lessons.md` as a numbered lesson. Use the same
  voice the existing lessons use (concrete repro, why it bit, fix
  pattern).
- New F-items go in `docs/testing_todos_v2.md` with the standard
  header shape (Severity / Owner / Reproduction / Fix sketch).
  Don't memorialize them in memory — testing_todos is the source
  of truth.
- Commit messages: `journey: <ID> — <one-liner>` for journey passes,
  `<F#>: <one-liner>` for fix commits. Body should always include
  live-evidence snippet (RDS row or CloudWatch line).
- Don't commit Maestro debug artifacts (`~/.maestro/tests/`),
  package-locks, `.docx` files, or anything in the pre-existing
  untracked set listed by `git status` at session start.

## Stopping criteria

End the session when ANY of these hits:
- All 13 in-scope journeys are PASS, OR
- ≥ 10 PASS + 2-3 with new F-items written up (good outcome — the
  remaining blockers are real), OR
- 4 consecutive journey-test attempts hit infrastructure issues
  unrelated to the journey itself (bench/Maestro/RDS) — at that
  point stop and surface what's broken before continuing.

## Test-data hygiene

- The F23 cleanup deleted patient `CL-LW0LEH`. There's a stale
  patient `CL-NC646J` (`Test Patient moz54hrm`) in dev RDS from a
  prior session — leave it; it's not Jane and not this sweep's
  responsibility.
- Jane Doe is the canonical test patient — see
  `jane_dev_test_account.md` memory for IDs.
- Any synthetic patients created during this sweep (e.g. a CG-V2-02
  re-verification) — clean up at the end of the sweep using the same
  pattern as F23 step 5.10 (DELETE on `users.id` cascades to
  patients/persona_links/sessions; admin-delete-user on the Cognito
  sub).

## What success looks like

End of session: `git log --oneline c88ff17..HEAD` shows the F23
chain (already pushed) followed by this sweep's 8-15 commits.
`docs/journeys_non_voice.md` shows ≥ 12 new PASS rows.
`docs/testing_todos_v2.md` has any new F-items in the right shape.
Memory has 0-2 new lessons. `origin/main` is current.

If the test-bench state surprised you and the sweep stalled —
that's also a valid outcome. Surface what broke (testing_todos
F-item) and stop early.

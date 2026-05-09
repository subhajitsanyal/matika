# Matika v2 — Test Plan for Agentic Journey Sweeps

**Version:** 1.0
**Date:** 2026-05-08
**Owner:** journey-orchestrator (drives the sweep), with delegated execution to journey-runner and backend-verifier
**Sources:** `docs/journeys.md` (v2.0), `docs/matika_prd_v2.md`, `docs/matika_spec_v2.md`, agents in `.agents/`

---

## Purpose

Define a phased, repeatable workflow for end-to-end agentic testing of Matika v2 — frontend journeys against the Android app and backend verifications against AWS — that:

- Covers every journey in `docs/journeys.md` (running what's runnable, classifying the rest).
- Coordinates three agents (`journey-orchestrator`, `journey-runner`, `backend-verifier`) without role conflicts.
- Produces a single canonical artefact set under `test-automation/results/journey-results/<sweep-id>/`.
- Stays non-destructive against AWS during the sweep itself (cleanup is out-of-band, between sweeps).

This document is the script. The orchestrator follows it phase by phase; runner and verifier are dispatched per the coordination matrices.

---

## Sweep levels

| Level | Wall-clock | Phases run | Notes |
|---|---|---|---|
| **Smoke** | ≤ 5 min | 0 → 2 → 7 → 8 (skips manual / voice / E2E) | The CI gate. Catches login + Bedrock round-trip regressions only. |
| **Standard** *(default)* | ≤ 30 min | 0 → 1 → 2 → 3 → 4 (English only) → 5 → 6 → 7 → 8 | Recommended for daily / pre-PR sweeps. |
| **Full** | ≤ 90 min | 0 → 1 → 2 → 3 → 4 (en + hi, voice) → 5 (extended) → 6 → 7 → 8 | Add Hindi voice + implausibility/emergency edges + multi-parameter voice. |

The orchestrator accepts:
- `--level smoke|standard|full` (default `standard`)
- `--only <ID,ID,…>` to filter a subset
- `--exclude <ID,ID,…>` (e.g. `EDGE-V2-*`)

---

## Roles

| Agent | Owns | Does NOT do |
|---|---|---|
| `journey-orchestrator` | Sweep lifecycle, classification, dispatch, report | Drive UI, query AWS, modify code |
| `journey-runner` | Maestro flows, voice harness, evidence per UI journey | Backend queries, classification, code changes |
| `backend-verifier` | AWS state verification, RDS via SSM tunnel, S3 + Lambda + Cognito reads | Drive UI, modify code |

Other agents (`android-app`, `backend`, `web-portal`, `inference-platform`, `qa-testing`, `devops`) are **upstream** of this plan: they ship code and infra; this plan tests the result. Findings (missing testTags, blocked Lambdas, prompt regressions) flow into the report's "Blockers and follow-ups" and become tickets for those agents in the next iteration — never inline edits during a sweep.

---

## Phase overview

```
Phase 0 — Pre-flight & baseline snapshot      orchestrator
Phase 1 — Test data setup                     orchestrator → backend-verifier (audit) → journey-runner (create if needed)
Phase 2 — Smoke (UI-deterministic gate)       journey-runner ‖ backend-verifier
Phase 3 — Manual UI flows                     journey-runner ‖ backend-verifier
Phase 4 — Voice flows                         orchestrator (timing) + journey-runner (Maestro) → backend-verifier (telemetry)
Phase 5 — Cross-persona / E2E chains          journey-runner ‖ backend-verifier
Phase 6 — Classification of non-runnable      orchestrator (alone)
Phase 7 — Reporting                           orchestrator (alone)
Phase 8 — Teardown                            orchestrator (alone)
```

Symbols: `→` = handoff; `‖` = parallel; `+` = simultaneous coordinated.

---

## Phase 0 — Pre-flight & baseline snapshot

**Goal.** Establish that every dependency the sweep needs is reachable, and freeze a "before" snapshot of AWS + device state so post-sweep diffs are interpretable.

**Owner.** orchestrator alone. No execution agents are invoked yet.

**Steps.**

1. **Workstation checks** (orchestrator runs these directly):
   - `adb devices` shows exactly one `device` line (recorded with serial).
   - `command -v maestro` resolves; if not, `export PATH="$HOME/.maestro/bin:$PATH"`.
   - `test -f ~/.matika-test-creds.env` and `source ~/.matika-test-creds.env`.
   - For voice phases: `command -v SwitchAudioSource && SwitchAudioSource -t output -c` returns "External Headphones".
   - For voice phases: `command -v say` and `say -v '?' | grep -E "Rishi|Lekha"` confirms the en/hi voices.
2. **AWS identity** — `aws sts get-caller-identity` confirms account `316643066568`. Mismatches abort the sweep.
3. **Sweep ID** — `<sweep-id>=$(date +%Y%m%d_%H%M%S)`; create `test-automation/results/journey-results/<sweep-id>/journeys/`.
4. **APK freshness** — if `git log -1 --since="<APK ctime>" -- android/app/src/` shows changes since the APK on disk, rebuild via `(cd android && ./gradlew :app:assembleDebug)`. Otherwise reuse.
5. **SSM tunnel open** — orchestrator opens the tunnel to RDS (per `backend-verifier` recipe) in background; PID stored in `/tmp/ssm-tunnel.pid`. Sets `trap 'kill $(cat /tmp/ssm-tunnel.pid); unset PGPASSWORD' EXIT` on the sweep shell.
6. **Baseline snapshot** (orchestrator delegates the queries to `backend-verifier` since they're AWS reads, and `backend-verifier` writes them to `<sweep-id>/baseline.json`):
   - Cognito user counts by group (patients / caregivers / doctors).
   - RDS row counts: `users`, `patients`, `parameter_configs`, `interaction_sessions`, `model_call`, `cost_telemetry`.
   - S3 prefix counts for the canonical patient (`observations/<jane-sub>/`).
   - Latest `flyway_schema_history` row (catches "wrong migration applied" before we discover it later).

**Coordination.** Synchronous; orchestrator blocks on each check. Any failure aborts the sweep with a single-line `report.md` describing what was missing.

**Exit criterion.** All checks green; baseline.json on disk; tunnel reachable on `127.0.0.1:5433` via `nc -zv`.

---

## Phase 1 — Test data setup

**Goal.** Guarantee the canonical caregiver and Jane Doe patient exist in the right state for the rest of the sweep. The sweep is **non-destructive** by default; cleanup is opt-in via `--reset-patient`.

**Owner.** orchestrator coordinates; backend-verifier inspects; journey-runner creates only if needed.

**Steps.**

1. **Inspect** (`backend-verifier` reads):
   - Caregiver Cognito user CONFIRMED, in `caregivers` group, with `linked_patient_id=<some patient>`.
   - Jane Doe Cognito user CONFIRMED, in `patients` group, sub recorded (expected: `f1530dba-…`).
   - RDS `users` row for Jane with `persona_type='patient'`; `patients` row with `patient_id` recorded.
   - `~/.matika-test-creds.env` has `MATIKA_PATIENT_EMAIL` matching Jane's email.
2. **Decision matrix** (orchestrator):

   | Inspection result | Action |
   |---|---|
   | All four green | Skip to Phase 2. |
   | Jane absent everywhere | Run `journey-runner` with `MATIKA_FORCE_PATIENT_EMAIL/NAME` → `caregiver_protocol_setup` flow (creates her). Then `backend-verifier` sets her permanent password to `MATIKA_PATIENT_PASSWORD`. Update creds file if needed. |
   | Jane in Cognito only (RDS orphan) | Mark **error**: a previous sweep crashed mid-creation. Recommend `--reset-patient` and abort this sweep. Do NOT silently recreate — orphans hide bugs. |
   | Jane in RDS only (Cognito missing) | Same — abort, recommend reset. |
   | Caregiver absent | Mark **error** and abort. Caregiver creation is out of agentic scope (requires email verification code). User must manually register a caregiver before next sweep. |
3. **Optional reset** (only if `--reset-patient`): backend-verifier runs the patient-cascade cleanup SQL + Cognito bulk delete (recipes in `.agents/backend-verifier.md`), then journey-runner re-creates Jane via the caregiver flow.

**Coordination.** Strict serial: inspect → decide → (optionally) execute. journey-runner fires only on the create branch.

**Exit criterion.** Jane and caregiver exist and authenticate cleanly (verified by `aws cognito-idp initiate-auth` against the mobile client).

---

## Phase 2 — Smoke

**Goal.** Confirm the deterministic UI gate is green before spending wall-clock on heavier phases.

**Journeys.** `CG-V2-02` (caregiver form-based onboarding), `PT-V2-07` (patient text-fallback turn), `PT-V2-01` (login — implicitly covered by PT-V2-07's first half but reported separately).

**Owner.** journey-runner ‖ backend-verifier per journey.

**Coordination matrix per journey.**

| Step | journey-runner | backend-verifier |
|---|---|---|
| 1 | Note `started_at` (ISO 8601 UTC). | Listening for the journey-runner's "started" signal. |
| 2 | Run `scripts/maestro-run.sh <flow> --no-install`. Capture maestro stdout + exit code. | (Idle until step 4.) |
| 3 | Capture logcat over the full duration. | (Idle.) |
| 4 | Note `ended_at`; write `status.json` UI half. | Begin AWS queries scoped to `[started_at, ended_at + 60s]`. |
| 5 | (Idle.) | Run journey's verification matrix (Cognito / RDS / S3 / Lambda log / model_call as listed in `.agents/backend-verifier.md` matrix). Write `backend-checks.json`. |
| 6 | (Idle.) | Set `backend_status` field. |
| 7 | orchestrator combines `ui_status` + `backend_status` into final `status` per pass-criterion. |

**Why not parallel during the run?** UI side mutates AWS state. Querying AWS while the UI step is in flight produces races (e.g. checking `model_call` before Lambda finishes writing). Wait until UI step completes, then verify.

**Exit criterion.** All three journeys `status: pass`. A single fail in Phase 2 prompts the orchestrator to abort the rest of the sweep — Phase 2 is gating.

---

## Phase 3 — Manual UI flows (no Bedrock)

**Goal.** Exercise the manual-vital-logging path that doesn't touch the Bedrock pipeline, plus the patient/caregiver dashboard reads.

**Journeys.**
- `PT-V2-15` (BP), `PT-V2-16` (Glucose), `PT-V2-17` (Temperature), `PT-V2-18` (Weight), `PT-V2-19` (Pulse), `PT-V2-20` (SpO₂)
- `PT-V2-21` (history view)
- `PT-V2-22` (settings — care team read-only)
- `CG-V2-05` (caregiver dashboard), `CG-V2-06` (view patient logs)

**Pre-condition risk.** PT-V2-15..20 each require a testTag on the corresponding home-screen tile to navigate from the home grid. testTags exist on the Save buttons but **not necessarily on the entry tiles** (verified via `grep` during sweep). If a tile lacks a tag, the journey is **blocked: missing testTag <tile_name>**, recorded by the orchestrator and flagged for `android-app`.

**Owner.** Same pattern as Phase 2: journey-runner runs Maestro; backend-verifier checks S3 (FHIR Observation) + `construct-fhir-batch` Lambda log.

**No Bedrock check** in Phase 3 — manual logs do not invoke `bedrock-router` and should not produce a `model_call` row. backend-verifier explicitly asserts `model_call.count == 0` for the journey window as a regression check.

**Coordination.** Serial across journeys (one Maestro flow at a time on a single device); UI/backend split per journey is the same parallel-after-UI pattern as Phase 2.

**Exit criterion.** Every runnable journey is `pass` or `blocked: missing testTag <name>`. Hard fails surface to the orchestrator immediately.

---

## Phase 4 — Voice flows (English only by default)

**Goal.** Validate the on-device STT → cloud Bedrock → on-device TTS round-trip end-to-end, including Lambda telemetry and FHIR persistence.

**Journeys (Standard).** `PT-V2-03` only (English single-parameter BP).
**Journeys (Full adds).** `PT-V2-04` (multi-parameter en), `PT-V2-05` (Hindi), `PT-V2-08` (implausible value, T3 escalation), `PT-V2-09` (emergency).

**Why this phase needs orchestration unique from Phases 2/3.** Maestro can't drive an external Mac process. The runner script is the orchestrator: it backgrounds the Maestro flow, sleeps a calibrated interval, and uses `scripts/matika-say.sh` to speak through External Headphones into the phone's mic. The Maestro flow taps `matika_mic` and waits on `notVisible: thinking`; the speak commands are external.

**Coordination matrix per voice journey.**

```
T = 0      orchestrator: ( scripts/maestro-run.sh <voice_flow> --no-install ) &
                            (journey-runner is now running Maestro inside that subshell)
                          adb logcat -v time > journeys/<ID>/logcat.txt &
T = 7      orchestrator: scripts/matika-say.sh en 175 "<turn-1 utterance>" 600
T = 8      Mac speaker plays turn-1.
T ≈ 10–11  Phone STT yields final transcript; app POSTs /conversation/turn.
T ≈ 12–13  Bedrock returns; UI renders response card; matika_mic re-arms.
T = 19     orchestrator: scripts/matika-say.sh en 175 "<turn-2 utterance>" 400  (confirmation)
T ≈ 22     UI re-renders; mic re-arms.
T_end      orchestrator: wait — Maestro flow exits with rc.
T_end+1    orchestrator: kill logcat capture.
T_end+2    backend-verifier dispatched: query model_call rows in [started_at, T_end+60s] for the patient,
           inspect interaction_sessions row, list S3 prefix for new observations,
           tail bedrock-router CloudWatch for the session id.
```

**Why orchestrator owns timing.** journey-runner's contract is "drive Maestro and capture evidence." It cannot reach across to a Mac process. Voice is the only phase where the orchestrator runs a shell command itself rather than delegating; it does NOT modify code or invent flows.

**Calibration.** First voice journey of the sweep records actual STT-onset and Bedrock-round-trip times in logcat. Subsequent voice journeys reuse those numbers ±20% for sleep targets. If the first journey's audio lands before mic-active, the orchestrator bumps the first sleep by 2s and retries before counting it as a fail.

**Backend verifier checks (per voice journey).**
- `model_call` row(s) for the journey window with `tier='T2'` (or `T3` for PT-V2-08/09), `latency_ms < 3000`, `guardrail_blocked=false` (true is expected for PT-V2-09).
- `interaction_sessions` row with `language='en-IN'` (or `'hi-IN'` for PT-V2-05).
- `observations/<jane-sub>/` prefix gains exactly the expected LOINC objects.
- `escalations_triggered` JSONB array contains expected reason for PT-V2-08/09.

**Exit criterion.** PT-V2-03 `pass`. Failures here typically point at one of: (a) ambient noise (reported as `flaky_acoustic`, retry once), (b) timing drift (orchestrator self-tunes once), (c) real regression (escalates to `bedrock-router` log analysis in the report).

---

## Phase 5 — Cross-persona / E2E chains

**Goal.** Validate that data flows correctly across personas in chained journeys, where prior phases' state is the starting point.

**Journeys (Standard).** `E2E-V2-01` (only the runnable subset of the chain — caregiver self-reg via UI is out of scope; we use existing accounts and verify the chain endpoints). `E2E-V2-02` and `E2E-V2-04` are deferred to Full because they require a second device for the caregiver-side push notification verification.

**Coordination.** Phase 5 mostly stitches results from earlier phases:
- E2E-V2-01: combines CG-V2-02 (Phase 2), PT-V2-01/PT-V2-07 (Phase 2), PT-V2-15 (Phase 3), CG-V2-05 (Phase 3) into a single chain status. No new UI work.
- backend-verifier additionally checks: caregiver dashboard observations match what the patient logged in Phase 3.

**Exit criterion.** Each runnable E2E chain is either `pass` (if every constituent journey passed) or `partial-fail` (with the failing journey ID inline).

---

## Phase 6 — Classification of non-runnable journeys

**Goal.** Every entry in `docs/journeys.md` appears in the sweep report — either with an executed status (Phases 2–5) or with a classification (here).

**Owner.** orchestrator alone (decisions are policy, not execution).

**Classification rules** (mirror of `.agents/journey-orchestrator.md`):

| Class | Examples | Reason captured |
|---|---|---|
| `blocked` | All `DR-V2-*` | "web portal lacks data-testid" |
| `blocked` | `CG-V2-16` (delete patient) | "delete-patient route Lambda not wired" |
| `blocked` | `EDGE-V2-08`, `EDGE-V2-09` | "no fault-injection harness" |
| `manual` | `PT-V2-06` (Bengali voice) | "macOS lacks bn voice; set MATIKA_BN_AUDIO" |
| `manual` | `PT-V2-10/11/12` (photo OCR) | "needs a real device photo" |
| `manual` | `CG-V2-07` (caregiver receives push) | "needs a second device" |
| `out-of-scope` | Anything in `docs/journeys.md` §12 | "MoSCoW Won't" |

For each `blocked`, the orchestrator names the owner agent (`backend`, `web-portal`, `android-app`, etc.) — the report's "Blockers and follow-ups" section is the actionable backlog from this sweep.

**Exit criterion.** Every catalog ID appears exactly once in `results.json`.

---

## Phase 7 — Reporting

**Goal.** Produce the canonical sweep artefact set.

**Owner.** orchestrator alone.

**Outputs** under `test-automation/results/journey-results/<sweep-id>/`:

```
report.md             # human; layout in .agents/journey-orchestrator.md "Report format"
results.json          # machine-readable; full per-journey records
summary.txt           # one line per journey, for `less`-friendly scrolling
baseline.json         # snapshot from Phase 0
post-sweep.json       # equivalent snapshot taken at start of Phase 8
journeys/
  <JOURNEY_ID>/
    status.json
    maestro.log
    logcat.txt
    screenshots/...
    backend-checks.json
```

**Report structure** (per orchestrator agent spec): headline counts, per-persona table, detailed findings for non-pass, blockers, coverage map, environment snapshot.

**Streaming requirement.** report.md is appended to as journeys complete — not written all-at-once at end. If the sweep dies mid-execution, the partial report is still useful.

**Exit criterion.** All four files exist; `results.json` is valid JSON; report.md headline section reflects totals.

---

## Phase 8 — Teardown

**Goal.** Leave the workstation and AWS state at parity with how the sweep started.

**Owner.** orchestrator (the `trap EXIT` hook handles the must-do steps even on early termination).

**Steps.**

1. Restore connectivity if any journey disabled WiFi/data (`adb shell svc wifi enable && adb shell svc data enable`).
2. Kill SSM tunnel: `kill $(cat /tmp/ssm-tunnel.pid)`; remove pid + log files in `/tmp/`.
3. `unset PGPASSWORD`, remove any `/tmp/pgpass` written during the sweep.
4. Take post-sweep snapshot (mirrors Phase 0 baseline) → `post-sweep.json`. The diff between baseline and post-sweep IS data: number of new model_call rows, new observations in S3, new alerts. Include in report.
5. Print path to `report.md` to stdout for human consumption.

**Constraint.** Phase 8 must not delete any data. It is purely process / connection cleanup. The destructive RDS+Cognito patient cleanup is a separate workflow, run between sweeps with `--reset-patient`.

---

## Coordination patterns (cross-phase)

### Pattern A — Sequential UI then parallel backend

Used in Phases 2, 3, 5 (most journeys).

```
journey-runner ─▶ "ui_status: pass" ─▶ orchestrator ─▶ backend-verifier (checks)
                                                    ─▶ logcat tail kept
                                       orchestrator ◀─ "backend_status: pass"
                                       orchestrator ─▶ status.json (combined)
```

**Rationale.** The UI step mutates AWS state; verifying mid-flight produces races.

### Pattern B — Coordinated voice timing

Used in Phase 4.

```
orchestrator ──▶ ( scripts/maestro-run.sh & ) ──▶ journey-runner runs Maestro
orchestrator ──▶ sleep N
orchestrator ──▶ scripts/matika-say.sh                ──▶ Mac speaker
                                                       ──▶ phone STT
                                                       ──▶ /conversation/turn
                                                       ──▶ Maestro asserts
orchestrator ──▶ wait
orchestrator ──▶ backend-verifier (telemetry checks)
```

**Rationale.** Maestro can't speak. Orchestrator owns the speak commands; runner owns the UI; verifier owns the after-the-fact telemetry checks.

### Pattern C — Pure backend chain check

Used in Phase 5 for E2E chains where no new UI work is needed.

```
orchestrator gathers per-journey statuses from earlier phases
backend-verifier runs cross-journey queries (e.g. "do the BP values logged
   by Jane in PT-V2-15 appear in the caregiver's CG-V2-06 Lambda response?")
orchestrator computes E2E status from constituent + cross-check
```

### Pattern D — Solo classification

Used in Phase 6.

```
orchestrator alone reads docs/journeys.md, applies classification rules,
emits results.json entries for every non-executed catalog ID.
```

---

## Evidence layout

Every artefact is rooted at `test-automation/results/journey-results/<sweep-id>/`. The orchestrator owns this tree; runner and verifier write *into* it via paths the orchestrator passes.

```
<sweep-id>/
├── report.md                  # human report (Phase 7, streamed)
├── results.json               # machine-readable (Phase 7)
├── summary.txt                # one-line-per-journey
├── baseline.json              # Phase 0 snapshot
├── post-sweep.json            # Phase 8 snapshot
├── tunnel.log                 # SSM port-forward output (rotated to here)
├── classification.json        # Phase 6 input (which journey is which class)
└── journeys/
    └── <JOURNEY_ID>/
        ├── status.json        # combined UI + backend
        ├── maestro.log        # journey-runner
        ├── logcat.txt         # journey-runner
        ├── screenshots/       # journey-runner (incl. Maestro debug screenshots on fail)
        └── backend-checks.json  # backend-verifier
```

**No PHI.** Synthetic Jane Doe data only. If a journey accidentally captures real-patient state in logcat, the orchestrator redacts before the artefact leaves the per-journey directory.

**Gitignored.** `test-automation/results/` is gitignored already; never commit sweep artefacts.

---

## Run command (Standard, English voice — recommended for the next sweep)

```bash
# Pre-flight
export PATH="$HOME/.maestro/bin:$PATH"
source ~/.matika-test-creds.env
adb devices                         # one device line
SwitchAudioSource -t output -s "External Headphones"

# Launch
.agents/run-sweep.sh --level standard --voice en      # (script TBD; orchestrator-driven for now)

# Or, agentic:
#   ask the orchestrator agent to "run a Standard sweep with English voice"
#   orchestrator follows this plan phase by phase, dispatches runner + verifier,
#   writes the report
```

The `.agents/run-sweep.sh` script is a future deliverable that wraps the orchestrator's lifecycle into a single command. Until it exists, the orchestrator is invoked agentically against this plan.

---

## Out-of-scope for this plan

- **Performance / latency benchmarking** — owned by `qa-testing` per `.agents/qa-testing.md` §"Latency Benchmarking". Out of band from journey sweeps.
- **Cost-baseline harness** — `qa-testing` runs daily during pilot; not gated on sweeps.
- **Compliance scans (PHI in logs, DPDP consent v2.0 coverage)** — `qa-testing` per `.agents/qa-testing.md` §"Compliance Verification". Should run pre-pilot but not per-sweep.
- **Web portal journeys** — blocked on `data-testid`; no journeys here exercise them. When unblocked, add a Phase 4.5 with a `web-journey-runner` agent.
- **Streamed turns (SSE)** — Phase D in the v2 implementation plan, gated on REST API Gateway buffering fix; not in current sweeps.

---

## Revision log

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-05-08 | Initial test plan — Phases 0–8, Standard sweep with English voice. |

*Bump version + date when phases are added/restructured.*

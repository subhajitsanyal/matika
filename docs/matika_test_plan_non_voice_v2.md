# Matika v2 — Non-Voice Test Plan (Exhaustive Sweep)

**Version:** 1.0
**Date:** 2026-05-08
**Owner:** journey-orchestrator (drives) / journey-runner (Android UI) / backend-verifier (AWS state)
**Companion:** `docs/matika_test_plan_v2.md` is the general plan. This is the night-run-no-voice variant.
**Inventory:** `docs/journeys_non_voice.md` — 60 candidate journeys.

---

## Why this plan exists

Voice journeys are acoustically flaky after-hours and need careful environment setup (speaker placement, ambient quiet, Mac volume). Non-voice journeys don't share that constraint and are the right thing to push exhaustively when the lab is loud or asleep.

This plan also commits to **authoring a handful of missing Maestro flows** so the runnable count goes from "5 already-PASS" to "~15 PASS + 6 backend-half + ~30 honest-blocked-with-reason." That's the difference between "we know what's broken" and "we ran what we could."

---

## Sweep scope (3 buckets)

### Bucket A — Re-verify already-PASS (~5 journeys, ~10 min)

Quick smoke that the post-F1/F2/F3/F6/F7/F9 deploys haven't regressed.

- PT-V2-01 (login)
- PT-V2-07 (text fallback)
- CG-V2-02 (form patient onboarding) — confirm 409 path still works
- CG-V2-05 (caregiver dashboard, implicit via CG-V2-02)
- EDGE-V2-07 (Cognito email collision; same path as CG-V2-02)

### Bucket B — Author + run new Maestro flows (~10 journeys, ~90 min)

| ID | New flow | testTag work needed | Backend check |
|---|---|---|---|
| CG-V2-18 | `caregiver_sign_out.yaml` | none — `settings_sign_out` exists | n/a (UI-only) |
| PT-V2-02 | `patient_home_orientation.yaml` | none — `patient_home_start_conversation` exists | n/a |
| EDGE-V2-01 | `registration_validation.yaml` | none — `register_*` testTags exist | Cognito doesn't create user; no rds row |
| EDGE-V2-02 | `login_validation.yaml` | none | Cognito returns NotAuthorizedException |
| EDGE-V2-16 | `consent_disclosure_scan.yaml` | none — `assertVisible text:` works on consent text | n/a |
| PT-V2-08 (text) | `patient_implausible_text.yaml` | none — `matika_text_fallback` exists | `model_call.tier='T3', escalation_reason='implausible_value'` |
| PT-V2-09 (text) | `patient_emergency_text.yaml` | none | `model_call.tier='T3', escalation_reason='emergency'`; `interaction_sessions.escalations_triggered ⊇ ["emergency"]`; `notification-sender` Lambda log |
| PT-V2-13 (text) | `patient_connectivity_loss_text.yaml` | none | `interaction_sessions.status='in_progress'`; no data loss after reconnect |
| EDGE-V2-03 (text) | `edge_guardrail_block_text.yaml` | none | `model_call.guardrail_blocked=true` |
| EDGE-V2-13 (text, BP) | `edge_implausibility_bp_text.yaml` | none | response card content asks for re-check |

### Bucket C — Backend-only verification (~6 journeys, ~30 min)

UI side requires second device or wall-clock — backend chain is verifiable directly via CloudWatch + RDS.

| ID | What we can verify (without UI) | What we can't verify here |
|---|---|---|
| CG-V2-07 | `alerts` row created, `notification-sender` Lambda invoked, SQS message consumed | Caregiver phone receives the FCM push |
| CG-V2-08 | Same — for missed-measurement | FCM receipt |
| CG-V2-09 | Same — for emergency | FCM receipt |
| E2E-V2-02 | Full backend chain: log breach → `evaluate-thresholds-batch` → `alerts` row → SQS → notification-sender | Push delivery |
| E2E-V2-03 | `check-missed-measurements` Lambda invoke → alerts row | Push delivery |
| E2E-V2-06 | `check-daily-deadline` Lambda invoke → push enqueue | Push delivery |

For pushes, it's enough to verify the SQS message and `notification-sender` log shows the right payload — that proves the system *would* deliver. Actual delivery on a second device is a separate manual smoke.

### Bucket D — Classify-only (~40 journeys)

These either (i) need the second device, (ii) need photo capture, (iii) need wall-clock waits, (iv) are F4-architecture-blocked, (v) are web-portal-blocked, or (vi) need backend infra not yet built. Each gets a `status.json` with concrete `blocked_reason` and `owner_agent`. No execution.

---

## Agent coordination model

```
Phase 0  Pre-flight                                orchestrator
Phase 1  Test data setup                           orchestrator → backend-verifier (audit)
Phase 2  Bucket A — re-verify PASS                 journey-runner ‖ backend-verifier (each journey)
Phase 3  Bucket B — author flows + run             orchestrator (author) → journey-runner ‖ backend-verifier
Phase 4  Bucket C — backend-only chains            backend-verifier (alone)
Phase 5  Bucket D — classify rest                  orchestrator (alone)
Phase 6  Reporting                                 orchestrator
Phase 7  Teardown                                  orchestrator
```

### Agent responsibilities (delta from `docs/matika_test_plan_v2.md`)

The three-agent model is unchanged. Two new responsibilities for tonight:

**orchestrator additionally:**
- **Authors new Maestro flows** in Bucket B based on testTag inventory. The existing job spec restricts orchestrator from writing code during a sweep — that restriction is **lifted for `.maestro/flows/`** because flows are test artefacts not product code, and Bucket B is explicitly an author-then-run phase. Production code (`android/`, `backend/lambdas/`, `infrastructure/`) remains read-only.
- **Decides text-fallback substitution** for voice-canonical journeys. Records the substitution in the per-journey `status.json` so the report makes clear what was tested vs. what the journey doc literally specified.

**backend-verifier additionally:**
- **Triggers backend Lambdas directly** via `aws lambda invoke` for E2E-V2-02/03/06 backend halves. This bypasses the UI side and tests the cron / API-driven paths that would otherwise need wall-clock waits.
- **Snapshots SQS depth** before and after notification-triggering journeys to confirm messages were enqueued and consumed.

**journey-runner unchanged.**

### Coordination patterns from the general plan

Both Pattern A (sequential UI then parallel backend) and Pattern C (backend-only chain check) from `docs/matika_test_plan_v2.md` are used. Pattern B (coordinated voice timing) is **not used tonight** — that's the whole point.

New: **Pattern E — direct Lambda invoke for chain testing**.

```
orchestrator ──▶ aws lambda invoke <fn> --payload '{...}' /tmp/out.json
              ──▶ backend-verifier checks downstream:
                  - CloudWatch log of <fn> shows the invoke
                  - if <fn> enqueues SQS, message visible in queue
                  - if <fn> writes RDS, row appears
                  - if <fn> calls another Lambda, that Lambda's log fires too
              ──▶ orchestrator records the chain status
```

---

## Pre-flight (additions to base plan)

- All Bucket B flow files compile (`maestro test --dry-run` if available, otherwise YAML lint).
- `aws lambda list-functions` confirms the Lambdas we'll invoke (`carelog-dev-notification-sender`, etc.) exist.
- For EDGE-V2-04 specifically (FORCE_CHANGE_PASSWORD), have a fresh-state caregiver-driven patient creation ready (or skip; documented as blocked).

---

## Test execution checklist

For each Bucket B / Bucket C journey:

- [ ] Pre-state snapshot (relevant RDS counts, S3 prefix counts)
- [ ] Run UI flow / Lambda invoke
- [ ] Capture maestro.log + logcat.txt OR Lambda invocation result + CloudWatch tail
- [ ] Backend-verifier query window `[started_at, ended_at + 60s]`
- [ ] Combined status (`pass`/`fail`/`partial`/`flaky`) per the orchestrator's pass-criterion rules
- [ ] Append finding to `report.md` in real time (so partial reports survive crashes)

---

## Report format (delta)

The report has all sections from `docs/matika_test_plan_v2.md` Phase 7 plus:

- **Bucket B authored-flows section** — per-flow: filename, what it asserts, time-to-author.
- **Bucket C backend-only section** — per-chain: which Lambda was invoked, downstream Lambdas hit, SQS depth delta, RDS rows added/changed.
- **Substitution log** — every journey where text-fallback was used in place of voice; what was substituted and why.

---

## Estimated wall-clock

| Phase | Estimate |
|---|---|
| 0 (pre-flight) | 5 min |
| 1 (data setup) | 5 min |
| 2 (Bucket A) | 10 min |
| 3 (Bucket B authoring) | 60–90 min |
| 3 (Bucket B execution) | 30 min |
| 4 (Bucket C) | 30 min |
| 5 (Bucket D classify) | 15 min |
| 6 (report) | 15 min |
| 7 (teardown) | 5 min |
| **Total** | **~3 hours** |

---

## What this plan deliberately does NOT do

- **No new product code.** Only `.maestro/flows/` and `test-automation/results/` get touched.
- **No deploys.** Today's test is against the already-deployed backend (post-2c351c7). If a journey surfaces a regression that needs a code fix, it goes into the report's "Blockers and follow-ups" — not into a same-night patch.
- **No voice journeys.** PT-V2-03/04/05/06, CG-V2-03/04, EDGE-V2-17 are skipped; see `docs/journeys_voice.md`.
- **No fresh-Cognito-user testing for EDGE-V2-04** without explicit cleanup approval. Jane is the only patient; preserving that state matters.

---

## Companion docs

- `docs/journeys_non_voice.md` — full per-journey detail for tonight's scope.
- `docs/journeys_voice.md` — what we're skipping tonight.
- `docs/matika_test_plan_v2.md` — general agentic test plan; this doc inherits the lifecycle.
- `.agents/{journey-orchestrator,journey-runner,backend-verifier}.md` — agent specs.
- `docs/testing_todos_v2.md` — durable backlog with F1..F9 status.

---

*Bump version + date when phases / scope change.*

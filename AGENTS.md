# Matika — Working Agreement

**Version:** 1.0 (covers Matika v2.0 development)
**Date:** May 2026
**Source plan:** `docs/matika_implementation_plan_v2.md`
**Source spec:** `docs/matika_spec_v2.md`
**Source PRD:** `docs/matika_prd_v2.md`

This document defines how the agent team operates: who owns what, how work moves between agents, what "done" means, and how progress is reported back to you. Agent role briefings live in `.agents/`; this file is the orchestration layer above them.

---

## 1. The team

Eight active agents. One archived. See `.agents/<name>.md` for full role definitions, owned directories, dependencies, and constraints.

| Agent | Primary domain | New in v2 | Status |
|---|---|---|---|
| `android-app` | Kotlin/Compose mobile app; on-device STT/TTS/OCR; SSE consumer | Rewritten | Active |
| `backend` | Lambda code, RDS migrations, API Gateway routes, Cognito | Expanded | Active |
| `inference-platform` | Bedrock prompts, Guardrails config, escalation signals, evals | **New** | Active |
| `devops` | AWS Terraform, CI/CD, monitoring, Bedrock provisioning | Rewritten | Active |
| `web-portal` | React doctor portal + admin telemetry tab | Minor updates | Active |
| `qa-testing` | E2E, multilingual, latency, cost baseline, compliance | Refactored | Active |
| `backend-verifier` | Read-only AWS verification helper (test-time) | Minor updates | Active |
| `journey-runner` | Drives Android emulator via adb (test-time) | Minor updates | Active |
| `mac-mini-services` | v1 Python services (deleted) | — | Archived in `.agents/_archived/` |

---

## 2. Ownership matrix

Each row is an area; each cell is the primary owner. Reviewers are mandatory for cross-agent changes.

| Area | Primary owner | Mandatory reviewer(s) |
|---|---|---|
| Bedrock prompt templates (`bedrock-router/prompts/*.md`) | `inference-platform` | `backend` (parser contract impact) |
| Bedrock Guardrails config (content) | `inference-platform` | `devops` (deploys), `qa-testing` (false-positive baseline) |
| Bedrock Guardrails resource (Terraform) | `devops` | `inference-platform` (config consumer) |
| Escalation signal logic (`escalation/signal_detectors.ts`) | `inference-platform` | `backend` (consumer) |
| Structured output schema (`output_schema.json`) | `inference-platform` | `backend` (parser impl) |
| `bedrock-router` / `bedrock-vision` Lambda code (handler, state, telemetry) | `backend` | `inference-platform` (when prompt-loading or schema parsing changes) |
| Other Lambda code (`construct-fhir-batch`, alerts, invites, etc.) | `backend` | — |
| RDS migrations | `backend` | `devops` (operations impact) |
| API Gateway route definitions | `backend` | `devops` (Terraform shared) |
| IAM policies (scoped Bedrock + others) | `devops` | `backend` (consuming Lambdas) |
| AWS Terraform modules | `devops` | `backend` (when shared modules) |
| CloudWatch metrics + alarms + dashboards | `devops` | `qa-testing` (consumes for SLO checks) |
| Android app code | `android-app` | — |
| On-device STT/TTS/OCR integration | `android-app` | `qa-testing` (correction-rate metric) |
| Web portal — doctor views | `web-portal` | — |
| Web portal — admin telemetry views | `web-portal` | `backend` (API contract), `devops` (Cognito admin group) |
| E2E + integration test suites | `qa-testing` | — |
| Latency benchmarking | `qa-testing` | `inference-platform` (Bedrock TTFT), `devops` (Lambda overhead), `android-app` (on-device) |
| Cost baseline + cap recommendation | `qa-testing` | `inference-platform` (interpretation), `devops` (env-var deployment) |
| Compliance verification | `qa-testing` | `devops` (CloudTrail), `backend` (audit log) |
| Multilingual prompt evals | `inference-platform` | `qa-testing` (verifies they run on every prompt change) |
| Documentation (`docs/matika_*_v2.md`) | (PRD owner; me) | All agents review their respective sections |

Anything not listed: ask before touching. Default rule — if you don't see your name above, you don't own it.

---

## 3. The shared-directory protocol

Two directories are co-owned and need explicit discipline:

### 3.1 `backend/lambdas/bedrock-router/` and `bedrock-vision/`

| Path | Owner |
|---|---|
| `index.ts`, `handler.ts`, `state_machine.ts`, `telemetry.ts`, `package.json`, `__tests__/` | `backend` |
| `prompts/*.md`, `output_schema.json`, `escalation/signal_detectors.ts` | `inference-platform` |

**Rules:**
- Either agent may open a PR touching the other's files **only with the other agent listed as required reviewer**.
- Prompt content changes (`prompts/*.md`) require `inference-platform` to run `inference-platform/eval/` and attach the evaluation diff to the PR. No prompt change merges if the multilingual matrix regresses below the previous baseline.
- Lambda handler changes that affect parser behavior require `inference-platform` to confirm schema is unaffected.
- Schema changes (`output_schema.json`) require both agents to coordinate: schema change first, parser update second, prompt update third — in three sequential PRs, not one.

### 3.2 `infrastructure/terraform/modules/{api_gateway, lambda, iam, bedrock}`

Shared between `backend` and `devops`. Rule: **the agent adding/modifying a route or Lambda definition** owns the PR; **the other agent** is mandatory reviewer.

Guardrail content (the JSON config) is owned by `inference-platform`; the Terraform resource that deploys it is owned by `devops`. Treat them as separate change types.

---

## 4. Handoff protocol

Tasks have a task ID (`T-V2-XXX`) traceable to `docs/matika_implementation_plan_v2.md`. Handoffs follow a fixed shape:

**A finishes → B picks up:**

1. A produces the deliverable named in the plan ("V005 migration applied," "`/conversation/turn` route returns canned response," etc.).
2. A posts a handoff note in the PR description with:
   - Task ID(s) closed
   - What B can now do (the unblocked task IDs)
   - Any caveats or partial state (e.g., "route exists but provisioned concurrency not yet on")
3. B verifies A's deliverable matches the dependency listed in B's first downstream task (`Depends on:` line in the plan).
4. B begins. If a dependency is materially incomplete or different from spec, B flags it and **does not work around it** — the handoff goes back.

**Cross-agent dependencies stated in the plan are authoritative.** If the plan and an agent doc disagree, the plan wins until the doc is updated.

**No silent unblocking.** If you finish your task early and want to start a downstream task that's another agent's, ask first. The task list is also a workload-balancing tool, not just a dependency graph.

---

## 5. Definition of Done

Different task types have different DoD. A task isn't done until *all* applicable rows are satisfied.

### 5.1 Backend Lambda code (`backend`)

- [ ] Handler implemented per the spec section referenced in the task
- [ ] Unit tests in `__tests__/` cover happy path + error cases
- [ ] No `bedrock:*` wildcard IAM; scoped to specific ARNs (per spec §11.4)
- [ ] Telemetry row written where applicable (`model_call` for any Bedrock call)
- [ ] PR description references task ID and spec section
- [ ] Reviewer from §2 ownership matrix has approved
- [ ] Deployed to dev environment; smoke test passes
- [ ] No PHI in CloudWatch logs (verified via `qa-testing/compliance/phi-log-scan.ts` if applicable)

### 5.2 Bedrock prompt / Guardrail config (`inference-platform`)

- [ ] Change in `*.md` or `*.json` matches spec §6.3 / §11.5 structure
- [ ] `inference-platform/eval/` runs cleanly
- [ ] Multilingual matrix doesn't regress below previous baseline (golden diff attached to PR)
- [ ] Token-impact estimate documented in PR (target: cache hit rate stays > 80%)
- [ ] If a Guardrail change: false-positive rate against the legitimate-health-language regression suite stays < 2%
- [ ] `backend` review confirms parser/schema compatibility
- [ ] Cache breakpoint conventions preserved (`<!-- CACHE_BREAKPOINT -->`)

### 5.3 Android app (`android-app`)

- [ ] Feature works on Android 9 (API 28) minimum target
- [ ] Touch targets ≥ 48dp (≥ 72dp for primary actions)
- [ ] WCAG AA contrast verified on the new screens
- [ ] Unit tests (JUnit + MockK + Turbine) cover the new ViewModels/Managers
- [ ] No PHI in Logcat (verified manually for the new code path)
- [ ] APK builds clean; no new lint warnings introduced
- [ ] Tested on at least one physical device (not just emulator) where it touches `SpeechRecognizer` / `TextToSpeech` / ML Kit (emulator behavior diverges from device for these)
- [ ] Strings use `strings.xml` (no hardcoded user-facing text)

### 5.4 Infrastructure (`devops`)

- [ ] Terraform `plan` reviewed before `apply`
- [ ] Resources tagged correctly (env, service, owner)
- [ ] Secrets in Secrets Manager (not env vars or code)
- [ ] CloudWatch alarms wired where alarms are part of the change
- [ ] Storage in ap-south-1; verify cross-region resources are explicitly cross-region by design
- [ ] Rollback plan documented in PR (especially for Bedrock model ID env-var changes)

### 5.5 Web portal (`web-portal`)

- [ ] Component renders correctly at standard viewport sizes
- [ ] WCAG AA accessibility
- [ ] No PHI in `console.log` / Sentry
- [ ] Vitest + React Testing Library coverage on new components
- [ ] Admin features check Cognito group claim server-side (no client-only gating)

### 5.6 Tests (`qa-testing`)

- [ ] Test passes locally and in CI
- [ ] Test name and structure match the journey ID or scenario ID it covers
- [ ] Test data is synthetic (no real PHI)
- [ ] Test artifacts in `test-automation/results/` are gitignored
- [ ] If verifying a SLO: dashboard query updated to reflect the same metric

### 5.7 Documentation

- [ ] Updated when a spec/PRD assertion changes
- [ ] Linked from PR
- [ ] Cross-references checked (spec sections, task IDs, file paths)

---

## 6. Phase exit gates

Each phase has a single exit gate that must be cleared by the orchestrator (me) before the next phase starts. These come straight from `docs/matika_implementation_plan_v2.md` and are non-negotiable.

| Phase | Exit gate | Verifier |
|---|---|---|
| **P0** | Bedrock model access approved; Mac Mini fully deleted; new Lambda routes return canned responses behind Cognito; `GET /health` returns true health | `devops` confirms; `backend` demos |
| **P1** | Patient speaks Hindi or Bengali; system extracts a BP reading, confirms verbally, produces valid FHIR Observation, logs raw interaction; **P95 < 2s on T2 short turns** | `qa-testing` runs the latency benchmark + multilingual smoke |
| **P2** | Clean glucometer photo extracts in < 300ms via ML Kit; glare photo falls back through Haiku → Sonnet; implausible BP triggers Sonnet challenge; "chest pain" → caregiver alert within 60s | `qa-testing` runs E2E-2, E2E-2b, E2E-9 |
| **P3** | Caregiver onboards new patient in one conversational session; patient receives invite, completes session; threshold breach → caregiver FCM within 60s | `qa-testing` runs E2E-5, E2E-3 |
| **P4** | All PRD §6 acceptance criteria pass in en/hi/bn; SLOs hold under simulated 10-patient load; admin cost dashboard live | `qa-testing` produces full report |
| **P5** | 10 pilot users active; per-patient cost cap configured from real telemetry; T1-reintroduction recommendation written | `qa-testing` + `inference-platform` jointly |

If a gate slips, **the next phase does not start**. We re-plan rather than parallelize through the gap — the gates are placed where they are because downstream work depends on them.

---

## 7. Status reporting back to you

How I'll surface progress without burying you in detail.

### 7.1 Cadence

| Touchpoint | Frequency | Format |
|---|---|---|
| **Phase kickoff** | Start of each phase (6 total) | Short note: phase goals, owner-by-task, key risks I'm watching this phase, expected exit-gate timing |
| **Phase exit review** | End of each phase | Exit-gate verification: did we meet the gate? what slipped? what's the recommended next action? Includes telemetry snapshot if relevant |
| **Mid-phase check-in** | Once per phase, halfway through | One short status update on whether the exit gate is on track. Skipped if everything is green and quiet |
| **Blocker escalation** | As needed, immediately | Whenever a task is blocked > 1 day on something I can't unblock alone (e.g., Bedrock access not granted, BAA scope question, regulator interpretation) |
| **Pilot daily review** | Once during P5 (weeks 15–16 only) | Brief: cost-per-patient yesterday, latency P95, escalation rate, any incidents |

I will **not** send daily standups outside the pilot period. If everything is green, you hear less. If something is yellow or red, you hear immediately.

### 7.2 What each status update contains

A typical update is short. Roughly:

> **Phase X — Mid-phase check-in (week N of M)**
>
> **Status:** Green / Yellow / Red
>
> **Done since last update:** [task IDs closed]
> **In flight:** [task IDs in progress, owner]
> **Blocked:** [task IDs blocked, on what]
>
> **Watching:** [risks active this phase, current state]
>
> **Exit gate ETA:** [date or "on track" or "at risk — recommend X"]
>
> **Decisions needed from you:** [list, or "none"]

The "decisions needed" line is the most important. If I write "none," you don't have to act. If I write something there, I'm explicitly asking you.

### 7.3 What gets surfaced unprompted (vs. waiting for a check-in)

Surfaced **immediately** — out-of-band:
- Bedrock model access denied or revoked
- Cross-region inference compliance pushback
- Cost spike > 3× baseline (after baseline established)
- Security-relevant finding (PHI leak, IAM mistake, Guardrail bypass)
- Any P95 latency SLO miss for > 24h in pilot
- Any task slipping the exit gate by > 1 week

Surfaced **at next check-in** — bundled:
- Routine task completions
- Telemetry trends within expected bands
- Multilingual matrix incremental improvements
- Test additions / coverage changes
- Documentation updates
- Bengali correction-rate measurements (until pilot week 4 when the v2.1 decision is due)

### 7.4 Decision points I'll surface explicitly

These are baked into the plan and will get their own decision turn from you:

| Decision | When | Surfaced as |
|---|---|---|
| Per-patient cost cap value | Pilot week 4 (after telemetry) | Recommendation + 2-3 alternatives, you pick |
| T1 reintroduction (Llama in ap-south-1) | Pilot week 4 | Telemetry-driven recommendation, you accept/defer/reject |
| Bengali path swap to Bhashini IndicConformer | P4 multilingual results | Triggered if correction rate > 10%; you approve scope for v2.1 |
| DPDP regulator interpretation | P5 before pilot launch | Legal review summary, you sign off on consent text v2.0 |
| Bedrock model version updates | Whenever Anthropic ships a new Haiku/Sonnet | Recommendation with traffic-shift plan, you approve cadence |

---

## 8. Escalation triggers (when to break protocol)

Most work flows through ownership + phase gates. These are the triggers that override the normal flow:

1. **PHI leakage suspected anywhere.** Stop work; isolate; involve `devops` + `qa-testing` + you. No PR continues until cleared.
2. **Bedrock cross-region inference legally challenged.** Pause P5; invoke the v3 fallback option (all-in-region Llama-only) discussion.
3. **Two-agent disagreement that can't be resolved in 1 PR cycle.** Brought to me (orchestrator) for arbitration; if I can't resolve, brought to you.
4. **Pilot patient harm or near-harm event.** Immediate halt; root-cause review; you informed within hours.
5. **Cost runaway** (any patient > $5/day for 2 consecutive days during pilot). Lock per-patient hard cap; investigate; resume with new caps.

---

## 9. Open process questions (revisit at P0 retro)

These are deliberately deferred — call them out at end of P0 to refine this agreement:

- Are weekly mid-phase check-ins enough, or do we need a different cadence in P1 (most code-heavy phase)?
- Is the strict file-level split between `backend` and `inference-platform` working in practice, or do we need a flatter "one PR, two reviewers" model?
- Does the journey-runner agent need its own emulator + adb setup as part of its task, or is that an `devops` deliverable?
- Should `web-portal` admin telemetry views be gated by a real RBAC layer beyond Cognito group, given they expose cost data?

---

## 10. Quick reference

- **Plan:** `docs/matika_implementation_plan_v2.md` — task IDs, dependencies, exit criteria
- **Spec:** `docs/matika_spec_v2.md` — API contracts, data schemas, latency budgets, security
- **PRD:** `docs/matika_prd_v2.md` — goals, requirements, risks, open questions
- **Migration:** `docs/matika_v2_migration.md` — concrete delete/add/refactor checklist
- **Agent role docs:** `.agents/<name>.md`

If a question is in scope of one of those documents, look there first. This file is for *how the team operates*, not *what we're building*.

---

*Matika Working Agreement v1.0 — May 2026*

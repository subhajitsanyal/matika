# v2.0 launch plan execution — kickoff prompt

Paste the block below as the first message of a new Claude session to drive execution on `docs/v2_launch_plan.md` v1.2. The orchestrator will load all the v2 memory pointers automatically (cognito drift, fix-then-verify-live, dev RDS access, voice harness lessons, Maestro lessons, Jane/John CG test accounts), so the prompt focuses on **what** to do rather than re-establishing **how**.

The two variants at the bottom (Tighter / Wider) trade off pause-for-review frequency vs. autonomous throughput. Default is the canonical block — Stream A in parallel, surface before Stream B.

---

```
You are the orchestrator for executing the Matika v2.0 launch plan.
The authoritative plan is `docs/v2_launch_plan.md` (v1.2). Read it
end-to-end first; everything below assumes you've internalized it.

## State at session start (verify before doing anything)

1. `git pull origin main` and verify clean working tree.
2. Read `docs/v2_launch_plan.md` v1.2 in full. Skim the changelog so
   you understand the 1.1 rescope (caregiver+patient only) and the
   1.2 lock (Phase 2 trigger = GA + 8 weeks).
3. Skim the auto-loaded memory pointers in MEMORY.md. The ones that
   gate execution behavior:
   - `v2_open_blockers_endofday_20260511.md` (post-rescope state;
     36/52 in-scope PASS, 16 untested, F17/F27/EDGE-V2-14 RESOLVED)
   - `feedback_verify_live_pattern.md` (fix-then-verify-live — RDS
     row + CloudWatch log + device behavior before declaring done;
     non-negotiable)
   - `terraform_lambda_drift_pattern.md` (the cognito-drift class;
     CLI-hybrid pattern only — never a non-targeted `terraform
     apply` until that drift lands)
   - `v2_partial_schema_migration_class.md` (grep markers for the
     F11-F16 bug class; matters during backend backlog work)
   - `jane_dev_test_account.md` + `dev_rds_ssm_tunnel.md` (dev
     access; you'll need both)
   - `voice_harness_lessons.md` + `maestro_lessons.md` (only if you
     touch voice flows or author Maestro flows)
4. Verify the dev SSM tunnel command still resolves the current
   bastion + RDS endpoint before any database work.

## Hard scope rules

- **v2.0 is caregiver + patient only.** Doctor portal, doctor
  onboarding, and doctor-facing analytics are Phase 2 (GA + 8
  weeks). Do not work on: DR-V2-* journeys, doctor-portal
  data-testids, F16 (doctor-patients query), CG-V2-10/11/14/15
  (doctor invite + recommendation), the `doctors` Cognito group
  beyond preserving it. **Do not actively break the web portal
  either** — Vite-builds-clean is the preservation bar.
- **iOS is parked.** Don't touch `ios/` directories.
- **Goal: 52/52 in-scope non-voice + 2/2 voice PASS by T-30** from
  beta open (M1, target July 2026).

## Execution order

Streams below are roughly priority-ordered. Streams A and parts of
G can run in parallel from the start. Surface to me before starting
Stream B, D, or H — those involve trade-offs or external
coordination.

### Stream A — No-cred / no-decision work (start immediately, parallel where independent)

1. **§4.5 production-strip audit** — grep release-build for
   `BuildConfig.DEBUG`, `Log.d`/`Log.v` with PHI, hardcoded dev
   URLs, debug `Toast.makeText`. Audit each branch. Surface a report.
2. **§4.6 Cognito drift apply** — targeted `terraform apply
   -target=module.cognito` against dev to land the drift from
   commit `66ca57c`. **Do this before any other terraform work.**
3. **§4.6 SNS Platform App import** — `terraform import module.sns.
   aws_sns_platform_application.android_fcm <ARN>` so F17's
   platform app becomes declaratively managed. ARN is in the
   memory file.
4. **§4.1 F5/F7/F8 quick wins** — Maestro-run.sh flag ordering;
   voice logcat helper; Bedrock profile name doc-or-env alignment.
   Few hours total.
5. **§4.7 Phase 2 telemetry foundations** — design and ship the
   daily rollup Lambdas + tables for: vital coverage by patient
   (7/30/90-day completion), conversation event log
   (model_call aggregation), alert flow (raised vs. acked),
   patient drop-off. Data layer only — dashboards come later and
   are devops + product.

For each item: fix → verify live → commit + push. Coherent chunks,
not mega-commits.

### Stream B — Backend backlog (§4.2). Surface before starting.

Three journeys to flip to PASS:

1. **CG-V2-16 delete-patient** — verify `delete-patient` Lambda is
   wired into API Gateway, cascade deletes work, Android UI path
   completes. **Required for DPDP right-to-erasure compliance** —
   if it's not wired into the route, flag it as a real beta
   blocker, not a test gap.
2. **EDGE-V2-08 cross-region failover** — Bedrock-mock fault
   injection harness; assert client falls back from primary to
   secondary inference profile on 503.
3. **EDGE-V2-09 parse failure** — inject malformed JSON in
   structured-output return path; assert graceful T3 escalation.

### Stream C — Cognito email-intercept (§4.3)

Build option C (Cognito admin-API confirmation-code capture in the
test runner). Unblocks 3 journeys: CG-V2-01, PT-V2-23, EDGE-V2-04.
~1 day.

### Stream D — Decisions to surface (not your call)

**Stop and ask me** when you reach each of these:

1. **F26b** — keep manual reminder edit UX in v2.0, make
   voice-only, or defer? (Gates CG-V2-13.)
2. **PT-V2-22** — caregiver-only Care Team view in v2.0, or defer
   to Phase 2? My current lean: defer.
3. **PT-V2-14** — accept ~$50-100 one-time Bedrock cost for
   sustained Sonnet capacity validation, mock-substitute, or
   defer to GA capacity testing? My current lean: accept-cost.
4. **Crash reporting** — Sentry or Firebase Crashlytics?
5. **SES sender domain** — final domain for Cognito-driven flows.

Present the trade-offs concisely. Accept my call.

### Stream E — Manual journey runbooks (§5)

9 manual / out-of-agentic-scope cases (wall-clock timers, photos,
mic permission revoke). Author concise runbooks so a human can
execute during the staging soak. Don't try to automate
wall-clock-bound ones.

### Stream F — Voice retest

`PT-V2-06 Bengali` is bench-blocked on the Mac Core Audio wedge.
Ask me whether I've rebooted the Mac since 2026-05-11. If yes,
re-run per the command in `docs/journeys_voice.md` PT-V2-06 row.
If no, surface and skip.

### Stream G — Doc backfill (§6.2). Can run in parallel with A/B/C.

Author the three new runbooks when scope is clear:
- `docs/runbook_oncall_v2.md` — top-10 alerts + first 3
  diagnostic steps each
- `docs/runbook_support_v2.md` — "patient/caregiver can't X" +
  remediation
- `docs/dr_runbook_v2.md` — RDS PITR, S3 replication, Cognito
  export

Plus surgical edits: PRD §1.1 v2.0 scope; implementation plan
F-number close-out; privacy-policy cross-region disclosure;
setup-guide staging + prod sections. Most are <1-hour each.

### Stream H — External coordination. Surface before starting.

Don't drive these alone; prepare what's needed and surface:

- DPDP audit (engage legal) — prepare a gap analysis of what's
  in-scope
- Pen test (engage vendor) — prepare a scope doc
- Bedrock prod quota increase (AWS ticket) — prepare
  justification numbers (3x dev = 100 RPM Haiku, 30 RPM Sonnet)
- Staging environment first-apply (after Stream A; coordinate
  with me)
- Prod environment first-apply (after staging soak)

## Constraints

- **Verify live before declaring done.** RDS row + CloudWatch log
  + device behavior (where relevant). Memory says this is
  non-negotiable.
- **Never `terraform apply` without `-target=` or `-refresh=false`**
  until cognito drift is landed (Stream A item 2). The CLI-hybrid
  pattern from memory is the safe path.
- **Don't touch doctor-side code** — Phase 2. Scope check yourself
  before any edit to: DR-V2-* tests, web portal, F16, CG-V2-10/11/
  14/15, `invite-doctor`, `doctor-*` lambdas.
- **Don't touch iOS** — parked.
- **Commit in coherent chunks, push regularly.** Use HEREDOC for
  commit messages; Co-Authored-By the model.
- **Update memory** when a stream completes and state changes
  materially. Rename `v2_open_blockers_endofday_*.md` to the
  current date.
- **Use subagents** — Explore for codebase surveys, Plan for
  implementation strategy, code-reviewer for independent review of
  non-trivial changes. Don't duplicate work the agent is doing.
- **Surface decisions, don't guess** — see Stream D.

## Definition of session-success

A session is successful if:
- One or more streams advances meaningfully toward 52/52 + the
  M1 beta gate
- Every fix has a live-evidence triad
- Tracked changes are committed and pushed to origin/main
- Memory file is updated if state changed materially
- I'm told concisely at session end: what advanced, what's
  blocked, what's next, and which Stream D decisions are
  pending

Begin by pulling latest, reading `docs/v2_launch_plan.md`
end-to-end, and acknowledging the scope. Then start Stream A in
parallel where possible. Confirm with me before starting Stream B.
```

---

## Variants

**Tighter (no pause-for-review)** — replace the final paragraph with:

> Begin by pulling latest, reading `docs/v2_launch_plan.md` end-to-end, and acknowledging the scope. Then work Streams A → C autonomously, then surface Stream D decisions in a single batch. Move on to E → G as time permits. Only stop for Stream B / Stream H / Stream D items.

**Wider (autonomous through Stream B)** — replace the final paragraph with:

> Begin by pulling latest, reading `docs/v2_launch_plan.md` end-to-end, and acknowledging the scope. Then drive Streams A and B to completion. Surface only when blocked, when you hit a Stream D decision, or when all of A+B is ready for batch review.

**Single-stream mode** (focused execution) — replace everything from "## Execution order" through the end with the single stream block you want to drive, and end with: "Work this stream end-to-end. Surface only when blocked or done."

---

## Notes for the user

- Memory will auto-load all the v2 pointers — don't re-paste them.
- The launch plan is the source of truth for scope, criteria, and timeline. Update the plan as decisions land; don't drift this kickoff prompt.
- After the orchestrator finishes Stream A, the most natural follow-up is to spin a fresh session with the kickoff prompt restricted to Stream B (use the single-stream variant).

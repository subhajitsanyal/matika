# Pre-Beta TODOs — Matika v2.0 closed-beta cutover

> **Audience:** the orchestrator / founder planning the path from current state to closed-beta open. **Snapshot date:** 2026-05-17 evening (post `testing-todos-v2-phase6` session — F40 + F51 + F52 + items A/B/C/D/E from `docs/next-steps-2026-05-17.md` landed).
>
> **Source-of-truth files** (this doc is a consolidated index, not a replacement):
> - `docs/v2_launch_plan.md` §3.1 (beta gates), §6.2 (docs to land), §7 (operational), §8 (compliance), §9 (T-N timeline)
> - `docs/testing_todos_v2.md` (F-class items)
> - `docs/journeys_non_voice.md` + `docs/journeys_voice.md` (per-journey status)
> - `docs/next-steps-2026-05-17-progress.md` §"Must-do before closed beta" (the seed list this doc expands)
>
> **Ordering principle:** **external-vendor lead time → infrastructure cutover → engineering → decisions/provisioning → docs/security cleanup**. Slip on §1–§3 likely slips T-0.
>
> Each row links to the canonical detail (F# or launch-plan section). Update **both** the canonical entry and this index when a row lands. This file is meant to be regenerated mid-beta-runup as items close; don't let it drift.

---

## 1. External-vendor lead time (START ASAP — these sit blocked on SLAs we don't control)

| # | Item | Owner | T-N target | Status / Notes |
|---|---|---|---|---|
| **EX-1** | DPDP audit + signed DPA with AWS + privacy-policy + ToS legal review | founder + external counsel | engage now; T-10 sign-off | `v2_launch_plan.md` §3.1 "Compliance lockdown" + §8.1 + §8.4. Multi-week SLA; counsel scoping doc owed first. Fold in **F50** (`consent_records` HIPAA-vs-DPDP tension — bring the question; current lambda picks HIPAA, may need `dpdpFullErasure=true` flag). Decision blocks `delete-patient` lambda changes. |
| **EX-2** | Penetration test | security vendor (TBD) | Kickoff T-38, report T-14 | `v2_launch_plan.md` §3.1 + §8.3. ~5–6 week external window. Vendor selection + scoping doc owed BEFORE kickoff. Scope: API GW endpoints, Cognito auth, RDS via bastion, mobile binary reverse-engineering, cert pinning. Gate beta on no-Critical-open. |
| **EX-3** | SES production-access ticket | founder → AWS Support | Before any beta-cohort onboarding | Current SES state: SANDBOX. Mail only deliverable to verified recipient identities. Two paths: (a) pre-verify every beta participant's email (~10) via `aws sesv2 create-email-identity`; (b) request production access (couple-day SLA — AWS will ask traffic-pattern questions). Stream D pre-GA decision (commit `7dfc0f6`) chose path (a) for beta — confirm or revise. **This also eliminates F52 sub-issue 3** (the `ses:VerifyEmailIdentity` IAM gap is moot once SES is in prod mode). |
| **EX-4** | Bedrock prod quotas (ap-south-1) | founder → AWS Support | T-21 | Request 100 RPM Haiku + 30 RPM Sonnet. 1–3 day SLA. File AFTER prod env first-apply so the request can cite actual prod account IDs. |

---

## 2. Infrastructure cutover (must land in order)

| # | Item | Where | Status | Notes |
|---|---|---|---|---|
| **INFRA-1** | Staging soak completion | staging | Clock continues to **2026-05-22** (Stream H prod-prep target) | Sign-off + freeze before prod cutover. Soak was running through 2026-05-17 evening's items A–E + F51 + F52 fixes; clock resets if any post-2026-05-17 change destabilizes staging. |
| **INFRA-2** | Production environment first-apply | `infrastructure/terraform/environments/prod/` | Module exists (commit `43f6678`); never applied end-to-end | `v2_launch_plan.md` §7.2. Needs VPC + RDS + Cognito + Bedrock + monitoring + bastion + KMS, then 1-week burn-in with synthetic patient. T-21 per §9. **Pre-prereq:** EX-1 + EX-2 in flight (legal/security expect prod env to exist). |
| **INFRA-3** | F47 cognito-snapshot lambda apply to prod | `infrastructure/terraform/environments/prod/` | Lands free with INFRA-2 (env-symmetric module change) | Daily 02:00 UTC export → `s3://{prod-docs-bucket}/cognito-snapshots/{YYYY-MM-DD}/`. RPO ≤24h. |
| **INFRA-4** | F45 T1 (Cognito sign-in errors alarm) apply to prod | same | Lands free with INFRA-2 | metric-math `Throttles / (Throttles + SignInSuccesses + 1) * 100 > 5` over 5min. |
| **INFRA-5** | F45 T4 (Cognito drift detector) implement + apply | new lambda + monitoring module | DEFERRED 2026-05-17 with design locked | Config-hash variant per `testing_todos_v2.md` F45 entry. ~150 LOC lambda, structurally similar to F47. **Implementation pre-INFRA-2.** Wire-target: pre-prod-cutover. |
| **INFRA-6** | F45 T2 (Bedrock guardrail block-rate metric + alarm) | `bedrock-router/src/handler.ts` + monitoring | DEFERRED | Touches live router code → F2-class lambda-hash drift risk during soak. Bundle with next session already touching the router for unrelated reasons. Locked alarm name `matika-{env}-bedrock-guardrail-block-rate`. Pre-GA, NOT pre-beta. |

---

## 3. Engineering (in our control)

### 3.1 Open / partially-resolved F-class items

| F# | Item | Status today | Beta-blocking? | Notes |
|---|---|---|---|---|
| **F45 T2** | Bedrock guardrail block-rate alarm | DEFERRED | No (pre-GA) | See INFRA-6. |
| **F45 T3** | WorkManager sync backlog alarm | DEFERRED v2.1 | No | Client-side telemetry pipeline needed; Stream C Crashlytics gives partial visibility today. |
| **F45 T4** | Cognito drift detector | DEFERRED, design locked | Recommended pre-INFRA-2 | See INFRA-5. |
| **F46** | S3 access-logs bucket noncurrent-version lifecycle | NEW (cost cleanup) | No | Pre-GA. Add `aws_s3_bucket_lifecycle_configuration` per `testing_todos_v2.md` F46. |
| **F50** | `consent_records` retention on patient delete (HIPAA vs DPDP) | NEW | Decision-blocked | Folds into EX-1 (DPDP counsel call). If DPDP requires erasure: add `dpdpFullErasure=true` flag + DELETE step in `delete-patient/index.js`. |
| **F52 sub-issue 1** | `'relative'` enum filter in `invite-doctor` + `remove-team-member` | Code-fixed in tree, NOT deployed | No for invite-doctor (Phase 2); **Yes for remove-team-member** if Manage Care Team remove leg is used in beta | Deploy `remove-team-member` lambda before any beta cohort needs to remove an attendant. Same CLI deploy pattern as the in-tree fix; ~2 min wall time. |
| **F52 sub-issue 2** | UUID-vs-short-code accept in `invite-doctor` + `remove-team-member` | Code-only (only invite-attendant accepts both today) | Same scope as above | Both lambdas will hit the cast crash on caregiver-side calls until their accessCheck SQL accepts both formats. The invite-attendant fix is the template. |
| **F52 sub-issue 3** | `ses:VerifyEmailIdentity` IAM gap on `carelog-staging-lambda-rds-ses` | DEFERRED | No if EX-3 lands path (b) (SES prod access removes the call path entirely) | Otherwise terraform apply adding the action to the inline policy. Same shape as F49 IAM fold-in. |
| **F52 sub-issue 4** | invite-attendant returns 500 when SES errors despite DB writes committing | DEFERRED | UX polish — recommend pre-beta | Lambda: wrap SES in try/catch, return 201 with `emailStatus=delivery_failed`. Client: render "Invite created, email delivery pending" instead of treating as failure. |
| **F41** | Mac mini Core Audio wedge | BYPASSED via remote-TTS workaround | No (bench-harness, not product) | The remote-TTS server (`scripts/matika-tts-server.py` on a second mac) is the durable path; reboot is the local-mac fix. |

### 3.2 Journey coverage gaps

| Item | Status | Notes |
|---|---|---|
| **All in-scope Android journeys PASS** (52/52 non-voice + 2/2 voice) | Mostly green — see `journeys_non_voice.md` + `journeys_voice.md`. Patient manual-entry tiles all PASSed on staging 2026-05-17 (Phase5). Hindi + Bengali voice PASSed 2026-05-17 evening (Phase6). | `v2_launch_plan.md` §3.1 gate. Drill down via the journey files. |
| **Voice F23 retry path (CG-V2-04 re-verify on current build)** | PARTIAL 2026-05-17 — turns 1+2 PASS; turn 3 timed out (LLM stayed in EXTRACTING_PROFILE; runner 90s mic-active window) | Zero code drift in F39/F42/F43/F44 surfaces since wave PASS; full re-verify deferrable. Next bench: tighten f23 flow with a 5th medications-stage turn, OR raise `MATIKA_TURN_TIMEOUT_S`. |
| **Manage Care Team — UI care-team rendering** | Backend chain PASS (CG-V2-19, F52 verify); UI rendering of new-attendant row in caregiver `CareTeamScreen` + patient `PatientCareTeamScreen` NOT exercised | Rows have no testTags today. Add testTags + write 1 small Maestro flow. ~15 min next bench. |
| **Manage Care Team — remove-team-member** | Not exercised | Requires F52 sub-issue-1+2 fix deployed to `remove-team-member` lambda. Pre-beta if remove is in scope. |

### 3.3 Telemetry + observability

| Item | Status | Notes |
|---|---|---|
| **Data telemetry plan in place — Day-1 beta dashboards** | NOT STARTED | `v2_launch_plan.md` §3.1 final gate + §13. Stream A5 rollups land data nightly but no Grafana/Athena layer yet. **Decision-blocked on what minimum-viable dashboards we open beta with.** Without them, beta runs blind. |

---

## 4. Decisions still owed (founder)

| Decision | Where it surfaces | Blocker |
|---|---|---|
| **F50** — keep `consent_records` on patient delete (HIPAA stance) OR add `dpdpFullErasure=true` request flag | `testing_todos_v2.md` F50 + `delete-patient/index.js` | Folds into EX-1 DPDP counsel call |
| **Beta region** | `v2_launch_plan.md` §11 Q1 | Bengaluru-only? Karnataka? All India? |
| **Beta cohort size** | `v2_launch_plan.md` §11 Q2 | 10 target; flex 5–20? |
| **Final SES sender domain** | `v2_launch_plan.md` §11 Q6 | `no-reply@matika.health`? `support@matika.in`? Affects EX-1 + EX-3. |
| **iOS in v2.1** | `v2_launch_plan.md` §11 Q7 | Firm commit, or revisit based on beta signal? |
| ~~**PT-V2-22 (patient Care Team view)**~~ | ~~`v2_launch_plan.md` §11 Q4~~ | **RESOLVED 2026-05-14 (Stream D) — shipped caregiver-only view in v2.0.** `PatientCareTeamScreen` lives in Android (read-only by construction); `care-team` lambda updated to allow patient self-access via `patients.user_id` + accept UUID or short code; `isPrimary` now serialized. Maestro `pt_v2_22_patient_care_team.yaml` PASS. See `journeys_non_voice.md` PT-V2-22 row. |
| **Data telemetry — Day-1 dashboard set** | §3.3 above + `v2_launch_plan.md` §13 | Which metrics + aggregations get logged from day 1? Without this, beta runs blind. |
| **Status-page tool** | `dr_runbook_v2.md` drill #5 (currently `<TO BE PROVISIONED PRE-BETA — target T-21>`) | Statuspage.io vs Atlassian Statuspage vs self-hosted Cachet |

---

## 5. Documentation backfill (`v2_launch_plan.md` §6.2 still-to-land)

| Doc | Status | Notes |
|---|---|---|
| `docs/privacy-policy.md` | NOT STARTED | Cross-region Bedrock disclosure; verify in-app `cross_region_disclosure_scan` text matches. Blocked on EX-1 legal review. |
| `docs/matika_prd_v2.md` §1.1 | NOT STARTED | Add v2.0 launch scope (caregiver+patient only; doctor portal Phase 2). Cross-ref launch plan. |
| `docs/matika_implementation_plan_v2.md` | NOT STARTED | Mark F-number tasks complete; add launch-plan §4 streams; mark doctor-portal items as Phase 2. |
| `docs/matika_v2_migration.md` | NOT STARTED | v1→v2 migration checklist for downstream operators (delete Mac Mini code paths, what to remove). |
| `docs/phase2_discovery_brief.md` | NOT STARTED | Captures the discovery questions for doctor onboarding (§13). Updated as beta data flows in. |
| `docs/setup-and-deployment-guide.md` — Staging + Production sections | NOT STARTED | Parallel to §3.x dev. Reuse the runbooks where possible. |
| `docs/journeys_non_voice.md` — per-row evidence backfill | PROGRESS — 2026-05-17 sessions added evidence for PT-V2-15..20 (manual entry), CG-V2-16 (delete-patient hardening), CG-V2-19 (invite attendant) | Each in-scope row needs cited evidence to count as PASS for §3.1. |

---

## 6. T-7 pre-beta provisioning (solo-founder mode per F48)

| Item | Owner | T-N target |
|---|---|---|
| Play Store closed-beta listing + invite link | founder | T-7 |
| Beta-support WhatsApp number (separate from founder's personal) | founder | T-7 |
| Beta-cohort roster doc (encrypted Notion or gdoc) | founder | T-7 |
| Hindi + Bengali outage-comms translations (3 short WhatsApp/cohort templates) | founder + content team | T-14 |
| Prod RDS breakglass user | founder | Lands with prod env first-apply (INFRA-2) |
| Beta cohort consent + onboarding scripts | founder | T-7 per `v2_launch_plan.md` §1 item #7 |

---

## 7. Security cleanup (`v2_launch_plan.md` §8.5)

| Item | Status | Notes |
|---|---|---|
| Local FCM service-account JSON cleanup | NOT STARTED | Currently at `~/carelog-7de0c-firebase-adminsdk-fbsvc-fbb5c06723.json` on dev workstation; mirrored to Secrets Manager → can be deleted from disk. |
| Rotate dev RDS password | NOT STARTED | Use `aws secretsmanager update-secret` + Flyway re-connect smoke. |
| Audit `infrastructure/terraform/environments/*/terraform.tfvars` for committed secrets | NOT STARTED | Per memory `dev_tfvars_plumbing_trap.md`, undeclared-variable warnings have masked plumbing — re-audit. |
| Review IAM least-privilege on each Lambda role | NOT STARTED | F49 (delete-patient missing `AdminDisableUser` / `s3:DeleteObject`) + F52 sub-issue 3 (invite-attendant missing `ses:VerifyEmailIdentity`) are evidence that several roles are missing actions they use. Do a full audit before prod. |

---

## 8. Out-of-scope-for-beta (confirmed deferrals — listed so they don't creep back in)

- **F45 T2** (Bedrock guardrail block-rate) — pre-GA, not pre-beta.
- **F45 T3** (WorkManager backlog) — v2.1.
- **F46** (S3 access-logs lifecycle) — pre-GA.
- **F52 sub-issues 1+2** for `invite-doctor` — Phase 2 (doctor portal deferred).
- **Doctor portal, doctor onboarding, doctor-facing analytics** — Phase 2 per CLAUDE.md + `v2_launch_plan.md` §13.
- **iOS app** — parked since 2026-03-24.
- **PagerDuty / Opsgenie tooling** — solo-founder mode for beta (F48 decision); revisit at first hire / pre-GA.
- **Cross-region replication / multi-region DR** — v2.1 per `dr_runbook_v2.md` §2.
- **HealthLake integration** — v2.1.

---

## 9. T-N timeline anchor (extracted from `v2_launch_plan.md` §9 for quick reference)

| T- | Trigger | Linked rows above |
|---|---|---|
| T-50 | Beta cohort identified; consent forms drafted | §4 founder decisions |
| T-45 | Staging environment stood up; 1-week soak begins | INFRA-1 (in progress to 2026-05-22) |
| T-40 | Cognito email-intercept harness ready | (existing infra) |
| T-38 | Pen test kicks off | EX-2 |
| T-35 | Backend backlog clear (CG-V2-16 + EDGE-V2-08/09) PASS | §3.2 |
| T-32 | F26b product call landed | RESOLVED 2026-05-15 |
| T-30 | All in-scope journeys PASS in staging | §3.2 |
| T-28 | Staging soak complete; sign-off | INFRA-1 sign-off |
| T-25 | Phase 2 telemetry dashboards in place | §3.3 |
| T-21 | Production environment apply; 1-week burn-in begins | INFRA-2 + INFRA-3 + INFRA-4 + INFRA-5 |
| T-21 | Bedrock prod quotas approved | EX-4 |
| T-14 | Pen test report received | EX-2 |
| T-14 | Hindi/Bengali outage-comms translations | §6 |
| T-10 | Compliance docs frozen + signed off | EX-1 |
| T-7 | Beta onboarding scripts, support runbook, on-call rotation final | §6 |
| T-3 | Beta cohort onboarding begins | §6 + INFRA-1 |
| T-0 | Closed beta opens for the cohort | — |

Slip in any row pushes T-0 by that delta. Track in a shared launch tracker.

---

## How to use this file

1. **Quick-glance status:** scan §1–§3. Anything pre-beta blocking → has a row above. If you can't find it here, check the source-of-truth files listed in the preamble.
2. **Picking up an item:** read the linked F# entry or launch-plan section FIRST (this index can go stale). Re-verify status against live state per memory `feedback_verify_live_pattern.md` before assuming.
3. **Closing an item:** update both the canonical entry (F#/launch-plan/runbook) AND this index. Don't let the two diverge.
4. **Adding a new pre-beta item:** add the row here AND to the canonical source. If it's a new bug, file an F# entry first; if it's a launch-plan gap, add to `v2_launch_plan.md`.
5. **Regenerating:** when half of §1–§3 has closed, consider rewriting this file from the current state of the source-of-truth files rather than incremental edits. The structure should outlive any single item.

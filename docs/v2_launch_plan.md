# Matika v2.0 Launch Plan

**Version:** 1.2
**Author:** Engineering
**Last Updated:** 2026-05-11
**Status:** Draft for review

> **v2.0 is now scoped to caregiver + patient personas only.** Doctor onboarding, the web portal, and doctor-facing analytics are deferred to **Phase 2** (post-launch), where they will be informed by real patient and caregiver data flowing through the v2.0 deployment.
>
> This plan covers the path from today's state (36 of 52 in-scope non-voice journeys PASS, F17 push transport landed) to a closed beta and then GA of Matika v2.0 caregiver+patient. Phase 2 doctor onboarding has its own section (§13) covering the discovery work needed before engineering can scope it.

---

## 1. Executive Summary

**Where we are.** v2.0 is the platform shift from the v1 per-household Mac Mini stack to AWS Bedrock + on-device STT/TTS. Engineering for the patient and caregiver Android apps is **substantially complete** — **36 of 52 in-scope non-voice journeys PASS** (12 of 64 are doctor-related and now deferred to Phase 2). F17 push transport works end-to-end on real hardware; all V001–V009 schema migrations are live in dev. The remaining 16 in-scope untested journeys partition into a small number of mechanical work streams (Cognito email-intercept, backend backlog, manual/wall-clock cases, one product-decision item).

**Where we're going.** Two pre-doctor milestones, then a Phase 2 doctor onboarding effort:

- **M1: Closed beta (caregiver + patient)** — 10 patient cohort in Bengaluru, July 2026. Android-only. Caregivers onboard their patients; vital logging, conversations, push alerts, threshold/reminder management. Bedrock quota at 50 RPM Haiku / 10 RPM Sonnet per inference profile (current dev limits). Direct-line clinical support during the beta.
- **M2: GA (caregiver + patient)** — public availability for India, October–November 2026. Android-only. Public Play Store listing. Capacity for 1,000 patients. **No doctor portal.** iOS still parked (v2.1 candidate).
- **Phase 2: Doctor onboarding** — after 3–6 months of patient and caregiver data in production. Date deliberately not set; gated on the data-summarization discovery work (§13) producing a clear product spec for what doctors should see.

**Critical-path gates for v2.0 (M1 + M2).**

1. Cognito email-intercept testing pattern (unblocks CG-V2-01, PT-V2-23, EDGE-V2-04 — patient and caregiver registration). Owner: `devops`.
2. Backend backlog: CG-V2-16 delete-patient, EDGE-V2-08 cross-region failover, EDGE-V2-09 prompt-mutation. Owner: `inference-platform`.
3. F26b product call: reminder-config UX in v2.0 — keep manual editing, voice-only, or punt to Phase 2.
4. DPDP compliance audit + signed DPA with AWS. Owner: legal.
5. Cognito drift from commit `66ca57c` applied — without this, the next non-targeted `terraform apply` will undo unrelated fixes.
6. Penetration test (third-party).
7. Beta cohort consent, onboarding scripts, support staffing.

**Out of scope for v2.0** (deferred):

- **Doctor portal, doctor onboarding, doctor-facing analytics → Phase 2.** See §13.
- iOS app. Parked since 2026-03-24; ship Android-only for beta and GA.
- HealthLake integration.
- The `carelog-*` → `matika-*` resource and package rename (deferred to v2.1).
- Mid-session language switching.

---

## 2. Current State Snapshot (2026-05-11)

### 2.1 What's built and working

| Surface | State | Notes |
|---|---|---|
| Android patient app | 36/52 in-scope non-voice + 1/2 voice PASS | F17 push delivered; F23 voice patient onboarding shipped; offline-first sync via Room+WorkManager |
| Android caregiver app | Same | CG-V2-07 PASS (synthetic), CG-V2-12/17 PASS; CG-V2-08/09/E2E push transport unblocked |
| Backend (45 Lambdas) | Live in dev | All V001–V009 migrations applied; Bedrock router live; SNS Platform App provisioned |
| Web portal (doctor) | **Deferred to Phase 2** | Builds + auth flow only; DR-V2-01..08 deferred; no engineering during v2.0 |
| iOS | Parked | Last modified 2026-03-24; will not ship in v2.0 |
| Infrastructure | dev, staging, prod environments exist | Staging + prod are Terraform-defined but not yet applied/smoke-tested |
| CI/CD | 7 GitHub Actions workflows | android, backend, deploy-lambdas, inference-platform, ios, run-migrations, run-tests. The `ios-ci` workflow can stay disabled during v2.0; trim or note in a comment. |
| Maestro flows | 37 UI tests in `.maestro/flows/` | Covers PT-V2-* and CG-V2-* paths |

### 2.2 Open findings (carry-forward)

From `docs/testing_todos_v2.md`:

| F# | Severity | Status | Blocks v2.0? |
|---|---|---|---|
| F5 | Low | Open | No |
| F7 | Medium | Open | No (voice-side bench fix) |
| F8 | Informational | Open | No, but align before any audit |
| F16 | Medium | Dormant | **No — deferred with doctor portal to Phase 2** |
| F26b | Medium | **RESOLVED 2026-05-15 — voice-only** | No (CG-V2-13 PASS-by-architecture) |

**Bench-blocked, no engineering work:**

| Journey | Blocker |
|---|---|
| PT-V2-06 (Bengali voice) | Mac Core Audio wedge `-66681`; reboot-only |

### 2.3 In-scope vs. deferred journey breakdown

**Deferred to Phase 2 (doctor-related, 12 journeys):**

| ID | Title | Why deferred |
|---|---|---|
| DR-V2-01..08 | Doctor portal flows | Doctor portal moves to Phase 2 entirely |
| CG-V2-10 | Caregiver invites doctor | Doctor onboarding deferred |
| CG-V2-11 | Manage care team — remove doctor | Same |
| CG-V2-14 | Accept doctor recommendation | Requires DR-V2-05 |
| CG-V2-15 | Reject doctor recommendation | Requires DR-V2-05 |

**In-scope for v2.0 — 52 total, 36 PASS, 16 untested:**

| Category | Count | Stream owner | Estimated effort |
|---|---|---|---|
| Manual / out-of-agentic-scope (wall-clock timers, photos, mic perm revoke) | 9 | `qa-testing` (human) | 1 day per batch |
| Cognito email-intercept blocked (CG-V2-01, PT-V2-23, EDGE-V2-04) | 3 | `devops` (intercept harness) + `qa-testing` | ~1 day for harness, then run |
| Backend backlog (CG-V2-16 delete-patient, EDGE-V2-08 chaos, EDGE-V2-09 prompt-mutation) | 3 | `inference-platform` + `qa-testing` | ~3 days |
| Cost-prohibitive (PT-V2-14 sustained Sonnet load) | 1 | Decision: simulate or accept | 1–2 days |
| Design-blocked (PT-V2-22 patient Care Team view) | 1 | Product + design | TBD — may itself defer to Phase 2 (Care Team primarily shows doctors) |
| ~~F26 reminders deferred (CG-V2-13)~~ **RESOLVED 2026-05-15 voice-only** | 0 | shipped | done |

Plus **organic-run E2E pushes** (CG-V2-08/09 + E2E-V2-02/03/06): transport unblocked by F17; just need a vital-log-triggered evaluate-thresholds-batch path to flip these from synthetic-PASS to organic-PASS. ~1 day of re-runs.

---

## 3. Launch Criteria

### 3.1 Closed Beta (M1, target July 2026 — caregiver + patient only)

**Quality gates — must all be GREEN:**

- [ ] **All in-scope Android journeys PASS:** 52/52 non-voice + 2/2 voice (Bengali requires Mac reboot first). The 12 doctor-related journeys are explicitly deferred (§13) and do not gate beta.
- [ ] **No critical findings open.** F5/F7/F8 acceptable as Low/Informational. F16 deferred with the doctor portal. ~~F26b must have a product decision~~ F26b RESOLVED 2026-05-15 (voice-only).
- [ ] **Production environment soak-tested.** 1-week burn-in in staging mirroring prod config, then 1-week burn-in in prod against a synthetic patient.
- [ ] **Compliance lockdown:** DPDP audit signed off; DPA in place with AWS; privacy policy + ToS reviewed by legal; consent flow approved.
- [ ] **Penetration test passed** with no Critical or High findings open.
- [ ] **On-call rotation staffed** with a real human and an escalation tree.
- [ ] **Support tooling ready:** runbook for "patient can't log in / log a vital", access to RDS through bastion documented for support engineers, CloudWatch dashboard bookmarked.
- [ ] **Crash reporting wired** (Sentry or Firebase Crashlytics). Currently neither is configured — this is a real gap, not a checkbox.
- [ ] **Cognito drift from `66ca57c` resolved** before any non-targeted `terraform apply`.
- [ ] **Data telemetry plan in place** — see §13. Without baseline data flowing in, Phase 2 doctor-portal product work cannot start. Define which metrics and aggregations get logged from day 1 of beta.

**Cohort criteria:**

- 10 patients, all in Bengaluru / Karnataka (single-region deployment).
- Each patient paired with at least one caregiver.
- Direct WhatsApp channel to support engineering during beta.
- Explicit consent for cross-region inference (display `cross_region_disclosure_scan` Maestro flow's screen content for product review).
- Explicit consent that anonymized usage data informs Phase 2 doctor-portal design (see §13).

### 3.2 GA (M2, target October–November 2026 — caregiver + patient only)

**Adds on top of beta:**

- [ ] Capacity tested to 1,000 simulated concurrent sessions against staging Bedrock quotas (request quota increase early — 1–3 day SLA at AWS).
- [ ] Play Store listing live (iOS deferred to v2.1).
- [ ] Self-serve onboarding flow tested with at least 20 cohort members in a public beta phase.
- [ ] Backup/restore drill: RDS PITR, S3 cross-region replication, Cognito user pool export.
- [ ] Disaster recovery runbook: regional failover plan; even if v2.0 ships single-region, document the RTO/RPO expectations.
- [ ] Cost dashboard live and tied to monthly budget alarms.
- [ ] Customer support workflow documented; ticket-to-engineer escalation path.
- [ ] **Data review** — at least **8 weeks** of GA usage data reviewed before kicking off Phase 2 discovery. Confirms enough signal exists to make doctor-portal product calls evidence-based rather than speculative.

---

## 4. Engineering Work Streams

Streams can run in parallel; calling out dependencies inline. The web-portal stream is **deferred to Phase 2** (§13).

### 4.1 Close out the F-number backlog

| F# | Action | Estimated effort | Blocks beta? |
|---|---|---|---|
| F5 | Make `scripts/maestro-run.sh` flags positional-independent | 30 min | No |
| F7 | Bench fix — logcat-trigger voice orchestration helper | ~2 hours | No |
| F8 | Align spec §3.3/§7.5/§14.3 to runtime `global.*` profile (or flip env to `apac.*`) | 30 min | No, but should be done before any audit |
| F16 | doctor-patients query schema mismatch | **Deferred to Phase 2** (no doctor portal in v2.0) | No |
| F26b | ~~Product call: keep manual reminder edit UX in v2 or make voice-only?~~ **RESOLVED 2026-05-15 — voice-only.** Manual UI removed; caregiver_onboarding voice protocol is the canonical reminder-config surface. | shipped | No (CG-V2-13 PASS-by-architecture) |

### 4.2 Backend backlog

| Journey | Action |
|---|---|
| CG-V2-16 (delete patient) | Verify `delete-patient` Lambda + cascading deletes in observations/alerts/persona_links. Maestro flow covers Android UI; backend coverage already in tests. **Required for GDPR/DPDP right-to-erasure compliance.** |
| EDGE-V2-08 (cross-region failover) | Build a fault-injection harness — Bedrock mock layer that returns 503 from primary region; assert client falls back to secondary inference profile. |
| EDGE-V2-09 (parse failure) | Inject malformed JSON in the structured-output return path; assert graceful fallback to T3 escalation. |

Estimated effort: 3 days for the harness, 2 days for the flows.

### 4.3 Cognito email-intercept testing pattern

3 journeys depend on receiving an email at a test address and pulling the OTP/link: **CG-V2-01** (caregiver self-registration), **PT-V2-23** (patient self-registration), **EDGE-V2-04** (`FORCE_CHANGE_PASSWORD` first-time login). Options:

- **A:** Use a `+test` Gmail filter and a Gmail-API based test helper.
- **B:** Use AWS SES inbound rules to a test inbox in S3, poll the bucket.
- **C:** Pre-seed Cognito with `EmailVerified=true` + capture confirmation codes via Cognito's admin API in the test runner.

Recommend C — least DNS surface, least delay. Owner: `devops`. ~1 day.

### 4.4 PT-V2-22 design and PT-V2-14 cost decisions

- **PT-V2-22 (patient Care Team view):** Care Team primarily shows doctors. Since doctor onboarding is deferred, the most consistent call is to defer this view to Phase 2 alongside doctor onboarding. Document the KNOWN-GAP waiver. If product wants a caregiver-only Care Team view for beta, that's a small Android-only change.
- **PT-V2-14:** Cost-prohibitive Bedrock test (sustained Sonnet load). Either (a) accept the ~$50–100 one-time cost for a live capacity validation, (b) substitute with a synthetic load test against a Bedrock mock, or (c) defer to GA capacity testing. Recommend (a).

### 4.5 Production-strip audit of debug-only code

The F28 (EDGE-V2-14) fix is `BuildConfig.DEBUG`-gated by construction, so the release binary is already clean. Before beta, run a release-build sanity audit to catch any other accidental debug-only paths that leak into release:

- `BuildConfig.DEBUG` references in production code — verify each branch is in a debug-only code path.
- `Log.d` and `Log.v` with PHI in the message — strip or gate.
- Hardcoded test credentials, dev API URLs, `Toast.makeText` debug strings.

Probably ~1 day of greppage + review. Owner: `android-app` + security reviewer.

### 4.6 Terraform / infra cleanup

| Item | Action |
|---|---|
| Cognito drift from `66ca57c` | Apply targeted `terraform apply -target=module.cognito` against dev to land the drift; verify no auth regressions; commit state. |
| SNS Platform App import | `terraform import module.sns.aws_sns_platform_application.android_fcm <ARN>` so it's managed declaratively. |
| Staging environment first-apply | Stand up staging end-to-end. Migrate schema. Run smoke against staging Cognito + RDS + Bedrock. |
| Prod environment first-apply | After staging soak. Plan + apply + verify; then plan for empty diff before opening to beta. |
| Bedrock quota increase request | File for prod region: 100 RPM Haiku, 30 RPM Sonnet (3x dev). 1–3 day SLA. |

### 4.7 Telemetry for Phase 2 discovery

Even though doctor portal work doesn't start in v2.0, the data that informs Phase 2 design must start flowing in **from day 1 of beta**. Items to wire before beta opens:

- **Vital coverage by patient:** rolling 7/30/90-day completion rates per parameter. Already partly in `observations` + `parameter_configs`; needs a daily roll-up Lambda + a table for the rollups.
- **Conversation event log:** session count, average duration, escalation rate (Sonnet vs. Haiku), Guardrail block rate. `model_call` + `interaction_session` already capture the raw data — need a daily aggregator.
- **Alert flow:** alerts raised vs. acknowledged, time-to-acknowledge, missed-measurement frequency. Already in `alerts`; needs a view or rollup.
- **Patient drop-off:** patients who haven't logged a vital in N days. Trivial query, but needs to be a dashboard.

These dashboards directly answer the questions Phase 2 product work will ask: *which patients would a doctor most want to see? what summary cards are useful? what's the right cadence for review?*

Estimated effort: 2–3 days. Owner: `inference-platform` (rollup Lambdas) + `devops` (CloudWatch / QuickSight dashboards).

---

## 5. Testing Strategy → 52/52 in-scope PASS

**Approach:** drive each in-scope untested journey to PASS through the work streams in §4. Track in `docs/journeys_non_voice.md` (one row per journey, evidence cited). The 12 doctor-related journeys (DR-V2-01..08, CG-V2-10/11/14/15) are explicitly excluded from v2.0 — track them in §13 instead.

### 5.1 Re-running already-fixed bench-blocked journey

| Journey | Trigger |
|---|---|
| PT-V2-06 (Bengali) | After Mac reboot. Exact command in `docs/journeys_voice.md` PT-V2-06 row. |

### 5.2 Organic-run E2E flips

After §4.x stabilization, re-run with the **organic** path (write a vital that breaches threshold, let `evaluate-thresholds-batch` fire, await push):

- CG-V2-08 (caregiver gets push for patient threshold breach)
- CG-V2-09 (caregiver acks push, sees alert detail)
- E2E-V2-02/03/06 (composite vital→alert→push journeys)

### 5.3 Coverage table after launch readiness

Targeting **52/52 in-scope PASS** before beta — every cell in §2.3 moves to PASS by the per-row owner. Tracking spreadsheet hangs off `docs/journeys_non_voice.md`; one-line evidence per row (commit, CloudWatch link, screenshot, or runbook step).

### 5.4 Voice tests beyond the 2 in catalog

Voice journey catalog is small today (`docs/journeys_voice.md`). Pre-beta, add at minimum:
- One Hindi conversation end-to-end (PT-V2-05 path)
- One Bengali conversation end-to-end (PT-V2-06 path, post-reboot)
- One caregiver-side voice patient onboarding (F23 happy path, already covered in dev)
- One mid-session interruption / Guardrail block (EDGE-V2-03 voice variant)

### 5.5 Chaos / load testing

Not part of the catalog; add a phase:

- Bedrock failover (EDGE-V2-08)
- RDS port-forward outage simulation
- Cognito user-pool unavailability (graceful degradation expected)
- SNS Platform App credential rotation drill (also produces a documented runbook)
- WorkManager sync recovery after extended offline period (overnight wifi-off, then assert pending observations sync correctly)

---

## 6. Documentation Backfill

### 6.1 Landed in this pass (2026-05-11)

- `docs/setup-and-deployment-guide.md` v3.3:
  - §3.3 enumerates V001–V009 migrations.
  - §6.6 SNS Platform App + FCM HTTP v1 provisioning runbook (F17).
  - Removed stale v1 Mac Mini architecture diagram.
  - Lambda count corrected (28 → 45).
- `docs/matika_spec_v2.md` §5.2 — V006–V009 schema additions inline.
- `docs/matika_spec_v2.md` §10 — push transport details replace the v1 carry-over reference.
- `docs/testing_todos_v2.md` — dedicated F28 (EDGE-V2-14) entry with live evidence triad.

### 6.2 Still to land (pre-beta)

| Doc | Update |
|---|---|
| `docs/matika_prd_v2.md` | Add a §1.1 v2.0 launch scope (caregiver+patient only; doctor portal → Phase 2); cross-reference launch plan. |
| `docs/matika_implementation_plan_v2.md` | Mark all F-number tasks complete; add the launch-plan §4 streams; mark all doctor-portal items as Phase 2. |
| `docs/matika_v2_migration.md` | Add a v1→v2 migration checklist for downstream operators (delete Mac Mini code paths, what to remove). |
| `docs/privacy-policy.md` | Update for Bedrock cross-region inference disclosure; verify the in-app `cross_region_disclosure_scan` content matches the policy text. |
| **NEW** `docs/runbook_oncall_v2.md` | On-call playbook: top-10 alerts and their first 3 diagnostic steps. |
| **NEW** `docs/runbook_support_v2.md` | Support-engineer-facing runbook: common "patient can't X" / "caregiver can't X" scenarios + remediation. |
| **NEW** `docs/dr_runbook_v2.md` | Disaster recovery plan: RDS PITR, S3 replication, Cognito export. |
| **NEW** `docs/phase2_discovery_brief.md` | Captures the discovery questions for doctor onboarding (§13). Updated as data flows in during beta and GA. |
| `docs/journeys_non_voice.md` | Each in-scope row gets evidence cited as we drive to 52/52. Doctor-related rows annotated "Phase 2". |
| `docs/setup-and-deployment-guide.md` | Add a `Staging` and `Production` deployment section paralleling §3.x dev. |
| `CLAUDE.md` | Add a "v2.0 launch readiness" pointer to this plan. **DONE.** |

### 6.3 Out-of-scope for v2.0

- HealthLake integration design (deferred to v2.1).
- iOS app docs (parked).
- Multi-region failover (single-region launch).
- Doctor portal docs — see §13.

---

## 7. Operational Readiness

### 7.1 Staging environment activation

`infrastructure/terraform/environments/staging/` exists but has never been fully applied end-to-end.

1. Verify `terraform.tfvars` has staging-appropriate values (SES sender, FCM platform ARN, Bedrock model IDs).
2. `terraform init && terraform plan -out=tfplan && terraform apply tfplan`.
3. Migrate schema: `flyway migrate` over the bastion tunnel (per `docs/setup-and-deployment-guide.md` §3.3).
4. Provision a staging SNS Platform App with its own FCM service account (separate Firebase project recommended).
5. Run the full Maestro suite against staging.
6. Soak for 1 week with synthetic load.

### 7.2 Production environment activation

After staging soak. Steps mirror §7.1 but:

- Use prod Firebase project (or prod-firebase-app under the same Firebase project).
- Request prod Bedrock quotas at 3x dev (file 1 week before plan-apply).
- Snapshot Cognito user pool config (export user attributes + group config) — needed for disaster recovery.
- Stand up CloudWatch alarms before opening Cognito sign-ups: latency, error rate, Bedrock guardrail block rate, alert delivery rate, SQS queue depth.
- Configure CloudWatch contributor insights for "top error sources by patient_id" so support can diagnose individuals fast.
- Wire SNS topic for alarms → on-call paging.

### 7.3 Monitoring + alerting

| Surface | Current state | Target |
|---|---|---|
| CloudWatch alarms | 6 in dev (per setup guide §Reference) | 12+ in prod, with on-call paging |
| Cost telemetry | `cost_telemetry` table populated, no dashboard | Grafana or Athena dashboard with daily roll-up |
| Crash reporting | None | Sentry or Crashlytics (decide once during stream §4.1) |
| App-side log forwarding | `adb logcat` only | Firebase Crashlytics + breadcrumbs |
| Performance | None | Bedrock latency p50/p95/p99 dashboards; Android cold-start time |

### 7.4 On-call rotation

Define before beta. At minimum:
- Primary: one engineer per week.
- Escalation: backend, frontend, infra leads.
- Runbook: see new `docs/runbook_oncall_v2.md`.
- Off-hours expectations: best-effort for beta; defined SLA for GA.

---

## 8. Compliance & Security

### 8.1 DPDP Act (Digital Personal Data Protection Act, India)

- [ ] DPDP audit by external counsel.
- [ ] Data residency: confirmed ap-south-1 for storage; document the cross-region Bedrock inference exception in privacy policy.
- [ ] Consent flow: explicit, granular, withdrawable. In-app screen exists (`cross_region_disclosure_scan` reference); content needs legal sign-off.
- [ ] Data subject rights: export (account deletion lambda already exists; need data-export equivalent), erasure (already exists).
- [ ] Data Processing Agreement with AWS (covers all regions in use).

### 8.2 HIPAA

Probably not in scope for India launch. If US patients are ever added, separate audit needed; the codebase has HIPAA-leaning controls already (`test-automation/compliance/hipaa-checklist.md`) but uncertified.

### 8.3 Penetration test

Engage a third-party firm 4 weeks before beta. Scope: API Gateway endpoints, Cognito auth flow, RDS via bastion, mobile binary reverse-engineering, certificate pinning bypass attempts.

Track Critical and High findings against beta-gate criteria; Mediums tracked but not blocking.

### 8.4 Privacy policy + ToS

- Cross-region inference disclosure ← already in app
- FCM push notification disclosure
- Cognito SSO disclosure
- Data retention policy (current: indefinite; consider 7-year window for clinical data)
- Children's data: explicitly out of scope (no patients under 18)

### 8.5 Operational security

- [ ] Local FCM service-account JSON cleanup (currently at `~/carelog-7de0c-firebase-adminsdk-fbsvc-fbb5c06723.json` on the dev workstation; mirrored to Secrets Manager, can be deleted from disk).
- [ ] Rotate dev RDS password.
- [ ] Audit `infrastructure/terraform/environments/*/terraform.tfvars` for accidentally-committed secrets.
- [ ] Review IAM least-privilege on each Lambda role.

---

## 9. Launch Sequence (T-N from beta open)

Stub timeline — adjust once owners agree. Tighter than the previous draft because the web-portal stream is gone:

| T- | Action | Owner |
|---|---|---|
| T-50 | Beta cohort identified; consent forms drafted | product |
| T-45 | Staging environment stood up; 1-week soak begins | devops |
| T-40 | Cognito email-intercept harness ready; CG-V2-01 + PT-V2-23 + EDGE-V2-04 PASS | devops + qa |
| T-38 | Pen test kicks off | security vendor |
| T-35 | Backend backlog (CG-V2-16 + EDGE-V2-08/09) PASS | inference-platform |
| T-32 | F26b product call; reminder UX decision landed | product |
| T-30 | All 52 in-scope non-voice + 2 voice journeys PASS in staging | qa-testing |
| T-28 | Staging soak complete; sign-off | engineering lead |
| T-25 | Phase 2 telemetry dashboards in place (vital coverage, conversation, alerts, drop-off) | devops |
| T-21 | Production environment apply; 1-week burn-in with synthetic patient | devops |
| T-21 | Bedrock prod quotas approved | aws-vendor |
| T-14 | Pen test report received; remediations triaged | security |
| T-10 | Compliance docs frozen and signed off | legal |
| T-7 | Beta onboarding scripts, support runbook, on-call rotation final | support + eng |
| T-3 | Beta cohort onboarding begins | support |
| T-0 | Closed beta opens for the cohort | product |

Slip in any single row pushes T-0 by that delta. Track in a shared launch tracker.

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bedrock quota insufficient at peak | M | H | Request 3x dev quotas early; tier 2 (Haiku) carries most load |
| FCM credential rotation requires device re-registration | L | M | Document rotation runbook; plan rotations during low-use windows |
| Cognito drift causes auth regression on next `terraform apply` | M | H | Apply targeted `terraform apply -target=module.cognito` before any other infra change |
| iOS gap surfaces market resistance | L | M | Communicate Android-only positioning early; v2.1 iOS roadmap |
| DPDP audit finds material gaps | L | H | Engage counsel early; budget for remediation cycle |
| Voice testing on Bengali stays bench-blocked | L | L | Reboot Mac before each voice sweep; document command |
| Pen test surfaces a Critical | M | H | Budget 2-week remediation window; gate beta on no-Critical-open |
| Beta cohort identifies a UX-breaking bug | H | M | WhatsApp channel + ability to hotfix Android via Play Store rolling release |
| Support tooling missing at launch | M | H | Build runbooks in §6.2 before T-7 |
| Insufficient data for Phase 2 discovery by GA + 4 weeks | M | M | Wire telemetry (§4.7) from day 1 of beta; review baseline at GA + 2 weeks |
| Doctor stakeholders feel left out of v2.0 launch comms | M | L | Pre-brief any existing physician partners on the Phase 2 plan; offer early-access waitlist |

---

## 11. Open Questions

These need product/leadership decisions before plan execution:

1. **Beta region:** Bengaluru-only? Or wider Karnataka? Or all India?
2. **Beta cohort size:** 10 is the target — flex to 5 or 20?
3. ~~**F26b reminder UX:** keep manual editing in v2.0, make voice-only, or skip reminders for beta?~~ **RESOLVED 2026-05-15 → voice-only.** Manual UI removed; caregiver_onboarding voice protocol is the canonical reminder-config surface (handler.ts T-V2-302 → protocol_persister UPSERT on parameter_configs).
4. **PT-V2-22 (patient Care Team view):** ship a caregiver-only view in v2.0, or defer to Phase 2 with the doctor portal? Recommend defer — Care Team without a doctor isn't a complete experience.
5. **Crash reporting tool:** Sentry or Firebase Crashlytics?
6. **Final sender domain for SES:** `no-reply@matika.health`? `support@matika.in`?
7. **iOS in v2.1:** firm commit, or revisit based on beta signal?
8. ~~**Phase 2 trigger:** what specific data signals open the doctor-portal discovery window?~~ **RESOLVED 2026-05-11: GA + 8 weeks.** See §13 entry criterion.

---

## 12. Out of Scope for v2.0

- **Doctor portal, doctor onboarding, doctor-facing analytics → Phase 2** (see §13).
- iOS app reactivation (deferred to v2.1).
- Resource and package rename (`carelog-*` → `matika-*`, `com.carelog.*` → `com.matika.*`; deferred to v2.1).
- HealthLake integration.
- Multi-region active-active.
- Doctor-side mobile app.
- Patient-side dictation export to PDF.
- Family-relative read-only portal (PRD §6.X if applicable).
- Cross-language conversation (mid-session language switch).

---

## 13. Phase 2 — Doctor Onboarding (post-v2.0 GA)

**Why this is a phase, not a feature.** Putting a doctor portal in front of physicians without a clear answer to *what to show them and why* is a fast path to a half-loved product. The Phase 2 effort therefore has two halves: **(13.1) discovery** that depends on having real beta + GA data, and **(13.2) engineering** that follows from discovery.

**Entry criterion.** **GA + 8 weeks.** This is the locked trigger as of 2026-05-11 — 8 weeks of GA usage produces enough longitudinal signal across the cohort to make doctor-portal product calls evidence-based rather than speculative. Earlier discovery would be premature; later only delays the doctor-facing roadmap without proportional gain in signal quality.

### 13.1 Discovery work

This is product, design, and clinical-advisor work. Engineering supports with data extracts and dashboards.

**Questions to answer with data:**

1. **Which patients does a doctor most want to see?** Inactive (haven't logged in N days)? Out-of-range trending? Recently flagged? Newly onboarded? Likely some weighted combination.
2. **What summary card per patient is useful?** Vital ranges over time (last 7/30/90 days)? Threshold-breach frequency? Caregiver-acknowledged-alerts list? Conversation event log? Most of these are aggregations we can prototype against real beta data.
3. **What cadence?** Once-a-week digest? Daily push? On-demand pull?
4. **What's the right level of conversation-engine transparency?** Doctors will reasonably ask "what did the AI tell my patient?" — the design needs to handle that transparently without overwhelming.
5. **Recommendation UX:** how does a doctor add a parameter recommendation or threshold override? Is this a write-back into the same `parameter_configs` rows the caregiver edits? Conflict resolution?
6. **What level of clinical accountability?** Read-only dashboard vs. note-taking vs. care-plan modifications. Each level carries different regulatory and liability implications.

**Inputs to the discovery work:**

- Telemetry dashboards from §4.7 (vital coverage, conversation, alerts, drop-off).
- Direct interviews with the existing physician partners (the ones we'd have invited for v2.0 — flip the conversation: "what would actually be useful?").
- Anonymized case studies from beta cohort (with explicit consent).
- Clinical advisor input on what's defensible from a standard-of-care standpoint.

**Output:** a doctor-portal product spec — equivalent rigor to `docs/matika_prd_v2.md` for v2.0. Working title `docs/matika_prd_v2_phase2_doctor.md`.

### 13.2 Engineering scope (estimates conditional on discovery)

Once the product spec is firm, the engineering work is largely the items deferred from v2.0:

| Item | Notes |
|---|---|
| Web portal `data-testid` + Playwright stream | Same as the original §4.2 plan. ~3 days. |
| DR-V2-01..08 journey suite | Same as original §5. |
| CG-V2-10 (caregiver invites doctor) | Re-enable; needs SES sender verification (~30 min + DNS propagation) — possibly the only Phase-2 dependency that's worth doing during v2.0 if it's no-cost. |
| CG-V2-11 (remove care team member) | Depends on CG-V2-10. |
| CG-V2-14/15 (accept/reject doctor recommendation) | Depends on DR-V2-05 (web). |
| F16 fix — doctor-patients query | The query references non-existent `alert_reads` table + `alerts.deleted_at` + wrong `persona_links` columns. Mechanical fix once schema choices are confirmed. |
| New summary/aggregation services | New `patient-summary-v2` Lambda or expanded `patient-summary`. Cadence-driven aggregation jobs. |
| Doctor invite + onboarding flow | Cognito group already exists. UX flow for "invite-link → register → verify → connect to caregiver" is new. |
| Optional: HealthLake integration | If discovery surfaces a real need for FHIR-shaped queries. Engineering scope here is significant. |

### 13.3 What we should do _during_ v2.0 to make Phase 2 cheaper

1. Wire the telemetry from §4.7 from day 1 of beta.
2. Keep the doctor-related schema (Cognito group, `persona_links` doctor rows, `recommendations` table) intact — don't delete in cleanup passes.
3. Don't actively maintain the web portal but don't actively break it either. The Vite dev server building cleanly is a low-cost preservation.
4. As caregivers and patients use the app, surface (anonymously) the questions they would have wanted a doctor to answer — captured in support tickets, in-app feedback, or the WhatsApp support channel. These directly inform the Phase 2 product spec.
5. Capture explicit consent at beta signup that anonymized usage data may inform Phase 2 design — see §3.1 cohort criteria.

---

## Changelog

| Date | Author | Change |
|---|---|---|
| 2026-05-11 (1.2) | Engineering | Phase 2 entry criterion locked: **GA + 8 weeks**. Open question 8 resolved. |
| 2026-05-11 (1.1) | Engineering | **Rescoped to caregiver+patient for v2.0.** Doctor portal, doctor onboarding, and doctor-facing analytics deferred to Phase 2 (new §13). Recomputed in-scope journey count (52, was 64). Web portal stream removed from v2.0 critical path. Added §4.7 Phase 2 telemetry stream — wires data collection from day 1 of beta. Tightened T-N timeline. Updated risks (doctor stakeholder comms; data sufficiency for Phase 2). |
| 2026-05-11 (1.0) | Engineering | Initial draft. State snapshot, beta+GA criteria, work streams, T-N sequence, risks. |

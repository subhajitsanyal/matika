# Matika v2.0 Launch Plan

**Version:** 1.0
**Author:** Engineering
**Last Updated:** 2026-05-11
**Status:** Draft for review

> This plan covers the path from today's state (36 of 64 non-voice journeys PASS, F17 push transport landed, web portal blocked) to a closed beta and then GA of Matika v2.0. It is the working document — sub-plans (compliance, infrastructure, doctor-portal) hang off it as separate docs when they get fleshed out.

---

## 1. Executive Summary

**Where we are.** v2.0 is the platform shift from the v1 per-household Mac Mini stack to AWS Bedrock + on-device STT/TTS. Engineering for the patient and caregiver Android apps is **substantially complete** — 36 of 64 non-voice journeys PASS, F17 push transport works end-to-end on real hardware, all V001–V009 schema migrations are live in dev. The remaining 28 untested journeys partition into a small number of mechanical work streams (web portal data-testids, SES verification, Cognito email-intercept, backend backlog).

**Where we're going.** Two milestones:

- **M1: Closed beta** — 10 patient cohort in Bengaluru, July 2026. Android-only. Doctor portal in read-only mode if not fully tested. Bedrock quota at 50 RPM Haiku / 10 RPM Sonnet per inference profile (current dev limits). Direct-line clinical support.
- **M2: GA** — public availability for India, October–November 2026. Android + web portal (doctor-side). iOS still parked (v2.1 candidate). Public app-store listing. Capacity for 1,000 patients.

**Critical-path gates.**

1. Web portal `data-testid` + Playwright stream (unblocks 8 doctor-side journeys). Owner: `qa-testing` + `web-portal`. ~3 days.
2. SES sender verification in prod region (unblocks 2 caregiver journeys, plus all email-driven invite flows). Owner: `devops`.
3. DPDP compliance audit + signed DPA with AWS. Owner: legal.
4. Cognito drift from commit `66ca57c` applied — without this, the next non-targeted `terraform apply` will undo unrelated fixes.
5. Penetration test (third-party).
6. Beta cohort consent, onboarding scripts, support staffing.

**Out of scope for v2.0** (deferred to v2.1):

- iOS app. Parked since 2026-03-24; ship Android-only for beta and GA.
- HealthLake integration.
- The `carelog-*` → `matika-*` resource and package rename.
- Mid-session language switching.
- Reminder-config caregiver UX (F26b — needs product call on voice-only vs. manual).

---

## 2. Current State Snapshot (2026-05-11)

### 2.1 What's built and working

| Surface | State | Notes |
|---|---|---|
| Android patient app | 36/64 non-voice + 1/2 voice PASS | F17 push delivered; F23 voice patient onboarding shipped; offline-first sync via Room+WorkManager |
| Android caregiver app | Same | CG-V2-07 PASS (synthetic), CG-V2-12/17 PASS; CG-V2-08/09/E2E push transport unblocked |
| Backend (45 Lambdas) | Live in dev | All V001–V009 migrations applied; Bedrock router live; SNS Platform App provisioned |
| Web portal (doctor) | Builds + auth flow only | 3 unit tests; DR-V2-01..08 blocked on `data-testid` plumbing |
| iOS | Parked | Last modified 2026-03-24; will not ship in v2.0 |
| Infrastructure | dev, staging, prod environments exist | Staging + prod are Terraform-defined but not yet applied/smoke-tested |
| CI/CD | 7 GitHub Actions workflows | android, backend, deploy-lambdas, inference-platform, ios, run-migrations, run-tests |
| Maestro flows | 37 UI tests in `.maestro/flows/` | Covers PT-V2-* and CG-V2-* paths |

### 2.2 Open findings (carry-forward)

From `docs/testing_todos_v2.md`:

| F# | Severity | Status | Blocks |
|---|---|---|---|
| F5 | Low | Open | Maestro-run.sh ergonomics; no journey blocked |
| F7 | Medium | Open | Logcat-trigger voice orchestration (voice-side); no non-voice journey blocked |
| F8 | Informational | Open | Bedrock inference profile name divergence between spec and runtime |
| F16 | Medium | Dormant | Will bite when DR-V2-* unblocks — doctor-patients query schema mismatch |
| F26b | Medium | Product call needed | Caregiver reminder config UX — voice-only vs. manual editing? |

**Bench-blocked, no engineering work:**

| Journey | Blocker |
|---|---|
| PT-V2-06 (Bengali voice) | Mac Core Audio wedge `-66681`; reboot-only |

### 2.3 Untested journey breakdown (28 remaining of 64 non-voice)

| Category | Count | Stream owner | Estimated effort |
|---|---|---|---|
| Web portal `data-testid` + Playwright | 8 | `web-portal` + `qa-testing` | ~3 days |
| Manual / out-of-agentic-scope | 9 | `qa-testing` (human) | 1 day per batch |
| Cognito email-intercept blocked | 3 | `devops` (intercept harness) + `qa-testing` | ~1 day for harness, then run |
| Backend backlog | 3 | `inference-platform` + `qa-testing` | ~3 days |
| SES sender not verified | 2 | `devops` (verify in ap-south-1) | 30 min |
| Web/DB seeding | 2 | `qa-testing` | 1 day |
| Cost-prohibitive | 1 (PT-V2-14) | Decision: simulate or accept | 1–2 days work either way |
| Design-blocked | 1 (PT-V2-22) | Product + design | TBD |
| F26 reminders deferred | 1 (CG-V2-13) | Product decision | TBD |

Plus **organic-run E2E pushes** (CG-V2-08/09 + E2E-V2-02/03/06): transport unblocked by F17; just need a vital-log-triggered evaluate-thresholds-batch path to flip these from synthetic-PASS to organic-PASS. ~1 day of re-runs.

---

## 3. Launch Criteria

### 3.1 Closed Beta (M1, target July 2026)

**Quality gates — must all be GREEN:**

- [ ] **All Android journeys PASS:** 64/64 non-voice + 2/2 voice (Bengali requires Mac reboot first).
- [ ] **Doctor portal in usable state:** DR-V2-01 through DR-V2-06 PASS. DR-V2-07/08 (alerts views, sub-features) acceptable as KNOWN-GAP if the beta cohort doctors agree to read-only fallback.
- [ ] **No critical findings open.** F5/F7/F8 acceptable as Low/Informational; F16/F26b must have decisions and either a fix or an accepted-gap waiver.
- [ ] **Production environment soak-tested.** 1-week burn-in in staging mirroring prod config, then 1-week burn-in in prod against a synthetic patient.
- [ ] **Compliance lockdown:** DPDP audit signed off; DPA in place with AWS; privacy policy + ToS reviewed by legal; consent flow approved.
- [ ] **Penetration test passed** with no Critical or High findings open.
- [ ] **On-call rotation staffed** with a real human and an escalation tree.
- [ ] **Support tooling ready:** runbook for "patient can't log in / log a vital", access to RDS through bastion documented for support engineers, CloudWatch dashboard bookmarked.
- [ ] **Crash reporting wired** (Sentry or Firebase Crashlytics). Currently neither is configured — this is a real gap, not a checkbox.
- [ ] **Cognito drift from `66ca57c` resolved** before any non-targeted `terraform apply`.

**Cohort criteria:**

- 10 patients, all in Bengaluru / Karnataka (single-region deployment).
- Each patient paired with at least one caregiver.
- At least 2 patients with a primary care physician on the doctor portal (read-only acceptable).
- Direct WhatsApp channel to support engineering during beta.
- Explicit consent for cross-region inference (display `cross_region_disclosure_scan` Maestro flow's screen content for product review).

### 3.2 GA (M2, target October–November 2026)

**Adds on top of beta:**

- [ ] Doctor portal: DR-V2-07 and DR-V2-08 PASS (no more KNOWN-GAP waivers).
- [ ] Capacity tested to 1,000 simulated concurrent sessions against staging Bedrock quotas (request quota increase early — 1–3 day SLA at AWS).
- [ ] App store listing live (Play Store; iOS deferred).
- [ ] Self-serve onboarding flow tested with at least 20 cohort members in a public beta phase.
- [ ] Backup/restore drill: RDS PITR, S3 cross-region replication, Cognito user pool export.
- [ ] Disaster recovery runbook: regional failover plan; even if v2.0 ships single-region, document the RTO/RPO expectations.
- [ ] Cost dashboard live and tied to monthly budget alarms.
- [ ] Customer support workflow documented; ticket-to-engineer escalation path.

---

## 4. Engineering Work Streams

Streams can run in parallel; calling out dependencies inline.

### 4.1 Close out the F-number backlog

| F# | Action | Estimated effort | Blocks beta? |
|---|---|---|---|
| F5 | Make `scripts/maestro-run.sh` flags positional-independent | 30 min | No |
| F7 | Bench fix — logcat-trigger voice orchestration helper | ~2 hours | No |
| F8 | Align spec §3.3/§7.5/§14.3 to runtime `global.*` profile (or flip env to `apac.*`) | 30 min | No, but should be done before any audit |
| F16 | doctor-patients query — kill `alert_reads` join, point at `alerts` directly | ~2 hours | YES — unblocks DR-V2-01..03 |
| F26b | Product call: keep manual reminder edit UX in v2 or make voice-only? | Product+eng meeting | YES — gates CG-V2-13 |

### 4.2 Web portal: `data-testid` + Playwright stream

Single biggest unlock; unblocks 8 doctor-side journeys (DR-V2-01..08).

**Steps:**

1. Audit `web-portal/src/pages/` for `data-testid` coverage. Doctor login → patient list → patient detail → vital trends → alerts → recommendations → care plan → invite acceptance.
2. Add `data-testid` attributes following the same naming pattern as Android (`patient_list_row_<id>`, `vital_trend_card_<vital>`).
3. Wire Playwright with the existing `test-automation/` layout. Use Cognito test users seeded in dev RDS.
4. Author the 8 DR-V2-* flows.
5. Run against dev, then staging.

Owner: `web-portal` for the testids, `qa-testing` for the flows. Estimated 3 days.

### 4.3 Backend backlog

| Journey | Action |
|---|---|
| CG-V2-16 (delete patient) | Verify `delete-patient` Lambda + cascading deletes in observations/alerts/persona_links. Maestro flow covers Android UI; backend coverage already in tests. |
| EDGE-V2-08 (cross-region failover) | Build a fault-injection harness — Bedrock mock layer that returns 503 from primary region; assert client falls back to secondary inference profile. |
| EDGE-V2-09 (parse failure) | Inject malformed JSON in the structured-output return path; assert graceful fallback to T3 escalation. |

Estimated effort: 3 days for the harness, 2 days for the flows.

### 4.4 SES sender verification

`carelog-dev/no-reply@matika.health` (or whatever the prod domain ends up being) needs to be verified in SES in `ap-south-1` before invite emails fire. Two journeys (CG-V2-10/11) blocked.

Steps: choose final sender domain → DNS records → SES verification → update Terraform variable. ~30 min hands-on, ~24 hours wall-clock for DNS propagation.

### 4.5 Cognito email-intercept testing pattern

3 journeys depend on receiving an email at a test address and pulling the OTP/link. Options:

- **A:** Use a `+test` Gmail filter and a Gmail-API based test helper.
- **B:** Use AWS SES inbound rules to a test inbox in S3, poll the bucket.
- **C:** Pre-seed Cognito with `EmailVerified=true` + capture confirmation codes via Cognito's admin API in the test runner.

Recommend C — least DNS surface, least delay. Owner: `devops`. ~1 day.

### 4.6 PT-V2-22 design unblock + PT-V2-14 cost decision

- **PT-V2-22:** Specific design block — surface the open question to product. If product punts to v2.1, document the KNOWN-GAP waiver before beta.
- **PT-V2-14:** Cost-prohibitive Bedrock test (sustained Sonnet load). Either (a) accept the $50–100 cost as a one-time validation, (b) substitute with a synthetic load test against a Bedrock mock, or (c) defer to GA capacity testing. Recommend (a) — one-time live capacity validation is genuinely useful.

### 4.7 Production-strip audit of debug-only code

The F28 (EDGE-V2-14) fix is `BuildConfig.DEBUG`-gated by construction, so the release binary is already clean. Before beta, run a release-build sanity audit to catch any other accidental debug-only paths that leak into release:

- `BuildConfig.DEBUG` references in production code — verify each branch is in a debug-only code path.
- `Log.d` and `Log.v` with PHI in the message — strip or gate.
- Hardcoded test credentials, dev API URLs, `Toast.makeText` debug strings.

Probably ~1 day of greppage + review. Owner: `android-app` + security reviewer.

### 4.8 Terraform / infra cleanup

| Item | Action |
|---|---|
| Cognito drift from `66ca57c` | Apply targeted `terraform apply -target=module.cognito` against dev to land the drift; verify no auth regressions; commit state. |
| SNS Platform App import | `terraform import module.sns.aws_sns_platform_application.android_fcm <ARN>` so it's managed declaratively. |
| Staging environment first-apply | Stand up staging end-to-end. Migrate schema. Run smoke against staging Cognito + RDS + Bedrock. |
| Prod environment first-apply | After staging soak. Plan + apply + verify; then plan for empty diff before opening to beta. |
| Bedrock quota increase request | File for prod region: 100 RPM Haiku, 30 RPM Sonnet (3x dev). 1–3 day SLA. |

---

## 5. Testing Strategy → 64/64 PASS

**Approach:** drive each untested journey to PASS through the work streams in §4. Track in `docs/journeys_non_voice.md` (one row per journey, evidence cited).

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

Targeting 64/64 PASS before beta — every cell above moves to PASS by the per-row owner. Tracking spreadsheet hangs off `docs/journeys_non_voice.md`; one-line evidence per row (commit, CloudWatch link, screenshot, or runbook step).

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
| `docs/matika_prd_v2.md` | Add a §1.1 v2.0 launch scope (what ships, what doesn't); cross-reference launch plan. |
| `docs/matika_implementation_plan_v2.md` | Mark all F-number tasks complete; add the launch-plan §4 streams. |
| `docs/matika_v2_migration.md` | Add a v1→v2 migration checklist for downstream operators (delete Mac Mini code paths, what to remove). |
| `docs/privacy-policy.md` | Update for Bedrock cross-region inference disclosure; verify the in-app `cross_region_disclosure_scan` content matches the policy text. |
| **NEW** `docs/runbook_oncall_v2.md` | On-call playbook: top-10 alerts and their first 3 diagnostic steps. |
| **NEW** `docs/runbook_support_v2.md` | Support-engineer-facing runbook: common "patient can't X" scenarios + remediation. |
| **NEW** `docs/dr_runbook_v2.md` | Disaster recovery plan: RDS PITR, S3 replication, Cognito export. |
| `docs/journeys_non_voice.md` | Each row gets a row-by-row evidence link as we drive to 64/64. |
| `docs/setup-and-deployment-guide.md` | Add a `Staging` and `Production` deployment section paralleling §3.x dev. |
| `CLAUDE.md` | Add a "v2.0 launch readiness" pointer to this plan. |

### 6.3 Out-of-scope for v2.0

- HealthLake integration design (deferred to v2.1).
- iOS app docs (parked).
- Multi-region failover (single-region launch).

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

Stub timeline — adjust once owners agree:

| T- | Action | Owner |
|---|---|---|
| T-60 | Beta cohort identified; consent forms drafted | product |
| T-50 | Web portal `data-testid` stream lands; DR-V2-* journeys at PASS | web-portal + qa |
| T-45 | Staging environment stood up; 1-week soak begins | devops |
| T-38 | Pen test kicks off | security vendor |
| T-30 | All 64 non-voice + 2 voice journeys PASS in staging | qa-testing |
| T-28 | Staging soak complete; sign-off | engineering lead |
| T-21 | Production environment apply; 1-week burn-in with synthetic patient | devops |
| T-21 | Bedrock prod quotas approved | aws-vendor |
| T-14 | Pen test report received; remediations triaged | security |
| T-10 | Compliance docs frozen and signed off | legal |
| T-7 | Beta onboarding scripts, support runbook, on-call rotation final | support + eng |
| T-3 | Beta cohort onboarding begins | support |
| T-0 | Public beta opens for the cohort | product |

Slip in any single row pushes T-0 by that delta. Track in a shared launch tracker.

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bedrock quota insufficient at peak | M | H | Request 3x dev quotas early; tier 2 (Haiku) carries most load |
| FCM credential rotation requires device re-registration | L | M | Document rotation runbook; plan rotations during low-use windows |
| Cognito drift causes auth regression on next `terraform apply` | M | H | Apply targeted `terraform apply -target=module.cognito` before any other infra change |
| Doctor portal stream slips | M | M | Beta with read-only doctor view; defer DR-V2-07/08 to GA |
| iOS gap surfaces market resistance | L | M | Communicate Android-only positioning early; v2.1 iOS roadmap |
| DPDP audit finds material gaps | L | H | Engage counsel early; budget for remediation cycle |
| Voice testing on Bengali stays bench-blocked | L | L | Reboot Mac before each voice sweep; document command |
| Pen test surfaces a Critical | M | H | Budget 2-week remediation window; gate beta on no-Critical-open |
| Beta cohort identifies a UX-breaking bug | H | M | WhatsApp channel + ability to hotfix Android via FCM-side-channel push of a Play Store update notice |
| Support tooling missing at launch | M | H | Build runbooks in §6.2 before T-7 |

---

## 11. Open Questions

These need product/leadership decisions before plan execution:

1. **Beta region:** Bengaluru-only? Or wider Karnataka? Or all India?
2. **Beta cohort size:** 10 is the target — flex to 5 or 20?
3. **Doctor portal at beta:** required, or KNOWN-GAP read-only fallback acceptable?
4. **F26b reminder UX:** keep manual editing in v2.0, make voice-only, or skip reminders for beta?
5. **PT-V2-22 design:** unblock before beta or accept as KNOWN-GAP?
6. **Crash reporting tool:** Sentry or Firebase Crashlytics?
7. **Final sender domain for SES:** `no-reply@matika.health`? `support@matika.in`?
8. **iOS in v2.1:** firm commit, or revisit based on beta signal?

---

## 12. Out of Scope (Defer to v2.1)

- iOS app reactivation.
- Resource and package rename (`carelog-*` → `matika-*`, `com.carelog.*` → `com.matika.*`).
- HealthLake integration.
- Multi-region active-active.
- Doctor-side mobile app.
- Patient-side dictation export to PDF.
- Family-relative read-only portal (PRD §6.X if applicable).
- Cross-language conversation (mid-session language switch).

---

## Changelog

| Date | Author | Change |
|---|---|---|
| 2026-05-11 | Engineering | Initial draft. State snapshot, beta+GA criteria, work streams, T-N sequence, risks. |

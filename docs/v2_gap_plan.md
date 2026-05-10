# Matika v2 — Consolidated gap list + phased plan

**Date:** 2026-05-10 (Phase 1 closed; Phase 2 substantially closed)
**Source sweeps:** non-voice `20260509_endofday` + voice `20260510_voice_sweep`.
**Snapshot:** 19 of 71 journeys verified end-to-end (15 non-voice + 4 voice); +12 journeys flipped from "architecture-blocked" to "route-reachable" (F4 Path A: 11 + F25: EDGE-V2-17); +1 journey to "functional end-to-end" (CG-V2-12 via F26). 4 fully-open findings; 29 resolved + 2 partially resolved (F17, blocked on FCM service-account JSON; F26 thresholds done, reminders deferred).

**Phase 1 progress (this session):** F19, F18, F1, F2, F17 (Android+backend halves) closed and verified live. **Phase 2:** F4 Path A closed (patient vital tile grid + caregiver Manage section wired and smoke-tested), F25 closed (SttManager online fallback subsumes F24), F22 closed (in-UI Language picker on SettingsScreen replaces the DataStore-protobuf adb hack for multilingual testing). **F26:** caregiver ThresholdConfigScreen + TrendsScreen repointed at v2 `parameter_configs` (the table `evaluate-thresholds-batch` actually reads); CG-V2-12 functional end-to-end with edit+save round-trip verified live. ReminderConfigScreen UX redesign deferred to product (CG-V2-13).

**Remaining for full pilot push delivery:** provision SNS Platform Application for Android FCM (devops, requires Firebase service-account JSON; pure infra flip — no engineering rework). See per-finding entries in `docs/testing_todos_v2.md` for live-verification evidence.

This file collates all open findings from `docs/testing_todos_v2.md` and the per-sweep reports, ranks them by severity, and lays out a phased implementation plan ordered by **journeys-unblocked-per-day** leverage. Update the per-finding detail in `testing_todos_v2.md`; this file is the high-level plan.

---

## Open findings by severity

| Sev | # | Title | Class | Journeys it blocks | Owner | Effort |
|---|---|---|---|---|---|---|
| **HIGH** | F19 | bedrock-router crashes on Bedrock Guardrail intervention (HTTP 500 instead of `blocked_input_messaging`) | Bug — user-facing | EDGE-V2-03; every guardrail-blocked utterance in prod | backend | 1-2h |
| **HIGH** | F17 | Push transport not provisioned: no SNS Platform Apps, no `IOS/ANDROID_PLATFORM_ARN` env, no `endpoint_arn` column, Android never registers FCM token | Infra gap | CG-V2-07/08/09, E2E-V2-02/03/06 (5 journeys backend-half PASS, never reach phone) | devops + android-app + product | ~1 day |
| **HIGH** | F18 | Cross-region inference disclosure missing on register screen (DPDP Act / HIPAA compliance) | Compliance | EDGE-V2-16; pilot can't legally ship without it | android-app + product/legal | ~1h once copy approved |
| **MED-HIGH** | F4 | Orphan v1 vital screens + RelativeDashboardScreen + ThresholdConfig + ReminderConfig + TrendsScreen unreachable from v2 nav | Architecture decision | PT-V2-15..21, EDGE-V2-14, CG-V2-12/13/17 (**12 journeys**) | product (decision) + android-app | 1d either path |
| **MED** | F2 | `interaction_sessions` never marked complete; rows stay `status='in_progress'` indefinitely | Observability/data integrity | session-terminus telemetry + reliable session reuse | backend + android-app | ~1d |
| **MED** | F1 | `users.last_login_at` never updated post-login | Telemetry | login dashboards stale | backend | 0.5d |
| **MED** | F25 | `SttManager` doesn't implement online STT fallback when offline pack missing — surfaces hard error instead | Code gap | EDGE-V2-17 (also subsumes F24) | android-app | ~2-3h |
| **MED** | F22 | No UI exposes `AppLanguage`; patient session always seeds en-IN | UI gap | PT-V2-05 (Hindi), PT-V2-06 (Bengali) require DataStore hack today | android-app | ~2h |
| **MED** | F23 | No "Add Patient via Conversation" entry in caregiver UI | UI gap or doc reclassify | CG-V2-04 | android-app + product | ~1d (UI) or ~30min (reclassify) |
| **LOW-MED** | F3 | `create-patient` masks `UsernameExistsException` as 500 instead of 409 with actionable message | UX bug | CG-V2-02 error path | backend | 1h |
| **LOW** | F16 | `doctor-patients` SQL references dropped `alert_reads` table + `alerts.deleted_at` + wrong `persona_links` columns | Bug — dormant | DR-V2-* (already blocked on web data-testid + Playwright) | backend | 30min mechanical |
| **LOW** | F24 | Soda bn-IN offline pack absent on test device | Device config | PT-V2-06 — fully subsumed by F25 fix | qa-testing or via F25 | manual install OR F25 |
| **INFO** | F8 | Bedrock inference-profile name divergence (`global.*` deployed vs `apac.*` documented) | Spec/code drift | none directly; doc accuracy | devops or doc owner | 30min |

**Already resolved this cycle** (referenced for context, no work remaining): F5 (maestro args), F6 (vacuous voice assertion), F7 → F20 (logcat trigger), F9 (STT result routing), F10 (FSM allowlist), F11–F15 (V001 partial-migration cluster), F21 (wedged say queue).

**Adjacent test-infrastructure gaps** that aren't F-numbered but block journey throughput:
- Web portal `data-testid` + Playwright runner (8 DR-V2-* journeys)
- Push UI-receipt verification harness (subsumed by F17)
- Caregiver management Maestro flows CG-V2-10..18 (13 journeys, mechanical)
- Edge fault-injection harness (~5 EDGE journeys)

---

## Phased plan

Each phase is ordered by **leverage** (journeys-unblocked-per-day). Phase 1 is hard-stops for pilot; Phases 2-4 are coverage expansion.

### Phase 1 — Compliance + critical user-facing bugs (3-5 days, 1 sprint)

*Cannot ship pilot without these. F19 + F18 are hard-stops; F17 ships alerts to nowhere.*

| Step | Owner | Effort | Unlocks |
|---|---|---|---|
| F19: bedrock-router parser handles `amazon-bedrock-guardrailAction` short-circuit + unit test | backend | 1-2h | EDGE-V2-03 PASS; prod no-longer-500s on blocked content |
| F18: RegisterScreen disclosure copy + testTag | android-app + legal | ~1h Android once copy lands | EDGE-V2-16 PASS; pilot legally shippable |
| F1: post-authentication Cognito trigger writes `users.last_login_at = NOW()` | backend (Terraform + Lambda) | 0.5d | Login telemetry, regression guard |
| F2: app-side `POST /sessions/{id}/end` on terminal action + EventBridge cron sweeps stale rows to `terminal_incomplete` | backend + android-app | ~1d | Session-state observability; safe session reuse |
| **F17: provision push transport (SNS Platform Apps + endpoint_arn column + device-token Lambda fix + Android FCM registration)** | devops + android-app | ~1d | **5 journeys flip backend-half → full PASS** (CG-V2-07/08/09, E2E-V2-02/03/06) |

**Phase 1 unlocks: ~5 journeys + compliance + 2 telemetry holes closed.**

---

### Phase 2 — Architecture decision + voice infrastructure (1 week)

*F4 is the single biggest journey-unblocker in the catalog. Voice gaps land here too.*

| Step | Owner | Effort | Unlocks |
|---|---|---|---|
| **F4: product decision (Path A wire orphan screens vs Path B delete) + execute chosen path** | product (decision) + android-app | 1d either path | **12 journeys** (PT-V2-15..21, EDGE-V2-14, CG-V2-12/13/17) |
| F25: `SttManager.recognize` retry-without-PREFER_OFFLINE on `onError(12)` + `stt_offline_used` telemetry | android-app | 2-3h | EDGE-V2-17 PASS; F24 subsumed; PT-V2-06 unblocked once F22 lands |
| F22: language picker on PatientHomeScreen / SettingsScreen (or DEBUG-only adb broadcast) | android-app | 2h | PT-V2-05 / PT-V2-06 testable without DataStore-protobuf hacks |
| F23: choose — wire `PatientOnboardingConversationScreen` to a CaregiverHomeScreen action OR reclassify CG-V2-04 in journey doc | product + android-app | 1d (UI) or 30min (reclassify) | CG-V2-04 |
| F16: rewrite `doctor-patients` SQL to live schema (mechanical) | backend | 30min | unblocks DR-V2-* the moment Phase 3 web portal lands |

**Phase 2 unlocks: ~15 journeys.**

---

### Phase 3 — Test infrastructure unlocks (1-2 weeks)

*Mechanical work that converts paper-classified blockers into runnable journeys.*

| Step | Owner | Effort | Unlocks |
|---|---|---|---|
| Web portal `data-testid` audit on LoginPage / PatientListPage / PatientViewPage / DoctorRegistrationPage | web-portal | 0.5d | DR-V2-* preconditions |
| `web-portal/scripts/run-journey.mjs` Playwright runner + `.agents/web-journey-runner.md` agent spec | web-portal + qa-testing | 1d | **8 DR-V2-* journeys** runnable |
| Caregiver management Maestro flows CG-V2-10..18 (mechanical, 9 flows) | qa-testing | 2d | up to 9 journeys (some require email/SES seeding which may push later) |
| Trivial edge-input flows (EDGE-V2-04..07 input-validation, network-cycle, mic-permission, session-resume) | qa-testing | 1-2d | ~4-6 journeys |
| F3: `create-patient` returns 409 with actionable copy on `UsernameExistsException` | backend | 1h | CG-V2-02 error path |
| F8: align spec docs with `global.*` Bedrock profile name | docs | 30min | no journey impact, doc accuracy |

**Phase 3 unlocks: ~17-20 journeys + cleanup.**

---

### Phase 4 — Long-tail & out-of-scope (2-3 weeks, can run in parallel with Phase 3)

| Step | Owner | Effort | Unlocks |
|---|---|---|---|
| Edge fault-injection harness (Bedrock parse-failure mock, cross-region failover, Guardrail synthetic) | inference-platform + qa-testing | 1 week | EDGE-V2-08/09, plus regression coverage |
| Photo-OCR manual smokes (PT-V2-10/11/12) — runbook + per-deploy gate | qa-testing + manual | ad hoc | 3 journeys |
| Long-tail JWT/idle/pause/fresh-install runs (EDGE-V2-05/06/10/12) — scheduled jobs | qa-testing | 1d setup, then scheduled | ~4 journeys |
| Multi-turn voice acoustic tuning (F6 residual): boost speaker, longer confirmation utterances, OR switch confirmations to text fallback per journey | qa-testing + android-app | 2-3 days | PT-V2-04 multi-turn → full PASS; CG-V2-03 multi-turn |

**Phase 4 unlocks: ~10 journeys + reliability.**

---

## End-state projection

| State | Journeys |
|---|---|
| Today (post 2026-05-10 voice sweep) | 19 of 71 (15 non-voice + 4 voice) verified end-to-end |
| Post-Phase 1 | +5 → ~24 of 71; **pilot becomes shippable** (compliance + push) |
| Post-Phase 2 | +15 → ~39 of 71; voice + orphan-screen coverage unblocked |
| Post-Phase 3 | +17-20 → ~58 of 71; web portal + caregiver mgmt + edge inputs runnable |
| Post-Phase 4 | +10 → ~68 of 71; remaining ~3 are deliberate out-of-scope per PRD §12 |

**Critical path is Phase 1 — five small fixes flip "demo-ready" to "pilot-ready."** F4 is the single biggest leverage point but needs a product decision, not engineering work, so it sits at the head of Phase 2.

---

## How to use this file

- **Per-finding detail** (reproduction steps, code locations, fix sketches, verification logs) lives in `docs/testing_todos_v2.md`. Update there as findings change state.
- **Per-journey status** (PASS / blocked-on / last evidence) lives in `docs/journeys_non_voice.md` + `docs/journeys_voice.md`. Refresh after each sweep.
- **This file** is the planning view. Update when phases complete or new findings arrive that change phase ordering.

*Last updated: 2026-05-10 after voice sweep `20260510_voice_sweep`.*

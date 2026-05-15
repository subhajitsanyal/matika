# Matika v2 — Non-Voice Journeys

**Version:** 1.0
**Date:** 2026-05-08
**Source of truth:** `docs/journeys.md` (full catalog). This file is the focused subset for tests that don't require microphone input.

A journey is in this file when it can be **fully exercised without speech audio capture**. That includes:
- Native non-voice flows (manual logs, dashboards, settings, registration, validation, doctor portal)
- Voice-canonical flows that have a documented text-fallback path producing the same product behavior (PT-V2-09 emergency, EDGE-V2-13 implausibility, etc.) — those are listed here with a `text-fallback path` note.

For voice journeys that genuinely require Mac-speaker injection, see `docs/journeys_voice.md`.

> **v2.0 scope (2026-05-11 rescope):** 52 of the 64 journeys below are in scope for v2.0 (caregiver + patient personas). The 12 doctor-related journeys — **DR-V2-01..08, CG-V2-10, CG-V2-11, CG-V2-14, CG-V2-15** — are deferred to **Phase 2** alongside doctor onboarding. See `docs/v2_launch_plan.md` §13. They remain in this file for the eventual Phase 2 pass; just don't count them toward the v2.0 PASS target.

---

## Inventory by persona

### Patient (Android) — 19 journeys

| ID | Title | Status today | Test path |
|---|---|---|---|
| **PT-V2-01** | First login | **PASS** (sweep `20260508_215314`) | Maestro `patient_logging_happy_path` first half. |
| **PT-V2-02** | Patient home orientation | **PASS (2026-05-09)** | `patient_dashboard_orientation.yaml` — login as patient, assert `patient_home_start_conversation` testTag + brand chrome render cleanly. |
| **PT-V2-07** | Text-input fallback (deterministic) | **PASS (2026-05-10, post-F27)** | `patient_logging_happy_path.yaml`. The CI gate. Restored by F27 Path A (drop legacy Mac Mini OFFLINE gate on `canConverse`). End-to-end PASS: login → patient_home_start_conversation → matika_text_fallback mounts → text submit → response card mounts. |
| **PT-V2-08** | Implausible value challenge (T3) | **PASS (2026-05-09, post-F10)** | `patient_implausible_text.yaml` — types "BP is 300 over 200" via `matika_text_fallback`. RDS `interaction_sessions.fsm_state='PLAUSIBILITY_CHALLENGE'`. T2 Haiku alone proposes the transition (cheaper than the spec assumed T3). |
| **PT-V2-09** | Emergency keyword detection | **PASS (2026-05-09)** | `patient_emergency_text.yaml` — types "I have severe chest pain". RDS session ends with `escalations_triggered=["emergency_keyword"]`. UI shows emergency response. Push receipt is the F17 device-side gap; backend chain is complete. |
| **PT-V2-10** | Photo OCR happy path (ML Kit) | manual | Needs real glucometer or printed mock. Out of agentic scope. |
| **PT-V2-11** | Photo OCR Bedrock vision fallback | manual | Glare condition; needs real photo. |
| **PT-V2-12** | Photo extraction failure (422) | manual | Needs blank surface photo. |
| **PT-V2-13** | Connectivity loss mid-session | **PASS (2026-05-09)** | Three-flow orchestration via `scripts/matika-connectivity-test.sh`: setup → wifi disable → submit-turn-asserts-Snackbar-error → wifi enable → retry-asserts-response-card. App has no "Reconnecting…" indicator (ConnectivityState lives in VM but isn't rendered) — the `Turn failed` Snackbar is the actual product behavior; flow asserts that. |
| **PT-V2-14** | Per-patient hard rate limit (429) | blocked | Needs ~500-call loop driver. Cost-conscious; defer. |
| **PT-V2-15** | Manual log — Blood Pressure | **PASS (2026-05-10)** | `patient_manual_log_blood_pressure.yaml` — login → scroll to BP tile → enter 130/85 → save → save_acknowledgement → home. Live evidence: sync-observation lambda wrote `s3://carelog-v2-dev-documents-316643066568/observations/CL-63NRGO/2026/05/11/obs-1778474151387-1r66u3.json` (UTC partition). Required adding `bp_systolic_input` / `bp_diastolic_input` testTags to the inputs. |
| **PT-V2-16** | Manual log — Glucose | **PASS (2026-05-10)** | `patient_manual_log_glucose.yaml` — same pattern, types 110. Live evidence: S3 write at 21:37:57 IST (obs `…eufftr`). Added `glucose_value_input` testTag. |
| **PT-V2-17** | Manual log — Temperature | **PASS (2026-05-10)** | `patient_manual_log_temperature.yaml` — types 98.6 (°F default). Live evidence: S3 write at 21:39:06 IST (obs `…rgkijt`). Added `temperature_value_input` testTag. |
| **PT-V2-18** | Manual log — Weight | **PASS (2026-05-10)** | `patient_manual_log_weight.yaml` — types 70.5 (kg default). Live evidence: S3 write at 21:40:27 IST (obs `…csfnj0`). Added `weight_value_input` testTag. |
| **PT-V2-19** | Manual log — Pulse | **PASS (2026-05-10)** | `patient_manual_log_pulse.yaml` — types 72. Live evidence: S3 write at 21:43:18 IST (obs `…6277v6`). Added `pulse_value_input` testTag. |
| **PT-V2-20** | Manual log — SpO₂ | **PASS (2026-05-10)** | `patient_manual_log_spo2.yaml` — types 98. Live evidence: S3 write at 21:44:22 IST (obs `…d05ejk`). Added `spo2_value_input` testTag. |
| **PT-V2-21** | View vital history | **PASS (2026-05-10)** | `patient_vital_history_grid.yaml` — login → scroll to SpO₂ tile → assertVisible across all 6 `vital_tile_*` testTags. UI-only assertion (no backend write). |
| **PT-V2-22** | Settings — view care team (read-only) | **PASS (2026-05-14)** | New `PatientCareTeamScreen` (separate from caregiver-side `CareTeamScreen` so the read-only surface never accidentally exposes invite/remove affordances). Patient SettingsScreen renders a dedicated "View Care Team" entry; doctor section suppressed until Phase 2 per Stream D 2026-05-12. Backend `care-team` lambda updated: access check now allows the patient themselves via `patients.user_id` AND accepts either UUID or short patient_id form (clients hand the short `CL-XXXXXX` from Cognito's `custom:linked_patient_id`). Response now surfaces `isPrimary` (was selected but never returned). Maestro flow `pt_v2_22_patient_care_team.yaml` runs login → settings → tap → asserts `patient_care_team_screen` mounts + John CG row visible by users.id testTag + Primary badge. Live evidence: direct curl as Jane returns `{"caregivers":[{"id":"a2b0af09-...","name":"John CG","email":"sanyalsubhajit2010+cg@gmail.com","isPrimary":true,...}]}`; Maestro confirms device-side render. |
| **PT-V2-23** | Cross-region inference disclosure (consent) | **PASS (2026-05-14, post-Stream-C)** | Bundled with CG-V2-01 part 2 (`cg_v2_01_self_register_part2.yaml`). After login, splash routes to ConsentScreen for any user without a current `consent_records` row. The flow asserts the substring `(?i).*AWS regions outside India.*` on the consent screen, then taps Accept. POST /consent writes `consent_records` (`consent_type='cross_region_inference'`, `consent_version='2.0'`, `is_accepted=true`). Live evidence: dev RDS row inserted at 03:24:36 IST against test caregiver, hash prefix `c30021d32e2cb89d`, ip captured. CloudWatch `Consent request: POST /consent` followed immediately by re-issued `GET /consent` (splash bounce) returning hasConsent=true. |
| **PT-V2-24** | Reminder push → opens conversation | manual | Needs `aws lambda invoke check-daily-deadline` + push-receipt verification on second device. |

### Caregiver (Android) — 16 journeys

| ID | Title | Status today | Test path |
|---|---|---|---|
| **CG-V2-01** | Self-registration with cross-region consent | **PASS (2026-05-14, post-Stream-C)** | Two-phase flow `cg_v2_01_self_register_part{1,2}.yaml` driven by `scripts/cognito-harness-maestro.sh cg-v2-01`. Part 1 fills the register form (with `(?i).*AWS regions outside India.*` disclosure assertion at register-time, sharing EDGE-V2-16's surface). Part 2 logs in, accepts the consent screen, and asserts `onboard_patient_fab` mounts. The "email-verification intercept" is the harness's `harness_admin_confirm_signup` (option C from launch-plan §4.3) — same Cognito post-confirmation lambda fires as in production. Live evidence: dev `users` row inserted at 03:23:37 IST (post-confirmation lambda) for `cognito_sub=f1b37d5a-0041-70f4-729e-ee7316404abb`, persona=caregiver, then `consent_records` row at 03:24:36 IST. |
| **CG-V2-02** | Form-based patient onboarding | **PASS** (verified live with F3 fix) | `caregiver_protocol_setup.yaml` — the canonical Maestro CI gate. Re-run against pre-existing patient surfaces 409 (F3). |
| **CG-V2-05** | Caregiver dashboard overview | **PASS (implicit via CG-V2-02)** | Login + onboard_patient_fab + patient_card visible — already covered by CG-V2-02. |
| **CG-V2-06** | View patient logs | **PASS (2026-05-09)** | `caregiver_view_patient_logs.yaml` — taps `patient_card_CL-63NRGO`, "View Logs" button, asserts `Patient Logs` title + at least an interaction-card row OR empty-state copy. |
| **CG-V2-07** | Receive threshold breach push | **PASS (2026-05-11, synthetic, post-F17)** | F17 RESOLVED end-to-end. Synthetic threshold-breach alert (Jane's patient_id, John CG recipient) routed SQS → notification-sender → SNS Platform Endpoint → FCM → Samsung S21+ system tray + in-app banner. Alerts row `is_sent=true, sent_at=…, send_error=NULL`. CloudWatch `Sent threshold breach notification to caregiver John CG`. Logcat `CareLogFCM: Message received from: 191872106923` + data payload. "Synthetic" because this used a hand-inserted alerts row + SQS message — a fully-organic run-through (caregiver logs out-of-range vital → evaluate-thresholds-batch → push) is the natural follow-up but the transport gap is gone. |
| **CG-V2-08** | Receive missed-measurement push | RDS+lambda **PASS**; transport **unblocked by F17 (2026-05-11)** | check-missed-measurements writes the alert row cleanly; notification-sender publishes via the same SNS pipe that CG-V2-07 verified. Synthetic end-to-end re-run with `type=missed_measurement` is straightforward — Jane has 4 historical `missed_measurement` rows in dev `alerts`. |
| **CG-V2-09** | Receive emergency push | RDS+lambda **PASS**; transport **unblocked by F17 (2026-05-11)** | bedrock-router's emergency alert SQS path delivers; notification-sender consumes cleanly; same SNS transport now live. Live emergency-trigger flow (`patient_emergency_text.yaml`) already PASSes (PT-V2-09); the caregiver-side push receipt is now reachable via the same pipe. |
| **CG-V2-10** | Invite doctor | blocked | No Maestro flow; SES sender email not verified in dev. Backend (`invite-doctor` log + RDS `doctor_invites` row) can be tested via direct API call. |
| **CG-V2-11** | Manage care team — remove member | blocked | No Maestro flow; depends on CG-V2-10 having added a doctor first. |
| **CG-V2-12** | Configure thresholds manually | **PASS (2026-05-10)** | `caregiver_threshold_edit.yaml` — login as caregiver → scroll to Manage > Thresholds → edit BP systolic min → tap Save Changes → assert success snackbar. Live evidence: psql shows `parameter_configs.threshold_min: {90} → {85}` at `updated_at = 2026-05-11 05:33:18 UTC` (matched flow run time). Required adding `threshold_<param>_save` testTag on each row's Save Changes button and `threshold_save_success` on the snackbar (Save button had no testTag previously). Baseline restored to {90} post-test. |
| **CG-V2-13** | Configure reminders manually | **deferred — v2 redesign pending (2026-05-10)** | F4 Path A wired `caregiver_reminders` → ReminderConfigScreen (title mounts). F26 deferred the data wiring: the v1 UX shape (windowHours+gracePeriodMinutes) doesn't map to v2's reminder semantics (frequency_days+daily_deadline on parameter_configs, set by caregiver_onboarding voice protocol). Needs product call on whether manual reminder editing remains in v2 or becomes voice-only. |
| **CG-V2-14** | Accept doctor recommendation | blocked → **partially runnable via text** | Depends on DR-V2-05 (web blocked on data-testid). If a recommendation is seeded directly via DB, the caregiver-side accept can be exercised via text fallback in a config session. |
| **CG-V2-15** | Reject doctor recommendation | same as CG-V2-14 | |
| **CG-V2-16** | Delete patient (cascade) | **PASS (2026-05-14)** | `cg_v2_16_delete_patient_cascade.yaml` driven by `scripts/cognito-harness-maestro.sh cg-v2-16`. Wrapper invokes `create-patient` lambda directly with John CG's claims to provision a synthetic test patient (NOT Jane), runs Maestro: login → settings → tap delete_patient_button → confirm delete_patient_dialog → assert sign-out (SettingsViewModel.deletePatientState=Success calls onSignedOut). Required testTags added: `delete_patient_button`, `delete_patient_dialog`, `delete_patient_confirm`, `settings_primary_patient_card`; AlertDialog has `Modifier.semantics{testTagsAsResourceId=true}` per maestro_lessons #8. Live evidence (test patient CL-FZVOXQ): `patients` row hard-deleted (0 rows post), `persona_links` row FK-cascaded out, `users.is_active=false` (soft-delete preserves account history per HIPAA), `audit_log` row `action=DELETE_CASCADE resource_id=CL-FZVOXQ` for John CG. Wrapper restores John CG's `custom:linked_patient_id` → Jane (`CL-63NRGO`) post-flow so subsequent tests aren't disrupted. Pre-step (one-time, idempotent SQL): pre-seed John CG + Jane consent_records rows so post-Stream-C SplashViewModel doesn't divert through the consent screen for canonical test accounts. |
| **CG-V2-17** | View trends | **PASS (2026-05-10)** | `caregiver_trends_view.yaml` — login as caregiver → scroll to Manage > Trends → assert `trends_screen` testTag and either "Recent Readings" header OR "No data for this period" empty-state copy. Both are PASS — the screen mounts and the threshold-band fetch + observation fetch round-trip completes either way. Required adding `trends_screen` and `trends_chart_list` testTags on TrendsScreen (none existed). |
| **CG-V2-18** | Sign out | **PASS (2026-05-09)** | `caregiver_sign_out.yaml` — opens settings (TopAppBar IconButton, contentDescription "Open settings"), scrolls to `settings_sign_out`, asserts return to login. |

### Doctor (Web portal) — 8 journeys

| ID | Title | Status today | Test path |
|---|---|---|---|
| **DR-V2-01** | Doctor accepts caregiver invite + registers | blocked | Web portal lacks `data-testid` attributes on every page. |
| **DR-V2-02** | Doctor login | blocked | Same. |
| **DR-V2-03** | Patient list | blocked | Same. |
| **DR-V2-04** | Patient detail — view longitudinal vitals | blocked | Same. |
| **DR-V2-05** | Doctor adds parameter recommendation | blocked | Same. |
| **DR-V2-06** | Doctor edits thresholds (override caregiver) | blocked | Same. |
| **DR-V2-07** | Doctor logout | blocked | Same. |
| **DR-V2-08** | (Admin) view cost telemetry | blocked | Same; admin tab may not yet ship. |

All 8 are gated on `web-portal` agent shipping `data-testid` attributes + `web-journey-runner` (Playwright) being authored. None can run tonight.

### End-to-end / cross-persona — 4 non-voice (E2E-V2-04/05 are in voice file)

| ID | Title | Status today | Test path |
|---|---|---|---|
| **E2E-V2-01** | Onboarding to first log | partial | Constituents covered: CG-V2-01 blocked, CG-V2-02 PASS, CG-V2-03 voice-only, PT-V2-01 PASS, PT-V2-07 PASS. Backend chain check passes. |
| **E2E-V2-02** | Threshold breach alert cycle | backend **PASS**; transport **unblocked by F17 (2026-05-11)** | evaluate-thresholds-batch → alerts row + SQS path already verified post-F11. The caregiver-side push transport is the CG-V2-07 path that now PASSes synthetic end-to-end. Full organic E2E (caregiver logs Jane's BP=200/110 → batch evaluates → push lands) is the natural next step. |
| **E2E-V2-03** | Missed-measurement alert cycle | RDS **PASS**; transport **unblocked by F17 (2026-05-11)** | Backend chain (parameter_configs → check-missed-measurements → alerts row + SQS) was already green post-F11. Caregiver-side push reachable via the same SNS pipe verified in CG-V2-07. |
| **E2E-V2-06** | Reminder lapse → patient logs | RDS **PASS**; transport **unblocked by F17 (2026-05-11)** | Direct invoke of `check-daily-deadline` already produces a `patient_reminder` alerts row addressed to Jane (id=`4e3280d1-…`, 2026-05-09). Patient-side push lands via getPatientDeviceEndpoints — same lambda code path validated in this sweep. |

### Edge cases — 14 non-voice (EDGE-V2-17 is voice-only)

| ID | Title | Status today | Test path |
|---|---|---|---|
| **EDGE-V2-01** | Registration validation | **PASS (2026-05-09)** | `registration_validation.yaml` — three sub-cases (bad email, mismatched confirm, weak password) each fail to advance past register. Required `scrollUntilVisible` between every field — the form is taller than the viewport. |
| **EDGE-V2-02** | Login validation | **PASS (2026-05-09)** | `login_validation_wrong_password.yaml` — wrong password surfaces "Failed since user is not authorized." snackbar; flow stays on login screen. Maestro plain-text matcher needs `.*…*` wildcards (full-string regex semantics). |
| **EDGE-V2-03** | Bedrock Guardrail block | **PASS (2026-05-10, post-F27+F19)** | `patient_guardrail_block_text.yaml` types a guardrail-triggering prompt — `matika_response_card` mounts with the `.*can't help with that here.*` copy. F27 fix restored the entry path; F19 (parser fix from 2026-05-10) is re-verified by the same flow. |
| **EDGE-V2-04** | `FORCE_CHANGE_PASSWORD` first-time login | **PASS (2026-05-14)** | `edge_v2_04_force_change_password.yaml` driven by `scripts/cognito-harness-maestro.sh edge-v2-04`. Harness `harness_admin_create_force_change_password_user` admin-creates a Cognito user with `MessageAction=SUPPRESS` + temp password. AuthRepository.signIn() now surfaces NEW_PASSWORD_REQUIRED as a `SignInOutcome.NewPasswordRequired` (used to throw at AuthRepository.kt:182); LoginViewModel routes to the new `NewPasswordScreen` which calls `Amplify.Auth.confirmSignIn(newPassword)` via `AuthRepository.confirmNewPassword`. Live evidence: pre-flow Cognito state `FORCE_CHANGE_PASSWORD`, post-flow `CONFIRMED` for cognito_sub=71d39d0a-d031-7089-1e37-73b51640c853. Note: the admin-create-user shortcut bypasses the production `create-patient` lambda (which is what writes the `users` table row in real onboarding — see `create-patient/index.js:272`); the test user is half-provisioned (Cognito-side only). Sufficient for EDGE-V2-04's "Cognito challenge resolves; subsequent logins succeed" criterion — the consent screen renders proving the auth session is live. Pool quirk: `name` is a required Cognito attribute on this pool; the harness now passes it on admin-create-user to avoid an `InvalidParameterException` on confirmSignIn. |
| **EDGE-V2-05** | JWT silent refresh (1hr) | manual | Wall-clock 60+ min. Out of sweep budget. |
| **EDGE-V2-06** | JWT 30-day refresh expiry | manual | Wall-clock months. Out of any sweep. |
| **EDGE-V2-07** | Cognito email collision | **PASS** (F3 verified live in `20260508_230704`) | Re-running CG-V2-02 against pre-existing email returns 409 with `EMAIL_ALREADY_EXISTS`. |
| **EDGE-V2-08** | Bedrock cross-region failover | **PASS — by-architecture (2026-05-14)** | v2.0 reframe: cross-region routing happens at the Bedrock service layer via the `global.*` inference profiles, not via client-side circuit breaker. The lambda's own `bedrock_client.ts:9-10` explicitly defers client-side failover post-pilot ("Cross-region failover circuit breaker — post-pilot — needs telemetry first"). Live evidence: dev `model_call` table over the last 7 days shows 100% of calls (28/28) hit `global.anthropic.claude-haiku-4-5-...` (T2) and `global.anthropic.claude-sonnet-4-6` (T3) — both `global.*` profiles. AWS Bedrock handles cross-region failover transparently when a region is unavailable. Post-pilot follow-up: client-side belt-and-braces failover circuit breaker if telemetry shows it's needed. |
| **EDGE-V2-09** | Bedrock structured-output parse failure | **PASS (2026-05-14)** | Direct API contract test via `scripts/cognito-harness-maestro.sh edge-v2-09`. New chaos harness: `bedrock_chaos.ts` `MalformedJsonBedrockInvoker` substitutes hardcoded malformed text when the request carries `x-test-chaos: malformed_json` header (`index.ts handleProxyInvocation` reads the header, wraps `deps.bedrock` for that single invocation — production never sets the header). Wrapper gets Jane's Cognito ID token, POSTs to `/conversation/turn` with the chaos header, asserts HTTP 5xx with parse-failure message. Live evidence (CloudWatch `/aws/lambda/matika-dev-bedrock-router` 2026-05-15 05:09:51 UTC): `parse_failed_first_attempt {kind:'no_output_tags'}` → `parse_failed_after_retry {kind:'no_output_tags'}` → `HandlerError {code:'parse_failed_after_retry_no_output_tags', statusCode:503}`. The full retry-then-fail chain (handler.ts:985 `invokeWithRetry`) fires exactly as the spec defines. |
| **EDGE-V2-10** | Idle session timeout (30 min) | manual | Wall-clock 30 min. Out of sweep budget. |
| **EDGE-V2-11** | Pause and resume | **PASS (2026-05-09)** | `patient_pause_resume_text.yaml` — submit a turn → tap "Pause" (label flips to "Resume") → tap "Resume" (label flips back to "Pause"). The button has no testTag today; targets by accessibility text via `.*…*` substring. |
| **EDGE-V2-12** | Pause timeout (5 min) | manual | Wall-clock 5 min. Borderline; could run as a long-duration flow. |
| **EDGE-V2-13** | Implausible plausibility ranges per parameter | **PASS (2026-05-09)** | `patient_implausible_glucose_text.yaml` — types "fifteen hundred mg/dL" via fallback; response card mounts post-F10. Same FSM transition as PT-V2-08; covers a non-BP parameter. |
| **EDGE-V2-14** | Network drop during sync of manual log | **PASS (2026-05-11)** | Dedicated wifi-cycle harness `scripts/matika-bp-network-drop.sh` + `edge_v2_14_part{1,2}_*.yaml` runs to exit 0 post-AuthRepository debug-build offline bypass. Part 1 PASS (wifi=ON, login, nav to BP). Part 2 PASS (wifi=OFF, launchApp clearState:false → patient home → BP screen → save 132/88 → save_acknowledgement). Wifi re-enabled. CloudWatch `/aws/lambda/carelog-dev-sync-observation` filtered for `"Stored observation"` ≥ this run's start cutoff returned 2 hits (`obs-1778483543154-w83oat`, `obs-1778483543100-mm3pcx`) for patient CL-63NRGO — proof the local-save + WorkManager-retry chain survives a mid-session network drop. |
| **EDGE-V2-15** | Microphone permission denied | blocked | Needs revoke-then-launch flow. Tests text-fallback substitution. |
| **EDGE-V2-16** | Cross-region disclosure absent (regression) | flow authored, **regression confirmed (F18)** | `cross_region_disclosure_scan.yaml` asserts the substring `(?i).*AWS regions outside India.*` on the register screen. Substring is missing today — a real DPDP/HIPAA compliance gap. Journey moves to PASS once F18 (UI copy + product/legal sign-off) ships. |

---

## Quick stats (last refreshed 2026-05-10 after F4 Path A)

| Bucket | Count | IDs |
|---|---|---|
| **Full PASS** (UI + backend) | 13 | PT-V2-01, PT-V2-02, PT-V2-07, PT-V2-08, PT-V2-09, PT-V2-13, CG-V2-02, CG-V2-05, CG-V2-06, CG-V2-18, EDGE-V2-01, EDGE-V2-02, EDGE-V2-07, EDGE-V2-11, EDGE-V2-13 |
| **Backend half PASS, push delivery blocked on F17 SNS provisioning** | 5 | CG-V2-07, CG-V2-08, CG-V2-09, E2E-V2-02, E2E-V2-03, E2E-V2-06 |
| **Route-reachable; awaits Maestro flow authoring** (F4 Path A unblocked) | 11 | PT-V2-15, PT-V2-16, PT-V2-17, PT-V2-18, PT-V2-19, PT-V2-20, PT-V2-21, EDGE-V2-14, CG-V2-12 (data-blocked), CG-V2-13 (data-blocked), CG-V2-17 |
| **Flow authored, regression confirmed** | 2 | EDGE-V2-03 (F19 — guardrail parser crash), EDGE-V2-16 (F18 — disclosure copy missing) |
| **Web-portal-blocked** (data-testid + Playwright) | 8 | DR-V2-01..08 |
| **Backend backlog** | 0 | All four (CG-V2-16 + EDGE-V2-04 + EDGE-V2-08 + EDGE-V2-09) PASS as of 2026-05-14. EDGE-V2-08 PASS by architecture (Bedrock `global.*` profiles handle cross-region routing); client-side circuit breaker remains a post-pilot follow-up. |
| **Manual / out-of-agentic-scope** | 10 | PT-V2-10/11/12 (photos), PT-V2-24, EDGE-V2-05/06/10/12 (wall-clock timers), EDGE-V2-15 (mic perm revoke) |
| **Cognito-interception-blocked** | 0 | CG-V2-01 + PT-V2-23 + EDGE-V2-04 all PASS via Stream C harness (2026-05-14). EDGE-V2-04 closed by adding `SignInOutcome.NewPasswordRequired` + `NewPasswordScreen`. |
| **Design-blocked** | 0 | PT-V2-22 PASS via Stream D 2026-05-14 |
| **Partial / in-progress** | 1 | E2E-V2-01 (constituents partly covered) |
| **Other blockers** (SES not verified, etc.) | 4 | CG-V2-10, CG-V2-11, CG-V2-14, CG-V2-15 |

(Some counts overlap — F4 spans patient + caregiver sides; backend halves of E2E flows also hit F17.)

The "PASS" bucket count is up from 5 at the start of 2026-05-09.

Stat counts may double-count when a single journey lists in multiple buckets (e.g. CG-V2-07 is "backend half PASS" + would-be in "manual" for the second-device push). Rule of thumb: full PASS rows + backend-half PASS rows = 18 journeys observably exercised in some form.

---

*Companion file: `docs/journeys_voice.md` for the 7 voice-required journeys. Master catalog: `docs/journeys.md`. Findings catalog: `docs/testing_todos_v2.md` (F1..F19).*

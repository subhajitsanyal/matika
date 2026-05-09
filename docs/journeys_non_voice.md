# Matika v2 — Non-Voice Journeys

**Version:** 1.0
**Date:** 2026-05-08
**Source of truth:** `docs/journeys.md` (full catalog). This file is the focused subset for tests that don't require microphone input.

A journey is in this file when it can be **fully exercised without speech audio capture**. That includes:
- Native non-voice flows (manual logs, dashboards, settings, registration, validation, doctor portal)
- Voice-canonical flows that have a documented text-fallback path producing the same product behavior (PT-V2-09 emergency, EDGE-V2-13 implausibility, etc.) — those are listed here with a `text-fallback path` note.

For voice journeys that genuinely require Mac-speaker injection, see `docs/journeys_voice.md`.

---

## Inventory by persona

### Patient (Android) — 19 journeys

| ID | Title | Status today | Test path |
|---|---|---|---|
| **PT-V2-01** | First login | **PASS** (sweep `20260508_215314`) | Maestro `patient_logging_happy_path` first half. |
| **PT-V2-02** | Patient home orientation | **blocked** | Needs new flow asserting tab bar + a11y. |
| **PT-V2-07** | Text-input fallback (deterministic) | **PASS** | `patient_logging_happy_path.yaml`. The CI gate. |
| **PT-V2-08** | Implausible value challenge (T3) | blocked → **runnable via text** | New flow tapping `matika_text_fallback`, type `"my BP is 300 over 200"`, expect Sonnet escalation in `model_call.escalation_reason='implausible_value'`. |
| **PT-V2-09** | Emergency keyword detection | blocked → **runnable via text** | New flow typing `"I have severe chest pain"` via fallback. Expect emergency UI + caregiver FCM (verifying push needs second device → manual). |
| **PT-V2-10** | Photo OCR happy path (ML Kit) | manual | Needs real glucometer or printed mock. Out of agentic scope. |
| **PT-V2-11** | Photo OCR Bedrock vision fallback | manual | Glare condition; needs real photo. |
| **PT-V2-12** | Photo extraction failure (422) | manual | Needs blank surface photo. |
| **PT-V2-13** | Connectivity loss mid-session | **PASS (2026-05-09)** | Three-flow orchestration via `scripts/matika-connectivity-test.sh`: setup → wifi disable → submit-turn-asserts-Snackbar-error → wifi enable → retry-asserts-response-card. App has no "Reconnecting…" indicator (ConnectivityState lives in VM but isn't rendered) — the `Turn failed` Snackbar is the actual product behavior; flow asserts that. |
| **PT-V2-14** | Per-patient hard rate limit (429) | blocked | Needs ~500-call loop driver. Cost-conscious; defer. |
| **PT-V2-15** | Manual log — Blood Pressure | **blocked (architecture)** | F4: v2 `PatientHomeScreen` is voice-first; no UI nav to `BloodPressureScreen` (orphan route). |
| **PT-V2-16** | Manual log — Glucose | **blocked (architecture)** | Same — F4. |
| **PT-V2-17** | Manual log — Temperature | **blocked (architecture)** | Same. |
| **PT-V2-18** | Manual log — Weight | **blocked (architecture)** | Same. |
| **PT-V2-19** | Manual log — Pulse | **blocked (architecture)** | Same. |
| **PT-V2-20** | Manual log — SpO₂ | **blocked (architecture)** | Same. |
| **PT-V2-21** | View vital history | **blocked** | History route exists but no UI nav from voice-first home. F4-coupled. |
| **PT-V2-22** | Settings — view care team (read-only) | **design-blocked (2026-05-09)** | `SettingsScreen` only renders the "Manage Care Team" entry for `CAREGIVER` / `RELATIVE` personas — patients have no Care Team view today. Either add a read-only patient variant or fold a patient-side care-team section into Settings. |
| **PT-V2-23** | Cross-region inference disclosure (consent) | blocked | Jane is past consent; needs fresh signup. Caregiver self-reg requires email-verification (out of agentic scope). |
| **PT-V2-24** | Reminder push → opens conversation | manual | Needs `aws lambda invoke check-daily-deadline` + push-receipt verification on second device. |

### Caregiver (Android) — 16 journeys

| ID | Title | Status today | Test path |
|---|---|---|---|
| **CG-V2-01** | Self-registration with cross-region consent | blocked | Cognito email-verification code intercept needed. |
| **CG-V2-02** | Form-based patient onboarding | **PASS** (verified live with F3 fix) | `caregiver_protocol_setup.yaml` — the canonical Maestro CI gate. Re-run against pre-existing patient surfaces 409 (F3). |
| **CG-V2-05** | Caregiver dashboard overview | **PASS (implicit via CG-V2-02)** | Login + onboard_patient_fab + patient_card visible — already covered by CG-V2-02. |
| **CG-V2-06** | View patient logs | **PASS (2026-05-09)** | `caregiver_view_patient_logs.yaml` — taps `patient_card_CL-63NRGO`, "View Logs" button, asserts `Patient Logs` title + at least an interaction-card row OR empty-state copy. |
| **CG-V2-07** | Receive threshold breach push | RDS+SQS half **PASS**; lambda **PASS post-F15**; push delivery **blocked on F17** (no SNS Platform App in dev) | F11/F15 land notification-sender cleanly: alerts row gets `send_error='no_transport_or_no_device_token'`. F17 (devops) provisions SNS Platform Apps + sets `IOS/ANDROID_PLATFORM_ARN` + Android client must register FCM token. |
| **CG-V2-08** | Receive missed-measurement push | RDS half **PASS**; lambda **PASS post-F15**; push delivery **blocked on F17** | check-missed-measurements writes the alert row correctly; notification-sender now resolves device tokens via `dt.user_id = u.id` (returns 0 rows because no device_tokens are registered — see F17). |
| **CG-V2-09** | Receive emergency push | RDS half **PASS**; lambda **PASS post-F15**; push delivery **blocked on F17** | bedrock-router's emergency alert SQS path delivers; notification-sender consumes cleanly; same F17 transport gap. |
| **CG-V2-10** | Invite doctor | blocked | No Maestro flow; SES sender email not verified in dev. Backend (`invite-doctor` log + RDS `doctor_invites` row) can be tested via direct API call. |
| **CG-V2-11** | Manage care team — remove member | blocked | No Maestro flow; depends on CG-V2-10 having added a doctor first. |
| **CG-V2-12** | Configure thresholds manually | **architecture-blocked (F4-class)** | `ThresholdConfigScreen` exists with `threshold_<vital>_min/max` testTags, but the only navigator is `RelativeDashboardScreen` — and the v2 persona mapping routes `RELATIVE → CaregiverHomeScreen`, never to `RelativeDashboard`. Screen is orphaned. Same product call as F4: wire from caregiver settings or delete. |
| **CG-V2-13** | Configure reminders manually | **architecture-blocked (F4-class)** | `ReminderConfigScreen` exists but is reachable only from the same orphan `RelativeDashboardScreen`. Same product call as CG-V2-12. |
| **CG-V2-14** | Accept doctor recommendation | blocked → **partially runnable via text** | Depends on DR-V2-05 (web blocked on data-testid). If a recommendation is seeded directly via DB, the caregiver-side accept can be exercised via text fallback in a config session. |
| **CG-V2-15** | Reject doctor recommendation | same as CG-V2-14 | |
| **CG-V2-16** | Delete patient (cascade) | blocked | `delete-patient` route Lambda not wired into API Gateway. Backend backlog. |
| **CG-V2-17** | View trends | **architecture-blocked (F4-class)** | `TrendsScreen` exists but is reachable only from the orphan `RelativeDashboardScreen`. Same product call as CG-V2-12/13. |
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
| **E2E-V2-02** | Threshold breach alert cycle | backend half **PASS** (2026-05-09); UI side manual | Jane's BP `parameter_configs` rows seeded (systolic 90–160 / diastolic 50–95). After F11 fix, direct invoke of `evaluate-thresholds-batch` with 200/110 creates two `alerts` rows (with caregiver `recipient_user_id`, `vital_value`, `vital_unit`, `threshold_max`) + two SQS messages. FCM push receipt remains manual (needs second device). |
| **E2E-V2-03** | Missed-measurement alert cycle | RDS half **PASS** (Jane has 4 `missed_measurement` rows in dev `alerts`); push delivery **blocked on F17** | Backend chain (parameter_configs → check-missed-measurements → alerts row + SQS) works. Caregiver-side push is the F15 device-token resolution failure. |
| **E2E-V2-06** | Reminder lapse → patient logs | RDS half **PASS (2026-05-09)**; push delivery **blocked on F17** | Direct invoke of `check-daily-deadline` after temporarily setting Jane's `daily_deadline` to a past time produced one `patient_reminder` row in `alerts` (id=`4e3280d1-…`) addressed to Jane. Restored deadline to 18:00 IST. F12 fix confirmed end-to-end. |

### Edge cases — 14 non-voice (EDGE-V2-17 is voice-only)

| ID | Title | Status today | Test path |
|---|---|---|---|
| **EDGE-V2-01** | Registration validation | blocked → **runnable** | New Maestro flow scripting bad inputs against `register_*` testTags. ~30 min author effort. |
| **EDGE-V2-02** | Login validation | blocked → **runnable** | Same shape. |
| **EDGE-V2-03** | Bedrock Guardrail block | flow authored, **regression surfaced (F19)** | `patient_guardrail_block_text.yaml` submits a misconduct-category prompt that the Guardrail correctly intervenes on. bedrock-router's parser then crashes ("No `<output>...</output>` block found") because it doesn't handle the `amazon-bedrock-guardrailAction` response shape. Journey moves to PASS once F19 ships. |
| **EDGE-V2-04** | `FORCE_CHANGE_PASSWORD` first-time login | blocked | Jane is past this state; needs fresh patient via caregiver flow with default temp password. |
| **EDGE-V2-05** | JWT silent refresh (1hr) | manual | Wall-clock 60+ min. Out of sweep budget. |
| **EDGE-V2-06** | JWT 30-day refresh expiry | manual | Wall-clock months. Out of any sweep. |
| **EDGE-V2-07** | Cognito email collision | **PASS** (F3 verified live in `20260508_230704`) | Re-running CG-V2-02 against pre-existing email returns 409 with `EMAIL_ALREADY_EXISTS`. |
| **EDGE-V2-08** | Bedrock cross-region failover | blocked | No chaos harness. Backend infra work. |
| **EDGE-V2-09** | Bedrock structured-output parse failure | blocked | Needs prompt-mutation harness. |
| **EDGE-V2-10** | Idle session timeout (30 min) | manual | Wall-clock 30 min. Out of sweep budget. |
| **EDGE-V2-11** | Pause and resume | **PASS (2026-05-09)** | `patient_pause_resume_text.yaml` — submit a turn → tap "Pause" (label flips to "Resume") → tap "Resume" (label flips back to "Pause"). The button has no testTag today; targets by accessibility text via `.*…*` substring. |
| **EDGE-V2-12** | Pause timeout (5 min) | manual | Wall-clock 5 min. Borderline; could run as a long-duration flow. |
| **EDGE-V2-13** | Implausible plausibility ranges per parameter | **PASS (2026-05-09)** | `patient_implausible_glucose_text.yaml` — types "fifteen hundred mg/dL" via fallback; response card mounts post-F10. Same FSM transition as PT-V2-08; covers a non-BP parameter. |
| **EDGE-V2-14** | Network drop during sync of manual log | blocked (depends on PT-V2-15..20 routes being reachable) | Tied to F4 architecture decision. |
| **EDGE-V2-15** | Microphone permission denied | blocked | Needs revoke-then-launch flow. Tests text-fallback substitution. |
| **EDGE-V2-16** | Cross-region disclosure absent (regression) | flow authored, **regression confirmed (F18)** | `cross_region_disclosure_scan.yaml` asserts the substring `(?i).*AWS regions outside India.*` on the register screen. Substring is missing today — a real DPDP/HIPAA compliance gap. Journey moves to PASS once F18 (UI copy + product/legal sign-off) ships. |

---

## Quick stats

| Bucket | Count |
|---|---|
| **Runnable today (PASS already)** | 4 — PT-V2-01, PT-V2-07, CG-V2-02, CG-V2-05, EDGE-V2-07 (5) |
| **Runnable with new Maestro flows authored tonight** | ~10 — PT-V2-02, PT-V2-08 (text), PT-V2-09 (text), PT-V2-13 (text), CG-V2-18, EDGE-V2-01, EDGE-V2-02, EDGE-V2-03, EDGE-V2-13, EDGE-V2-16 |
| **Backend-half runnable (no UI dependency)** | ~6 — CG-V2-07, CG-V2-08, CG-V2-09, E2E-V2-02, E2E-V2-03 backend chains |
| **Manual / out-of-budget** | ~10 — photos, second-device pushes, JWT timers, idle timeouts |
| **Architecture-blocked (F4)** | 7 — PT-V2-15..21 |
| **Web-portal-blocked** | 8 — all DR-V2-* |
| **Backend backlog** | 4 — CG-V2-16, EDGE-V2-08, EDGE-V2-09, EDGE-V2-04 |
| **Total** | 60 (matches 73 catalog − 10 voice − 3 oos accounted-for-elsewhere) |

---

## Test order for this sweep

Optimal sequencing for tonight (minimize Cognito state churn, batch related backends):

1. **Re-verify PASS-already** — PT-V2-01, PT-V2-07, CG-V2-02 (F3), CG-V2-05, EDGE-V2-07
2. **Author + run cheap new flows**:
   - CG-V2-18 (sign out) — 10 min
   - PT-V2-02 (dashboard) — 15 min
   - EDGE-V2-01 (registration validation) — 30 min
   - EDGE-V2-02 (login validation) — 30 min
   - EDGE-V2-16 (consent text scan) — 20 min
3. **Run text-fallback variants of voice journeys**:
   - PT-V2-08 (implausible value, text)
   - PT-V2-09 (emergency, text — backend half)
   - PT-V2-13 (connectivity loss, text)
   - EDGE-V2-03 (Guardrail block, text)
   - EDGE-V2-11 (pause/resume, text — testTag audit needed first)
   - EDGE-V2-13 (implausibility, text)
4. **Backend-only chain checks** for journeys whose UI side needs second device:
   - E2E-V2-02 (threshold breach chain)
   - CG-V2-07 (alerts table + Lambda log)
5. **Classify the rest** (architecture-blocked, web-blocked, backend backlog) without execution.

---

*Companion file: `docs/journeys_voice.md` for the 7 voice-required journeys. Master catalog: `docs/journeys.md`.*

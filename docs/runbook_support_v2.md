# Matika v2.0 — Support Runbook

**Audience:** Support engineer fielding a "patient/caregiver can't X" report (typically inbound via WhatsApp during the v2.0 beta).
**Scope:** First-response diagnostic + remediation for the most common failure modes patients/caregivers hit.
**Companion docs:** `docs/runbook_oncall_v2.md` (alarms), `docs/dr_runbook_v2.md` (data recovery).

For each scenario: symptom, what to check, fix.

Every check that hits the database assumes the dev/staging RDS tunnel pattern from `dev_rds_ssm_tunnel.md` memory. For prod, use the prod bastion ID + RDS endpoint.

---

## Triage flow — do this first on every ticket

Before deep-diving into a scenario, classify the ticket and collect the identifiers you'll need.

### Step 1 — Is this Matika v2.0 or v1 legacy?

| Tell-tale | v2.0 | v1 legacy |
|---|---|---|
| Hardware at patient's home | None (Android app only) | Mac Mini |
| App install source | TO BE PROVISIONED PRE-BETA (Play Store closed-beta link — owner: founder, target T-7 per launch-plan §8 timeline) | n/a — no patient phone app in v1 |
| Voice in Hindi/Bengali | Yes (Android NATIVE_VOICES) | No |
| User mentions "alerts to my phone" | Yes (FCM push) | Sometimes (email-only in v1) |
| App `versionName` | `1.4.x` or higher | n/a |

If v1 legacy, redirect to the legacy on-call rotation. This runbook is v2.0 only.

### Step 2 — Which persona is reporting?

Ask: "Do you log your own vitals (patient), or someone else's (caregiver/family)?"

Cross-check via Cognito:
```bash
aws cognito-idp admin-get-user --user-pool-id ap-south-1_<pool-id> \
  --username "<user-email>" --region ap-south-1 \
  --query 'UserAttributes[?Name==`custom:persona_type`].Value|[0]' --output text
```

Returns one of: `patient` / `caregiver` / `relative`. **No `doctor`** — that's Phase 2 (see `CLAUDE.md` + `docs/v2_launch_plan.md` §13). If you see `doctor`, that's v1 legacy data or a Phase 2 dev-branch leak — flag to backend lead.

### Step 3 — Extract the identifiers you'll need

These three identifiers unlock every downstream query. Collect all three before opening a SQL session.

| Identifier | Format | How to get it |
|---|---|---|
| **Cognito sub** | UUID (e.g., `abc12345-...`) | From `aws cognito-idp admin-get-user` — the `Username` field IS the sub. |
| **patient_id short code** | `CL-XXXXXX` | From the app's Patient Profile screen, or via SQL: `SELECT p.patient_id FROM patients p JOIN users u ON u.id = p.user_id WHERE u.email = '<email>';` (for patient-persona users). For caregivers managing a patient, go through `persona_links`: `SELECT p.patient_id FROM patients p JOIN persona_links pl ON pl.patient_id = p.id JOIN users u ON u.id = pl.linked_user_id WHERE u.email = '<caregiver-email>' AND pl.is_active = true;` |
| **session_id** | UUID | Only relevant for voice-flow issues. User won't have it — fetch from `interaction_sessions` by recent `created_at` + `user_id`. |

Test pair for verifying queries (dev only): Jane Doe (patient) + John CG (caregiver) — see memory `jane_dev_test_account.md` for the UUIDs.

### Step 4 — Audit-log the ticket before any remediation

Open every ticket by writing an `audit_log` row noting the support session start. See "PII handling" below for what's safe to put in `details`.

---

## "I can't sign in"

### Symptom
User opens the app, enters email + password, gets an error or the screen doesn't advance.

### Check 1 — Cognito user state
```bash
aws cognito-idp admin-get-user \
  --user-pool-id ap-south-1_<pool-id> \
  --username "<user-email>" \
  --region ap-south-1 \
  --query '{Status:UserStatus,Email:Attributes[?Name==`email`].Value|[0],EmailVerified:Attributes[?Name==`email_verified`].Value|[0],Persona:Attributes[?Name==`custom:persona_type`].Value|[0]}'
```

| `UserStatus` | What it means | Fix |
|---|---|---|
| `CONFIRMED` | Normal state — sign-in should work. Check next. | n/a |
| `UNCONFIRMED` | Email verification pending. | Re-send code via `aws cognito-idp resend-confirmation-code` OR `admin-confirm-sign-up` (skips email). |
| `FORCE_CHANGE_PASSWORD` | Admin-created user; first sign-in needs a new password. | App handles this via NewPasswordScreen since EDGE-V2-04 (commit `c4c574f`). If user reports the screen doesn't appear → app version too old. |
| `RESET_REQUIRED` | Password reset pending. | User taps "Forgot Password" on login. |
| `ARCHIVED` | User disabled. | Probably correct (e.g., delete-patient cascade — see CG-V2-16). Check `audit_log` for `DELETE_CASCADE` entry. |
| `DISABLED` | Same as ARCHIVED for support purposes. | n/a |

### Check 2 — Are they hitting the wrong sign-in (attendant vs main)?
The attendant flow uses a separate Cognito sign-in path; if a regular caregiver lands on `AttendantLoginScreen` they'll get an "Account requires a new password" or "User is not a caregiver" error (per `AttendantSessionManager.kt` post-EDGE-V2-04).

Ask the user what screen they see. If "Attendant Sign In" appears, route them back to the main login.

### Check 3 — Network / Cognito region
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://cognito-idp.ap-south-1.amazonaws.com/
```
Should return 200. If 5xx, AWS Cognito ap-south-1 is having an outage — escalate to on-call.

---

## "I confirmed my email but the app keeps asking for a verification code"

Cognito sometimes emails the code but the user enters one digit wrong, exhausts 3 retries, and the app gets stuck.

```bash
# Confirm them server-side (skips the email loop)
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id ap-south-1_<pool-id> \
  --username "<user-email>" \
  --region ap-south-1
# Belt-and-braces: mark email_verified
aws cognito-idp admin-update-user-attributes \
  --user-pool-id ap-south-1_<pool-id> \
  --username "<user-email>" \
  --user-attributes Name=email_verified,Value=true \
  --region ap-south-1
```
Same path the test harness uses (`test-automation/scripts/cognito-test-harness.sh:harness_admin_confirm_signup`). Tell them to relaunch the app and sign in.

---

## "I see a 'Privacy Consent' screen and can't get past it"

Working as designed since Stream C (commit `de71a4a`/`2f710a6`). `SplashViewModel` routes any user without a current `consent_records` row through `ConsentScreen`. The fix is for the user to tap **Accept and Continue** on the screen — the consent text is the load-bearing DPDP cross-region disclosure.

If they tap Accept and the screen doesn't dismiss:

```bash
# Tunnel + check whether their consent_records row is there
SELECT cr.consent_version, cr.is_accepted, cr.accepted_at, cr.withdrawn_at
FROM consent_records cr
JOIN users u ON u.id = cr.user_id
WHERE u.email = '<user-email>'
ORDER BY cr.accepted_at DESC LIMIT 3;
```

If `withdrawn_at` is set, the user previously withdrew consent → they need to re-accept. If no rows at all, the consent lambda's POST is failing — check `aws logs filter-log-events --log-group-name /aws/lambda/carelog-<env>-consent --filter-pattern ERROR`.

---

## "I can't log a vital"

### Check 1 — Manual entry (vital tile) vs voice fallback
Both routes fan into `sync-observation` lambda. Ask the user which they tried.

### Check 2 — Did the app show a Snackbar?
- **"Turn failed" / "Save failed"** → backend rejected. Check next.
- **No feedback at all** → tap likely missed; ask them to try again with a slower tap.

### Check 3 — Did the observation actually land?
```sql
-- look for their patient_id from Cognito custom:linked_patient_id
SELECT id, parameter, value, created_at
FROM observations
WHERE patient_id = (SELECT id FROM patients WHERE patient_id = '<CL-XXXXXX>')
ORDER BY created_at DESC LIMIT 5;
```
If the latest row's `created_at` is within the last few minutes → it landed; the app's confirmation UI failed (probably a network timeout post-write). Tell them it's saved.

If no recent row → check `/aws/lambda/carelog-<env>-sync-observation` for an error in the same window. Common cause: schema mismatch (v2 partial-schema-migration class).

---

## "I logged a vital but it doesn't show up"

Two possible reasons.

### Reason 1 — Sync queued offline
Observations queue locally (Room DB) when the device is offline. WorkManager re-runs the sync within ~15 min of network restore. Ask the user to:
1. Confirm WiFi/4G is on.
2. Open the app fully (not just resume from background — WorkManager fires on lifecycle events).
3. Wait 5 minutes.

Live evidence: the observation will land per the same `observations` SELECT above.

### Reason 2 — Wrong patient
For caregivers managing multiple patients (rare in v2.0): check `users.linkedPatientId` — that's the patient whose vitals the caregiver sees. Mismatch can happen if the caregiver was re-linked recently.

---

## "I'm not getting push notifications for alerts"

### Check 1 — FCM device token registered?
```sql
SELECT dt.device_token, dt.is_active, dt.created_at, dt.last_seen_at
FROM device_tokens dt
JOIN users u ON u.id = dt.user_id
WHERE u.email = '<user-email>'
ORDER BY dt.last_seen_at DESC LIMIT 3;
```

If 0 rows → the app never registered the token. Likely cause: user installed the app but never signed in fully (see "I can't sign in" above).

If `is_active=false` → token was rotated; the app needs to refresh on next launch (DeviceTokenManager.start() in CareLogApplication).

### Check 2 — SNS Platform Endpoint healthy?
The notification-sender lambda creates an SNS Platform Endpoint per device token. Endpoints get auto-disabled by AWS if FCM rejects them.
```bash
# Find the endpoint ARN (notification-sender logs it on first publish)
aws logs filter-log-events \
  --log-group-name /aws/lambda/carelog-<env>-notification-sender \
  --filter-pattern '<user-email>' \
  --max-items 5 --region ap-south-1
```

### Check 3 — Did the alert actually generate?
```sql
SELECT id, alert_type, vital_value, threshold_min, threshold_max,
       is_sent, sent_at, send_error, created_at
FROM alerts
WHERE recipient_user_id = (SELECT id FROM users WHERE email = '<user-email>')
ORDER BY created_at DESC LIMIT 5;
```

| Row state | Means |
|---|---|
| No row | The threshold-evaluation never produced an alert. Check `evaluate-thresholds-batch` logs. |
| `is_sent=true, send_error=NULL` | We dispatched it; the issue is downstream (FCM, OS, device). Ask user about Do Not Disturb / app notification permission. |
| `is_sent=false, send_error=...` | Read the error verbatim — usually missing endpoint, expired token. |

---

## "Caregiver can't onboard a patient"

### Check 1 — Email collision
Most common: caregiver's chosen patient email already exists in Cognito.
```bash
aws cognito-idp list-users --user-pool-id ap-south-1_<pool-id> \
  --filter "email = \"<patient-email>\"" --region ap-south-1
```
If a row exists → tell caregiver to pick a different email. F3 ensures the app surfaces this as a 409 with `EMAIL_ALREADY_EXISTS` (caregiver_protocol_setup flow handles it).

### Check 2 — create-patient lambda error
```bash
aws logs filter-log-events --log-group-name /aws/lambda/carelog-<env>-create-patient \
  --start-time $(($(date +%s) * 1000 - 600000)) \
  --filter-pattern ERROR --max-items 10 --region ap-south-1
```
Common errors: SES sandbox can't send to unverified recipient (current state — see `v2_stream_d_decisions_20260512.md`); RDS connection timeout (see runbook_oncall #1); FHIR HealthLake unreachable (logged but lambda continues).

---

## "Patient can't see Care Team / can only see partial info"

Working-as-designed since PT-V2-22 (commit `003fea5`):
- Patient sees ONLY caregivers (doctor section suppressed until Phase 2).
- Read-only — no invite/remove buttons. Caregiver manages the team.

If the screen shows "No caregivers yet" but the user has a caregiver:
```sql
SELECT pl.id, pl.relationship, pl.is_primary, pl.is_active,
       u.name AS caregiver_name, u.email
FROM persona_links pl
JOIN users u ON u.id = pl.linked_user_id
WHERE pl.patient_id = (SELECT id FROM patients WHERE patient_id = '<CL-XXXXXX>')
  AND pl.is_active = true;
```

If 0 rows → there's no active caregiver link. Check the create-patient lambda's audit_log for the patient (was the persona_links row written?).

---

## "App is speaking the wrong language (English when I want Hindi/Bengali, or vice-versa)"

Language preference is sticky in two places: the device's DataStore (Android) AND the RDS `patients.language` column. Mismatch can happen if the user signed out (which clears DataStore per `voice_harness_lessons.md` lesson on `clearState`).

### Check 1 — RDS source of truth
```sql
SELECT patient_id, language
FROM patients
WHERE patient_id = '<CL-XXXXXX>';
```
Acceptable values per V005 CHECK constraint: `'en-IN'`, `'hi-IN'`, `'bn-IN'`. (Column was added in V004 as `preferred_language`, renamed to `language` and typed to BCP-47 in V005.)

### Check 2 — Did the user re-select language in Settings?
Ask the user to: open Settings → Language → reselect their preferred language. The app re-persists into DataStore.

If that doesn't stick: force-stop the app from Android Settings → Apps → Matika → Force Stop, then reopen. DataStore reloads on cold start.

### Check 3 — Server-side fix (last resort)
```sql
UPDATE patients SET language = 'hi-IN'
WHERE patient_id = '<CL-XXXXXX>';
```
Then tell the user to sign out and back in — forces re-fetch into DataStore.

---

## "Caregiver onboarded the wrong patient name (typo)"

v2.0 onboarding has no self-serve patient-name edit screen. Fix is support-side.

### Step 1 — Find the patient and confirm
```sql
SELECT id, patient_id, name FROM patients WHERE patient_id = '<CL-XXXXXX>';
```

### Step 2 — Update RDS
```sql
UPDATE patients SET name = '<corrected>' WHERE patient_id = '<CL-XXXXXX>';
```

### Step 3 — Update Cognito if the patient user exists separately
Some patient users are created in Cognito with the patient name as `name` attribute (form-onboard flow). Check + update:
```bash
aws cognito-idp admin-update-user-attributes --user-pool-id ap-south-1_<pool-id> \
  --username "<patient-email>" \
  --user-attributes Name=name,Value='<corrected>' --region ap-south-1
```

### Step 4 — Audit-log the change
```sql
INSERT INTO audit_log (action, resource_type, resource_id, user_id, details, created_at)
VALUES (
  'UPDATE_PATIENT_NAME',
  'patient',
  '<patient-uuid>',
  '<support-engineer-user-uuid>',
  '{"reason":"support-side typo fix","ticket_id":"<ticket-ref>"}'::jsonb,
  NOW()
);
```
Reconstructibility is a DPDP requirement. Always log the support engineer's `user_id` (NOT the patient's). Do NOT put PHI in `details`.

---

## "Patient/caregiver gets stuck at the credentials form (can't progress past email/password)"

Two known sub-causes — both fixed 2026-05-17 but may regress on older app versions.

### Sub-cause 1 — F39 class (form-submit doesn't POST)

Pre-fix, the form's Save button could fail to dispatch the create-patient or signup call. Check:
- Android logcat for `submitCredentials` or equivalent log line at the moment of Save tap.
- CloudWatch: `aws logs filter-log-events --log-group-name /aws/lambda/carelog-<env>-create-patient --start-time $(($(date +%s) * 1000 - 600000)) --max-items 5 --region ap-south-1` — if no invocation, the app dispatch failed.

Resolution: ask user's app `versionName`. Must be ≥1.4.0 (F39 fix). Older = unfixed; ask them to update.

### Sub-cause 2 — F44 class (email validation rejecting valid emails)

Pre-fix, certain valid emails (especially `+` aliases or unusual TLDs) were rejected by client-side validation. Same `versionName ≥ 1.4.0` rule.

### Operational fix (any sub-cause)

If app is wedged and user can't update, create the user server-side, skipping the broken form:
```bash
cd /Users/subhajitsanyal/Work/Projects/Matika/appdevel/matika/test-automation/scripts
./cognito-test-harness.sh harness_create_user "<email>" "<temp-password>" "<persona>"
```
Then tell the user to sign in with the temp password (they'll be in `FORCE_CHANGE_PASSWORD` state — app handles via NewPasswordScreen since EDGE-V2-04).

Reference: `docs/testing_todos_v2.md` F39 + F44 entries for full incident history.

---

## RDS access via SSM bastion

Cross-references the canonical `docs/setup-and-deployment-guide.md` + memory `dev_rds_ssm_tunnel.md`. Quick-reference below.

**DEV:**
```bash
aws ssm start-session --target i-017956fca070240a7 \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["carelog-dev.c30qocsuk0zl.ap-south-1.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["55432"]}' \
  --region ap-south-1 &

PGPASSWORD=$(aws secretsmanager get-secret-value --secret-id carelog-dev-db-password \
  --query SecretString --output text --region ap-south-1 | jq -r .password) \
  psql -h 127.0.0.1 -p 55432 -U carelog_dev_admin -d carelog_dev
```

**STAGING:**
```bash
aws ssm start-session --target i-0f2acdf1a96ee24a6 \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["carelog-staging.c30qocsuk0zl.ap-south-1.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["55433"]}' \
  --region ap-south-1 &

PGPASSWORD=$(aws secretsmanager get-secret-value --secret-id carelog-staging-db-password \
  --query SecretString --output text --region ap-south-1 | jq -r .password) \
  psql -h 127.0.0.1 -p 55433 -U carelog_staging_admin -d carelog_staging
```

**PROD:** TO BE PROVISIONED PRE-BETA — owner: founder (sole infra lead during beta). Pattern will mirror staging (`carelog_prod_admin` named breakglass user via Secrets Manager `carelog-prod-db-password`) once the prod RDS instance is stood up per `docs/v2_launch_plan.md` §4.6 "Prod environment first-apply." Until then, prod RDS access is N/A — the prod env doesn't exist yet.

Always use the libpq `psql` binary, not the Homebrew one (which can have TLS quirks against RDS). Path on dev workstation: `/Applications/Postgres.app/Contents/Versions/latest/bin/psql` or whatever the local install provides.

---

## Common data-fix scripts

Three copy-paste-ready snippets for the most common support-side fixes.

### 1. Update a parameter_configs threshold for a patient

`parameter_configs.threshold_max` is **NUMERIC[] (array)**, not scalar — so writes need `ARRAY[...]::numeric[]`. The unique key is `(patient_id, parameter_name)`. Acceptable `parameter_name` values follow the v2 enum form (e.g., `blood_pressure_systolic`, `blood_pressure_diastolic`, `weight_kg`, `heart_rate_bpm`) — check the row to confirm before editing.

```sql
-- e.g., raise systolic high-threshold from 140 to 160 for a patient
UPDATE parameter_configs
SET threshold_max = ARRAY[160]::numeric[]
WHERE patient_id = (SELECT id FROM patients WHERE patient_id = '<CL-XXXXXX>')
  AND parameter_name = 'blood_pressure_systolic';
```

Verify the change took:
```sql
SELECT parameter_name, threshold_min, threshold_max
FROM parameter_configs
WHERE patient_id = (SELECT id FROM patients WHERE patient_id = '<CL-XXXXXX>')
  AND parameter_name = 'blood_pressure_systolic';
```

### 2. Cognito password reset

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id ap-south-1_<pool-id> \
  --username "<email>" \
  --password "<temp-password-with-symbols-and-mixed-case>" \
  --no-permanent --region ap-south-1
```

`--no-permanent` forces a `FORCE_CHANGE_PASSWORD` state on next login. App handles via NewPasswordScreen (since EDGE-V2-04, commit `c4c574f`).

### 3. Language reset (override what the app thinks the language is)

```sql
UPDATE patients SET language = 'hi-IN'
WHERE patient_id = '<CL-XXXXXX>';
```

Acceptable values per V005 CHECK: `'en-IN'`, `'hi-IN'`, `'bn-IN'`. Tell the user to sign out and back in (forces re-fetch into DataStore — clearState wipes DataStore per `voice_harness_lessons.md`).

---

## Escalation matrix

| Class of issue | First responder |
|---|---|
| Sign-in / consent / Cognito | Support engineer (this runbook) |
| Push notifications | Support engineer (this runbook); on-call if FCM-wide outage |
| Vital log lost / sync stuck | On-call (`runbook_oncall_v2.md`) |
| Patient onboarding broken (RDS, lambda errors) | On-call |
| Data recovery (deleted patient, lost observations) | DR runbook (`dr_runbook_v2.md`) — primary engineer + backend lead |

Always file a `audit_log` lookup for the affected user before any remediation, so the action you take is reconstructible later for DPDP audit.

---

## PII handling — what NOT to put in tickets

DPDP Act constraints apply to every artifact a support engineer creates. Tickets, Slack threads, screenshots, exported CSVs — all are potential PII spillage points.

**Never copy these into a ticket / Slack / wiki / any non-RDS artifact:**

- **Vital values** (BP readings, weight, heart rate, glucose). Use referential phrasing: "patient's most recent systolic reading" or "today's weight measurement."
- **Patient full name** — use `patient_id` short-code (`CL-XXXXXX`) instead. If you must reference a name, redact to first-name-only.
- **Date of birth, address, phone number** — never.
- **Cognito sub UUIDs** in any external-facing artifact. Internal Slack DMs only, with the recipient explicitly told why.
- **Raw transcript text** from `interaction_sessions.transcript` or any column derived from it. Transcripts are PHI under DPDP — even if redacted, the act of copying out of RDS triggers the data-residency boundary.
- **Email addresses** in public channels. Redact to first-3-chars + domain: `sub***@gmail.com`.
- **FHIR JSON bodies** from S3 (`s3://carelog-v2-<env>-documents-<acct>/observations/...`). They contain the same vital values as RDS plus FHIR metadata.

**Always do these:**

- **Audit-log every support action** in `audit_log` with `action`, `resource_type`, `resource_id`, and `user_id` set to the support engineer's `users.id` (NOT the patient's). `details JSONB` may contain a non-PHI reason string and a ticket reference, nothing else.
- **Use the `patient_id` short-code** in every ticket — it's the only PII-safe stable identifier for a patient.
- **Screenshot the Cognito console with email redacted** if you need to attach UI to a ticket — use the macOS preview's redaction tool.
- **Clear local clipboard** after pasting any PHI-bearing string. RDS query output → clipboard → paste-and-forget is a common spillage vector.

**Escalation for PII exposure incidents:**

If you've already pasted PHI somewhere you shouldn't have (Slack channel, ticket, email), do NOT delete the message yourself — that complicates the audit trail. Instead:
1. Notify the DPO within 1 hour of discovery. In solo-founder mode (v2.0 beta): the founder acts as DPO until first hire — email `subhajit@kyabla.in` with subject `DPO incident — DPDP §8(5) candidate`.
2. Notify backend lead via the same channel (also `subhajit@kyabla.in` in solo-founder mode) with a description (NOT the original PHI).
3. The DPO (founder, in solo mode) will determine whether deletion + re-issuance is required per DPDP §8(5) breach-notification rules. The 72-hour reporting window starts at discovery, not at decision.

Reference: `docs/privacy-policy.md` for the canonical user-facing data-handling policy. The cross-region disclosure language there must match the in-app `cross_region_disclosure_scan` content.

---

*Runbook v1.1 — 2026-05-17 (extended with triage flow, 3 scenarios, RDS access, data-fix scripts, PII handling). v1.0 baseline: 2026-05-14 (Stream G).*

# Matika v2.0 — Support Runbook

**Audience:** Support engineer fielding a "patient/caregiver can't X" report (typically inbound via WhatsApp during the v2.0 beta).
**Scope:** First-response diagnostic + remediation for the most common failure modes patients/caregivers hit.
**Companion docs:** `docs/runbook_oncall_v2.md` (alarms), `docs/dr_runbook_v2.md` (data recovery).

For each scenario: symptom, what to check, fix.

Every check that hits the database assumes the dev/staging RDS tunnel pattern from `dev_rds_ssm_tunnel.md` memory. For prod, use the prod bastion ID + RDS endpoint.

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

*Runbook v1.0 — 2026-05-14 (Stream G).*

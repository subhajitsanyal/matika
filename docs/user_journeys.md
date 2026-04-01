# CareLog Android App — User Journeys for Automated UI Testing

**Version:** 1.0
**Date:** 2026-03-29
**Purpose:** Comprehensive user journey definitions for agentic UI testing via Android emulator. Each journey specifies the persona, preconditions, step-by-step UI interactions, expected UI states, and backend calls to verify.

---

## How to Use This Document

Each journey is structured as:

- **Journey ID** — unique identifier for traceability
- **Persona** — who is performing the journey (Relative/Caregiver, Patient, Attendant)
- **Preconditions** — required app/backend state before the journey starts
- **Steps** — numbered UI interactions with expected screen states
- **Backend Verification** — API calls or database state to check after UI actions
- **Post-conditions** — app state after journey completion

Screen references use the route names from `CareLogNavHost.kt`. Composable references use file paths under `android/app/src/main/java/com/carelog/ui/`.

---

## PART 1 — RELATIVE (CAREGIVER) JOURNEYS

The relative is the account creator and primary manager. All onboarding starts here.

---

### J-REL-001: Relative Self-Registration

**Persona:** Relative (new user, no account)
**Preconditions:** Fresh app install, no stored credentials
**Covers:** REQ-AUTH-003, REQ-AUTH-004, REQ-SEC-007, REQ-SEC-008

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Launch app | Splash screen appears, checks auth state, redirects to LOGIN | `SPLASH` → `LOGIN` |
| 2 | Tap "Create Account" / "Register" link | Registration form appears with email, password, confirm password fields | `REGISTER` (RegisterScreen.kt) |
| 3 | Enter valid email address | Email field populated, no validation error | |
| 4 | Enter password (meets Cognito policy: 8+ chars, uppercase, lowercase, number, special) | Password field populated, strength indicator shown | |
| 5 | Enter matching confirm password | Confirm field matches, no mismatch error | |
| 6 | Tap "Register" / "Sign Up" button | Loading indicator shown; on success, navigate to verification screen | `VERIFICATION` (VerificationScreen.kt) |
| 7 | Enter 6-digit verification code from email | Code input field populated | |
| 8 | Tap "Verify" button | On success: navigate to CONSENT screen | `CONSENT` (ConsentScreen.kt) |
| 9 | Scroll through DPDP consent text (must scroll to bottom) | Full consent text visible, versioned consent text displayed | |
| 10 | Tap "I Accept" / consent checkbox + confirm button | Consent recorded; navigate to patient onboarding | `ONBOARDING` (PatientOnboardingScreen.kt) |

**Backend Verification:**
- Cognito: new user created in `relatives` group with `custom:persona_type = relative`
- RDS: consent record created with timestamp and consent text version
- API call: POST to consent endpoint (verify in network logs)

**Post-conditions:** Relative is authenticated, consent recorded, ready for patient creation.

---

### J-REL-002: Patient Account Creation by Relative

**Persona:** Relative (authenticated, post-consent)
**Preconditions:** J-REL-001 completed; relative on ONBOARDING screen
**Covers:** REQ-AUTH-005, REQ-LAMBDA-001

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | View patient onboarding form | Fields visible: name, date of birth, gender selector, blood type, medical conditions, allergies, medications, emergency contact | `ONBOARDING` (PatientOnboardingScreen.kt) |
| 2 | Enter patient full name | Name field populated | |
| 3 | Select date of birth (date picker) | DOB populated in expected format | |
| 4 | Select gender | Gender selector shows chosen value | |
| 5 | (Optional) Select blood type | Blood type dropdown populated | |
| 6 | (Optional) Enter medical conditions | Free-text or tag-style input populated | |
| 7 | (Optional) Enter allergies | Allergies field populated | |
| 8 | (Optional) Enter current medications | Medications field populated | |
| 9 | Enter emergency contact info | Emergency contact fields populated | |
| 10 | Tap "Create Patient" / "Save" button | Loading indicator; on success navigate to Relative Dashboard | `RELATIVE_DASHBOARD` (RelativeDashboardScreen.kt) |

**Backend Verification:**
- API call: `create-patient` Lambda triggered
- Cognito: patient account created in `patients` group with `custom:linked_patient_id` set, `custom:onboarded_by` = relative's Cognito sub
- RDS: patient record created, persona_links table entry linking relative to patient
- Unique Patient ID generated and returned

**Post-conditions:** Patient account exists, linked to relative. Relative sees their dashboard with the new patient.

---

### J-REL-003: Relative Dashboard Overview

**Persona:** Relative (authenticated, patient exists)
**Preconditions:** J-REL-002 completed; at least one patient linked
**Covers:** REQ-REL-001, REQ-REL-002

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | View Relative Dashboard | Dashboard shows: patient name, latest vitals summary (all 6 vital types), color-coded status per vital (green=normal, yellow=warning, red=breach), unread alert badge count, buttons for Trends/Alerts/Care Team/Settings | `RELATIVE_DASHBOARD` (RelativeDashboardScreen.kt) |
| 2 | Verify vital cards display | Each vital card shows: vital name, last value + unit, timestamp of last reading, color indicator (within/outside threshold) | |
| 3 | Verify empty state (new patient, no vitals yet) | Each vital card shows placeholder text (e.g., "No readings yet") | |
| 4 | Pull to refresh (if implemented) | Dashboard data refreshes from API | |

**Backend Verification:**
- API call: `GET /patients/{patientId}/summary` returns PatientSummary with latestVitals map, unreadAlertCount

**Post-conditions:** Relative can see patient health status at a glance.

---

### J-REL-004: Invite Attendant

**Persona:** Relative (authenticated)
**Preconditions:** Patient exists, linked to relative
**Covers:** REQ-AUTH-006, REQ-LAMBDA-002, REQ-REL-007

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | From Relative Dashboard, tap "Care Team" or navigate to Settings | Care Team screen or Settings screen appears | `CARE_TEAM` or `SETTINGS` |
| 2 | Tap "Invite Attendant" button | Invite Attendant form appears | `INVITE_ATTENDANT` (InviteAttendantScreen.kt) |
| 3 | Enter attendant name | Name field populated | |
| 4 | Enter attendant email address | Email field populated, validated | |
| 5 | (Optional) Select invite method: Email or SMS | Method toggle visible | |
| 6 | Tap "Send Invite" button | Loading indicator; on success: confirmation message displayed, navigate back to Care Team | |
| 7 | Verify invite appears in pending invites list | Care Team screen shows new pending invite with attendant name, email, "Pending" status, sent timestamp | `CARE_TEAM` (CareTeamScreen.kt) |

**Backend Verification:**
- API call: `invite-attendant` Lambda triggered
- SES: invite email sent to attendant's email address
- RDS: pending invite record created with invite token, expiry

**Post-conditions:** Attendant has received invite email; invite shows as pending in Care Team.

---

### J-REL-005: Invite Doctor (Doctor Onboarding Initiation)

**Persona:** Relative (authenticated)
**Preconditions:** Patient exists, linked to relative
**Covers:** REQ-AUTH-007, REQ-LAMBDA-003, REQ-REL-007, REQ-DOC-008

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | From Care Team or Settings, tap "Invite Doctor" | Invite Doctor form appears | `INVITE_DOCTOR` (InviteDoctorScreen.kt) |
| 2 | Enter doctor's name | Name field populated | |
| 3 | Enter doctor's email address | Email field populated, validated | |
| 4 | Tap "Send Invite" button | Loading indicator; on success: confirmation message ("Invite sent to Dr. X"), navigate back | |
| 5 | Verify invite appears in pending invites | Care Team screen shows doctor invite as "Pending" | `CARE_TEAM` (CareTeamScreen.kt) |

**Backend Verification:**
- API call: `invite-doctor` Lambda triggered
- SES: invite email sent with web portal registration link
- RDS: pending invite record with `role=doctor`, invite token
- Email content: contains link to CareLog web portal with invite token parameter

**Post-conditions:** Doctor has received email with web portal link. Doctor can now register on the web portal (tested separately in web portal journeys). Once doctor accepts, their status changes from "Pending" to active in Care Team.

**Note for Doctor Onboarding E2E:** After the doctor registers on the web portal (J-DOC-001), re-check the Care Team screen — the pending invite should transition to an active team member with doctor's name and join date.

---

### J-REL-006: Configure Vital Thresholds

**Persona:** Relative (authenticated)
**Preconditions:** Patient exists
**Covers:** REQ-ALERT-004, REQ-ALERT-005, REQ-ALERT-007, REQ-REL-005

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | From Relative Dashboard, navigate to Thresholds | Threshold configuration screen appears | `THRESHOLDS` (ThresholdConfigScreen.kt) |
| 2 | View all vital types listed | Each vital shows: vital name, current min value, current max value, unit, editable fields (unless set by doctor) | |
| 3 | Tap Blood Pressure row to edit | Min/Max input fields for systolic BP become editable | |
| 4 | Enter min value (e.g., 90) | Min field populated | |
| 5 | Enter max value (e.g., 140) | Max field populated | |
| 6 | Tap "Save" for BP threshold | Loading indicator; success feedback | |
| 7 | Repeat for Glucose: min=70, max=140 | Glucose threshold saved | |
| 8 | Repeat for SpO2: min=92, max=100 | SpO2 threshold saved | |
| 9 | Repeat for Temperature: min=96.0, max=99.5 | Temperature threshold saved | |
| 10 | Repeat for Pulse: min=60, max=100 | Pulse threshold saved | |
| 11 | Repeat for Weight (if applicable) | Weight threshold saved | |
| 12 | Verify doctor-override indicator | If a doctor has set a threshold for any vital, that vital's row shows "Set by Dr. X" label and fields are read-only/locked | |

**Backend Verification:**
- API call: `PUT /patients/{patientId}/thresholds` with JSON body per vital
- RDS: threshold records created/updated with relative's identity
- Verify threshold hierarchy: if doctor threshold exists, relative's is subordinate

**Post-conditions:** Thresholds active for all configured vitals. Future readings outside range will trigger alerts.

---

### J-REL-007: Configure Reminder Windows

**Persona:** Relative (authenticated)
**Preconditions:** Patient exists
**Covers:** REQ-ALERT-001, REQ-REL-006

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | From Relative Dashboard, navigate to Reminders | Reminder configuration screen appears | `REMINDERS` (ReminderConfigScreen.kt) |
| 2 | View all vital types listed | Each vital shows: vital name, window hours input, grace period minutes input, enable/disable toggle | |
| 3 | Set Blood Pressure reminder: window=12 hours, grace=30 min, enabled=true | BP reminder fields populated, toggle on | |
| 4 | Set Glucose reminder: window=8 hours, grace=15 min, enabled=true | Glucose reminder configured | |
| 5 | Set Temperature reminder: window=24 hours, grace=60 min, enabled=true | Temperature reminder configured | |
| 6 | Leave Weight reminder disabled | Weight toggle off | |
| 7 | Tap "Save" | Loading indicator; success confirmation | |

**Backend Verification:**
- API call: `PUT /patients/{patientId}/reminders` with JSON body per vital
- RDS: reminder_configs records created/updated

**Post-conditions:** Reminder system active. Patient device will receive push notifications when windows lapse. Relative device will receive secondary notification after grace period.

---

### J-REL-008: View Trends

**Persona:** Relative (authenticated)
**Preconditions:** Patient has logged vitals over multiple days
**Covers:** REQ-REL-004

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | From Relative Dashboard, tap "Trends" | Trends screen appears with chart area | `TRENDS` (TrendsScreen.kt) |
| 2 | View default chart (first vital type, 7-day range) | Line/area chart rendered with data points, X-axis=dates, Y-axis=vital values | |
| 3 | Switch vital type (e.g., from BP to Glucose) | Chart re-renders with glucose data | |
| 4 | Switch date range to 30 days | Chart expands to show 30-day data | |
| 5 | Switch date range to 90 days | Chart shows 90-day range | |
| 6 | Verify threshold overlay lines | If thresholds are configured, horizontal lines show min/max boundaries on chart | |
| 7 | Verify empty state for vital with no data | Chart shows "No data available" message | |

**Backend Verification:**
- API call: `GET /patients/{patientId}/observations?vitalType=X&startDate=Y&endDate=Z`

**Post-conditions:** Relative has reviewed patient's vital trends over time.

---

### J-REL-009: View Alert Inbox

**Persona:** Relative (authenticated)
**Preconditions:** Patient has triggered threshold breaches or reminder lapses
**Covers:** REQ-REL-003, REQ-REL-009

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | From Relative Dashboard, tap alert badge / "Alerts" | Alert Inbox screen appears | `ALERTS` (AlertInboxScreen.kt) |
| 2 | View alert list | Chronological list showing: alert type icon (threshold breach / reminder lapse / system), vital type, value (if breach), message text, timestamp, read/unread indicator | |
| 3 | Tap on an unread alert | Alert detail shown or marked as read | |
| 4 | Verify alert types distinguished | Threshold breach alerts show the breaching value vs. threshold range; reminder lapse alerts show which vital and how overdue | |
| 5 | Dismiss/mark alert as read | Alert visual changes to read state | |

**Backend Verification:**
- API call: `GET /patients/{patientId}/alerts?unreadOnly=true` (initial load)
- API call: `PATCH /alerts/{alertId}` with `{"read": true}` on dismiss
- Verify unread count on dashboard decrements after reading alerts

**Post-conditions:** Alerts reviewed, unread count updated.

---

### J-REL-010: View Audit Log

**Persona:** Relative (authenticated)
**Preconditions:** Multiple personas have logged activities (patient, attendant)
**Covers:** REQ-REL-008

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Navigate to Audit Log (from Settings or Care Team) | Audit Log screen appears | `AUDIT_LOG` (AuditLogScreen.kt) |
| 2 | View activity entries | Chronological list showing: actor name + role, action description (e.g., "logged Blood Pressure"), timestamp | |
| 3 | Verify attendant entries are attributed correctly | Entries by attendant show "Attendant [Name]" distinctly from "Patient [Name]" | |
| 4 | Filter by role (if available) | List filters to show only selected role's activities | |
| 5 | Filter by action type (if available) | List filters to specific action types | |

**Backend Verification:**
- API call to fetch audit/activity log for patient

**Post-conditions:** Relative has visibility into who performed what actions on the patient's account.

---

### J-REL-011: Remove Team Member

**Persona:** Relative (authenticated)
**Preconditions:** At least one attendant or doctor in Care Team
**Covers:** REQ-AUTH-009, REQ-LAMBDA-005, REQ-REL-007

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Navigate to Care Team | Team members listed with remove options | `CARE_TEAM` (CareTeamScreen.kt) |
| 2 | Tap remove button on an attendant | Confirmation dialog appears: "Remove [Name] from care team?" | |
| 3 | Confirm removal | Loading; member disappears from list | |
| 4 | Verify member is gone from the list | Team list no longer shows removed member | |

**Backend Verification:**
- API call: `DELETE /patients/{patientId}/team/{memberId}`
- `remove-team-member` Lambda triggered
- RDS: persona_links record removed
- Cognito: team member's `custom:linked_patient_id` cleared

**Post-conditions:** Removed member can no longer access patient data.

---

### J-REL-012: Delete Patient (Cascade Delete)

**Persona:** Relative (authenticated)
**Preconditions:** Patient exists with data (vitals, uploads, team members)
**Covers:** REQ-AUTH-010, REQ-LAMBDA-006, REQ-SEC-010

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Navigate to Settings | Settings screen appears | `SETTINGS` (SettingsScreen.kt) |
| 2 | Tap "Delete Patient" | Warning/confirmation dialog appears with strong language about irreversibility | |
| 3 | Confirm deletion (possibly type patient name or enter password) | Loading indicator; extensive operation | |
| 4 | On success | Navigate to empty state or re-onboarding flow | |

**Backend Verification:**
- API call: `delete-patient` Lambda triggered
- RDS: patient record deleted, all persona_links cascade deleted, thresholds/reminders deleted
- S3: patient's observation files and uploads deleted (subject to HIPAA retention overrides)
- Cognito: patient account disabled/deleted

**Post-conditions:** Patient and all associated data removed. Team members unlinked.

---

## PART 2 — PATIENT JOURNEYS

The patient is the primary health data logger. These journeys run on the patient's device.

---

### J-PAT-001: Patient Login

**Persona:** Patient (credentials created by relative during onboarding)
**Preconditions:** Patient account created via J-REL-002; patient has received credentials
**Covers:** REQ-AUTH-011

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Launch app on patient's device | Splash screen → LOGIN (no stored session) | `SPLASH` → `LOGIN` |
| 2 | Enter patient email/username | Email field populated | `LOGIN` (LoginScreen.kt) |
| 3 | Enter patient password | Password field populated (masked) | |
| 4 | Tap "Sign In" button (72dp+ touch target) | Loading indicator; Cognito authenticates | |
| 5 | On success: persona routing | Splash logic reads `custom:persona_type = patient`, routes to Patient Dashboard | `PATIENT_DASHBOARD` (DashboardScreen.kt) |
| 6 | Verify biometric/passcode enforcement | If device has no passcode/biometric set, app shows warning or blocks access | |

**Backend Verification:**
- Cognito: JWT access token (1hr) + refresh token (30 days) issued
- Tokens stored in secure device keystore (Android Keystore)

**Post-conditions:** Patient is logged in and sees their dashboard.

---

### J-PAT-002: Patient Dashboard Orientation

**Persona:** Patient (authenticated)
**Preconditions:** Patient logged in
**Covers:** REQ-PAT-001, REQ-PAT-002, REQ-PAT-003, REQ-PAT-005, REQ-PAT-006, REQ-SYNC-007

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | View Patient Dashboard | Large-button grid visible with: Blood Pressure, Glucose, Temperature, Weight, Pulse, SpO2, Upload (media), Chat (LLM placeholder). Patient name displayed. Sync status badge visible. | `PATIENT_DASHBOARD` (DashboardScreen.kt) |
| 2 | Verify button sizes | All primary vital buttons are 72dp+ touch targets | |
| 3 | Verify bottom tab bar | 3-4 tabs visible at bottom (e.g., Home, History, Chat, Settings). No hidden hamburger menu. | |
| 4 | Verify sync status indicator | Badge shows pending sync count (e.g., "3 pending") or "All synced" | |
| 5 | Verify settings icon accessible | Settings gear/icon visible, tappable | |
| 6 | Verify contrast ratios | Text and buttons meet WCAG AA (4.5:1 minimum), primary elements target AAA (7:1) | |
| 7 | Verify reminder prompt (if applicable) | If a reminder window has lapsed, a prominent prompt is shown on dashboard | |

**Backend Verification:**
- Dashboard loads patient data from local store (no network required)
- Sync status reflects actual pending queue count

**Post-conditions:** Patient understands their dashboard layout and can navigate to any feature.

---

### J-PAT-003: Log Blood Pressure

**Persona:** Patient (authenticated)
**Preconditions:** Patient on dashboard
**Covers:** REQ-VIT-004, REQ-VIT-005, REQ-VIT-008, REQ-VIT-009, REQ-VIT-010, REQ-VIT-011, REQ-VOICE-001, REQ-VOICE-002, REQ-VOICE-005, REQ-VOICE-006, REQ-SYNC-001

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "Blood Pressure" button on dashboard | Full-screen BP input screen appears with two large numeric fields (systolic and diastolic) | `BLOOD_PRESSURE` (BloodPressureScreen.kt) |
| 2 | Verify single-action screen | Only BP input is shown — no other vitals or distractions. Large numeric keypad visible. | |
| 3 | Enter systolic value (e.g., 120) | Systolic field populated, large digits visible | |
| 4 | Enter diastolic value (e.g., 80) | Diastolic field populated | |
| 5 | Tap "Save" button (72dp+ target) | Loading briefly; success acknowledgement shown | |
| 6 | **Verify voice acknowledgement plays** | Pre-recorded human voice clip plays: "Your blood pressure has been saved successfully." Audio plays via media stream (audible even in silent mode). Latency < 500ms. | |
| 7 | View success dialog/acknowledgement | SaveAcknowledgement composable shown with confirmation | |
| 8 | Navigate back to dashboard | Dashboard shows updated state | `PATIENT_DASHBOARD` |

**Backend Verification:**
- Local DB: FHIR R4 Observation created with:
  - `resourceType: "Observation"`
  - Systolic component: LOINC code `8480-6`, value=120, unit="mmHg"
  - Diastolic component: LOINC code `8462-4`, value=80, unit="mmHg"
  - `performer` reference = patient's Cognito sub
  - `effectiveDateTime` = current timestamp
  - `status` = "final"
  - Sync status = "pending" (if offline) or "synced" (if WiFi available)
- If WiFi available: API call to `sync-observations` Lambda, observation stored in S3 at `observations/{patientId}/{YYYY}/{MM}/{DD}/{observationId}.json`

**Post-conditions:** BP reading saved locally as valid FHIR Observation. Voice acknowledgement confirmed.

---

### J-PAT-004: Log Glucose Reading

**Persona:** Patient (authenticated)
**Preconditions:** Patient on dashboard
**Covers:** REQ-VIT-002, REQ-VIT-008, REQ-VIT-009, REQ-VIT-011, REQ-VOICE-001, REQ-VOICE-002

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "Glucose" button on dashboard | Full-screen glucose input with single numeric field, unit selector (mg/dL or mmol/L) | `GLUCOSE` (GlucoseScreen.kt) |
| 2 | Enter glucose value (e.g., 110) | Value field populated | |
| 3 | Verify unit selector defaults (mg/dL) | Unit toggle visible, default selected | |
| 4 | Tap "Save" | Success acknowledgement | |
| 5 | Verify voice acknowledgement | Glucose-specific voice clip plays | |
| 6 | Navigate back to dashboard | Dashboard updated | `PATIENT_DASHBOARD` |

**Backend Verification:**
- FHIR Observation: LOINC `2339-0`, value=110, unit="mg/dL", performer=patient sub

---

### J-PAT-005: Log Temperature

**Persona:** Patient (authenticated)
**Covers:** REQ-VIT-003

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "Temperature" on dashboard | Full-screen temperature input, unit toggle (Celsius/Fahrenheit) | `TEMPERATURE` (TemperatureScreen.kt) |
| 2 | Enter value (e.g., 98.6) | Value populated with decimal support | |
| 3 | Verify Fahrenheit/Celsius toggle | Toggle switches unit and potentially converts value | |
| 4 | Tap "Save" | Success with voice acknowledgement | |

**Backend Verification:**
- FHIR Observation: LOINC `8310-5`, value=98.6, unit="[degF]"

---

### J-PAT-006: Log Weight

**Persona:** Patient (authenticated)
**Covers:** REQ-VIT-001

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "Weight" on dashboard | Full-screen weight input, unit toggle (kg/lbs) | `WEIGHT` (WeightScreen.kt) |
| 2 | Enter value (e.g., 72.5) | Value populated | |
| 3 | Tap "Save" | Success with voice acknowledgement | |

**Backend Verification:**
- FHIR Observation: LOINC `29463-7`, value=72.5, unit="kg"

---

### J-PAT-007: Log Pulse/Heart Rate

**Persona:** Patient (authenticated)
**Covers:** REQ-VIT-006

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "Pulse" on dashboard | Full-screen pulse input (bpm) | `PULSE` (PulseScreen.kt) |
| 2 | Enter value (e.g., 72) | Value populated | |
| 3 | Tap "Save" | Success with voice acknowledgement | |

**Backend Verification:**
- FHIR Observation: LOINC `8867-4`, value=72, unit="bpm"

---

### J-PAT-008: Log SpO2

**Persona:** Patient (authenticated)
**Covers:** REQ-VIT-007

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "SpO2" on dashboard | Full-screen SpO2 input (percentage) | `SPO2` (SpO2Screen.kt) |
| 2 | Enter value (e.g., 98) | Value populated | |
| 3 | Tap "Save" | Success with voice acknowledgement | |

**Backend Verification:**
- FHIR Observation: LOINC `2708-6`, value=98, unit="%"

---

### J-PAT-009: View Vital History

**Persona:** Patient (authenticated)
**Preconditions:** Multiple vitals logged across different days
**Covers:** REQ-VIT-012

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "History" tab in bottom bar or History button | History screen appears | `HISTORY` (HistoryScreen.kt) |
| 2 | View observation list | Chronological list (newest first) showing: vital type icon, value + unit, timestamp, who recorded it (patient name or attendant name), sync status icon (synced/pending/error) | |
| 3 | Filter by vital type (if available) | List filters to show only selected vital | |
| 4 | Filter by date range (if available) | List shows entries within selected range | |
| 5 | Scroll through entries | All logged vitals visible, properly formatted | |
| 6 | Verify sync status icons | Synced entries show checkmark; pending show clock; error shows warning icon | |

**Backend Verification:**
- Data loaded from local Room DB / Spezi FHIR store (works offline)
- Sync status matches actual sync queue state

**Post-conditions:** Patient can review all their logged vitals.

---

### J-PAT-010: Upload Prescription Scan

**Persona:** Patient (authenticated)
**Preconditions:** Patient on dashboard
**Covers:** REQ-UNS-001, REQ-UNS-006, REQ-UNS-007, REQ-UNS-008, REQ-UNS-009, REQ-UNS-010

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "Upload" button on dashboard | Upload menu screen appears with media type options | `UPLOAD` (UploadScreen.kt) |
| 2 | Tap "Prescription Scan" option | Camera/document capture screen opens | `PRESCRIPTION_SCAN` (PrescriptionScanScreen.kt) |
| 3 | Grant camera permission (if first time) | Permission dialog shown, grant access | |
| 4 | Capture prescription photo | Camera preview shown, capture button visible | |
| 5 | Review captured image | Preview of taken photo with retake/confirm options | |
| 6 | Tap "Confirm" / "Upload" | Loading indicator; file saved locally | |
| 7 | Verify voice acknowledgement | Upload success voice clip plays | |
| 8 | Navigate back | Returns to upload menu or dashboard | |

**Backend Verification:**
- File stored locally in app's private storage
- If WiFi available:
  - API call: `POST /patients/{patientId}/upload/presigned-url` → receives S3 presigned URL
  - Direct upload to S3 via presigned URL
  - S3 key format: `{patient_id}/{year}/{month}/{day}/{timestamp}_prescription_{filename}`
  - SQS message enqueued with: patient_id, s3_key, file_type=prescription, uploader_persona=patient, timestamp
- FHIR DocumentReference created locally pointing to S3 key

---

### J-PAT-011: Upload Medical Photo (Wound/Condition)

**Persona:** Patient (authenticated)
**Covers:** REQ-UNS-003

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | From Upload menu, tap "Camera" / "Medical Photo" | Camera screen opens with FileType=MEDICAL_PHOTO | `CAMERA/{MEDICAL_PHOTO}` (CameraScreen.kt) |
| 2 | Capture photo | Photo taken | |
| 3 | Review and confirm | Photo uploaded/queued | |
| 4 | Verify voice acknowledgement | Success clip plays | |

**Backend Verification:**
- S3 key: `{patient_id}/{year}/{month}/{day}/{timestamp}_medical_photo_{filename}`
- FHIR DocumentReference created

---

### J-PAT-012: Record Voice Note

**Persona:** Patient (authenticated)
**Covers:** REQ-UNS-004

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | From Upload menu, tap "Voice Note" | Voice recorder screen appears | `VOICE_NOTE` (VoiceRecorderScreen.kt) |
| 2 | Grant microphone permission (if first time) | Permission dialog shown | |
| 3 | Tap record button | Recording indicator animates, timer shows duration | |
| 4 | Speak observation (e.g., "Patient reports mild headache since morning") | Recording in progress | |
| 5 | Tap stop button | Recording stops; playback preview available | |
| 6 | Play back recording to verify | Audio plays back correctly | |
| 7 | Tap "Save" / "Upload" | File saved/uploaded; voice acknowledgement plays | |

**Backend Verification:**
- Audio file stored locally, queued for S3 upload
- S3 key: `{patient_id}/{year}/{month}/{day}/{timestamp}_voice_note_{filename}`

---

### J-PAT-013: Record Video Note

**Persona:** Patient (authenticated)
**Covers:** REQ-UNS-005

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | From Upload menu, tap "Video Note" | Video recorder screen appears | `VIDEO_NOTE` (VideoRecorderScreen.kt) |
| 2 | Grant camera + microphone permissions | Permissions granted | |
| 3 | Tap record | Video recording starts with timer | |
| 4 | Tap stop | Recording stops, preview available | |
| 5 | Tap "Save" / "Upload" | Video saved/uploaded; voice acknowledgement plays | |

**Backend Verification:**
- Video file stored locally, queued for S3 upload
- S3 key: `{patient_id}/{year}/{month}/{day}/{timestamp}_video_note_{filename}`

---

### J-PAT-014: Upload Lab/Test Results

**Persona:** Patient (authenticated)
**Covers:** REQ-UNS-002

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | From Upload menu, tap file picker / "Lab Results" | System file picker opens (PDF/image filter) | |
| 2 | Select a PDF or image file | File selected, preview shown | |
| 3 | Confirm upload | File queued/uploaded; voice acknowledgement | |

**Backend Verification:**
- S3 key: `{patient_id}/{year}/{month}/{day}/{timestamp}_lab_result_{filename}`
- FHIR DocumentReference with content type

---

### J-PAT-015: LLM Chat Placeholder

**Persona:** Patient (authenticated)
**Covers:** REQ-PAT-007

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "Chat" button on dashboard or Chat tab | Chat placeholder screen appears | `CHAT` (ChatPlaceholderScreen.kt) |
| 2 | Verify "Coming Soon" message | Screen displays a "Coming soon" message or placeholder UI | |
| 3 | Verify no input is possible | No text input field or send button functional | |
| 4 | Navigate back to dashboard | Single tap returns to dashboard | |

---

### J-PAT-016: Offline Vital Logging and WiFi Sync

**Persona:** Patient (authenticated)
**Preconditions:** Device in airplane mode / WiFi disabled
**Covers:** REQ-SYNC-001, REQ-SYNC-002, REQ-SYNC-003, REQ-SYNC-004, REQ-SYNC-007, REQ-NFR-002, REQ-NFR-004

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Disable WiFi on emulator (airplane mode) | Network indicator shows offline | |
| 2 | Log Blood Pressure: 130/85 | Save succeeds locally; voice acknowledgement plays | `BLOOD_PRESSURE` |
| 3 | Log Glucose: 105 | Save succeeds locally; voice acknowledgement plays | `GLUCOSE` |
| 4 | Log SpO2: 97 | Save succeeds locally; voice acknowledgement plays | `SPO2` |
| 5 | Check dashboard sync status | Badge shows "3 pending" or similar | `PATIENT_DASHBOARD` |
| 6 | Check History screen | All 3 entries visible with "pending" sync status | `HISTORY` |
| 7 | Enable WiFi on emulator | Network indicator shows connected | |
| 8 | **Wait up to 5 seconds** | Sync initiates automatically (WiFi connectivity listener triggers flush) | |
| 9 | Check dashboard sync status | Badge transitions from "3 pending" → "2 pending" → "1 pending" → "All synced" | |
| 10 | Check History screen | Sync status icons change from pending → synced for all 3 entries | `HISTORY` |

**Backend Verification:**
- Sync queue flushed in FIFO order
- 3 API calls to `sync-observations` Lambda
- 3 FHIR Observation JSON files created in S3 at correct paths
- Each observation has correct patient ID, LOINC code, value, timestamp
- Conflict resolution: if server already has observation with same ID, server-wins (timestamp comparison)

**Post-conditions:** All offline readings now synced to backend. Sync status cleared.

---

### J-PAT-017: Threshold Breach During Logging

**Persona:** Patient (authenticated)
**Preconditions:** Thresholds configured by relative (J-REL-006): BP max=140
**Covers:** REQ-ALERT-006, REQ-NFR-009

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Log Blood Pressure: 155/95 (above threshold) | Save succeeds; voice acknowledgement plays | `BLOOD_PRESSURE` |
| 2 | Verify value color-coding (if implemented) | BP input or history shows value in red/warning color since it exceeds threshold | |
| 3 | **On relative's device (within 60 seconds):** | Push notification received: "Blood Pressure alert: 155/95 mmHg exceeds threshold of 140 mmHg" | |

**Backend Verification:**
- Observation synced to backend
- Backend evaluates threshold → breach detected
- SNS/FCM push notification sent to relative's device
- Alert record created in backend (visible in relative's Alert Inbox)

---

### J-PAT-018: Reminder Notification Received

**Persona:** Patient (on patient's device)
**Preconditions:** Reminder configured (J-REL-007): BP every 12 hours. Last BP log was 13 hours ago.
**Covers:** REQ-ALERT-002, REQ-ALERT-008

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Wait for reminder window to lapse | Push notification appears on patient device: "Time to log your Blood Pressure" | System notification |
| 2 | Open app from notification | App opens to dashboard | `PATIENT_DASHBOARD` |
| 3 | Verify dashboard prompt | Prominent prompt/banner on dashboard: "Blood Pressure is overdue" or similar highlighted indicator | |
| 4 | Log BP reading | Normal BP logging flow, prompt clears after logging | |

**Backend Verification:**
- Reminder system detected lapse and sent FCM push to patient device
- If grace period also exceeded: secondary push sent to relative's device (REQ-ALERT-003)

---

### J-PAT-019: Voice Acknowledgement Failure Clip

**Persona:** Patient (authenticated)
**Preconditions:** WiFi off, attempting upload of large file that fails or encountering a network error state
**Covers:** REQ-VOICE-003

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Attempt an action that results in a failure state | Failure state triggers | |
| 2 | Verify failure voice clip plays | Generic failure voice clip plays: "Upload could not be completed" or "No network connection" | |
| 3 | Verify audio plays in silent mode | Even if device ringer is off, clip plays via media audio stream | |

---

### J-PAT-020: Patient Settings and Care Team View

**Persona:** Patient (authenticated)
**Covers:** REQ-PAT-006

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap Settings icon on dashboard | Settings screen appears | `SETTINGS` (SettingsScreen.kt) |
| 2 | View user info | Patient name, email, persona type displayed | |
| 3 | Tap "Care Team" | Care Team screen shows linked relative(s), attendant(s), doctor(s) | `CARE_TEAM` |
| 4 | Verify patient cannot invite or remove team members | Invite/remove buttons not visible or disabled for patient persona | |
| 5 | Navigate back to dashboard (single tap) | Dashboard reachable from any screen | |

---

## PART 3 — ATTENDANT JOURNEYS

The attendant logs vitals on the patient's device under their own identity.

---

### J-ATT-001: Attendant Login on Patient Device

**Persona:** Attendant (invited via J-REL-004, accepted invite)
**Preconditions:** Patient device is available; attendant has own credentials; patient app is at dashboard or login screen
**Covers:** REQ-AUTH-013, REQ-ATT-001, REQ-ATT-002

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | On patient's device, find "Switch to Attendant" option | Option visible on patient dashboard or login screen | |
| 2 | Tap "Switch to Attendant" | Attendant login screen appears | `ATTENDANT_LOGIN` (AttendantLoginScreen.kt) |
| 3 | Enter attendant email/username | Email field populated | |
| 4 | Enter attendant password | Password field populated | |
| 5 | Tap "Sign In" | Loading; credentials validated against Cognito (attendant group) | |
| 6 | On success: attendant dashboard loads | Attendant Dashboard appears with identity banner: "Recording as: [Attendant Name]" | `ATTENDANT_DASHBOARD` (AttendantDashboardScreen.kt) |
| 7 | Verify 8-hour session indicator | Session expiry info shown or noted | |

**Backend Verification:**
- Cognito: attendant authenticated, JWT issued
- AttendantSessionManager: encrypted session token stored in SharedPreferences with 8-hour expiry

**Post-conditions:** Attendant is logged in on patient's device. All subsequent actions attributed to attendant.

---

### J-ATT-002: Attendant Dashboard Orientation

**Persona:** Attendant (authenticated on patient device)
**Covers:** REQ-ATT-003

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | View Attendant Dashboard | Same large-button grid as patient (6 vitals + upload + notes + history). Identity banner clearly shows attendant name. "Switch back to Patient" option visible. | `ATTENDANT_DASHBOARD` (AttendantDashboardScreen.kt) |
| 2 | Verify all vital buttons are present | BP, Glucose, Temperature, Weight, Pulse, SpO2 — all 72dp+ | |
| 3 | Verify Upload and Notes buttons | Upload media button and Attendant Notes button visible | |

---

### J-ATT-003: Attendant Logs Vitals (Attributed to Attendant)

**Persona:** Attendant (authenticated)
**Preconditions:** Attendant on dashboard
**Covers:** REQ-ATT-004, REQ-VIT-010, REQ-ATT-011

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "Blood Pressure" | BP input screen (same as patient flow) | `BLOOD_PRESSURE` |
| 2 | Enter systolic: 125, diastolic: 82 | Values populated | |
| 3 | Tap "Save" | Save succeeds; voice acknowledgement plays | |
| 4 | Tap "Glucose" from dashboard | Glucose input screen | `GLUCOSE` |
| 5 | Enter glucose: 95 | Value populated | |
| 6 | Tap "Save" | Save succeeds; voice acknowledgement plays | |

**Backend Verification (CRITICAL — audit attribution):**
- FHIR Observations for BOTH entries have:
  - `performer` reference = **attendant's** Cognito sub (NOT patient's)
  - `subject` reference = patient's ID
- Local DB entries tagged with attendant identity
- When synced: S3 observation JSON contains attendant as performer
- **Audit log test:** On relative's device, Audit Log (J-REL-010) should show "Attendant [Name] logged Blood Pressure at [time]"

**Post-conditions:** Vitals logged and correctly attributed to attendant in FHIR audit trail.

---

### J-ATT-004: Attendant Uploads Media

**Persona:** Attendant (authenticated)
**Covers:** REQ-ATT-005

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "Upload" from attendant dashboard | Upload menu appears | `UPLOAD` |
| 2 | Select "Medical Photo" | Camera opens | `CAMERA/{MEDICAL_PHOTO}` |
| 3 | Capture and confirm photo | Photo saved/uploaded | |
| 4 | Verify voice acknowledgement | Success clip plays | |

**Backend Verification:**
- S3 upload metadata includes `uploader_persona=attendant` and attendant's Cognito sub
- FHIR DocumentReference performer = attendant's identity

---

### J-ATT-005: Attendant Adds Free-Text Observation Notes

**Persona:** Attendant (authenticated)
**Covers:** REQ-ATT-006

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "Notes" / "Attendant Notes" from dashboard | Notes screen appears | `ATTENDANT_NOTES` (AttendantNotesScreen.kt) |
| 2 | Enter free-text observation (e.g., "Patient appeared fatigued today. Appetite was reduced. Minor swelling in left ankle observed.") | Text area populated | |
| 3 | Tap "Save" | Note saved locally; synced when WiFi available | |

**Backend Verification:**
- Observation note saved with attendant identity as author
- FHIR-compliant note resource created

---

### J-ATT-006: Attendant Records Voice Note Observation

**Persona:** Attendant (authenticated)
**Covers:** REQ-ATT-007

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | From Attendant Notes screen, tap "Record Voice Note" | Voice recorder appears | `VOICE_NOTE` or inline recorder |
| 2 | Record observation verbally | Recording in progress with timer | |
| 3 | Stop and save | Voice note saved with attendant attribution | |

**Backend Verification:**
- Audio file attributed to attendant in metadata

---

### J-ATT-007: Attendant Views Patient History

**Persona:** Attendant (authenticated)
**Covers:** REQ-ATT-008

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "History" from attendant dashboard | History screen appears | `HISTORY` |
| 2 | View all entries | Both patient-logged and attendant-logged entries visible with attribution labels | |
| 3 | Verify entries show who recorded them | Each entry displays "Patient" or "Attendant [Name]" | |

---

### J-ATT-008: Attendant Configures Thresholds and Reminders

**Persona:** Attendant (authenticated)
**Covers:** REQ-ATT-009

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Navigate to threshold or reminder config (from settings or dashboard) | Threshold/reminder configuration available to attendant | `THRESHOLDS` / `REMINDERS` |
| 2 | Modify a threshold value | Value editable (unless doctor-locked) | |
| 3 | Save | Change persisted | |

**Backend Verification:**
- Threshold/reminder update attributed to attendant
- Doctor overrides still take precedence

---

### J-ATT-009: Attendant Cannot Access Relative-Only Settings

**Persona:** Attendant (authenticated)
**Covers:** REQ-ATT-010

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Navigate to Settings | Settings screen visible | `SETTINGS` |
| 2 | Verify "Invite Attendant" is NOT available | Button hidden or disabled | |
| 3 | Verify "Invite Doctor" is NOT available | Button hidden or disabled | |
| 4 | Verify "Delete Patient" is NOT available | Button hidden or disabled | |
| 5 | Verify "Remove Team Member" is NOT accessible | Not shown or access denied | |

**Backend Verification:**
- Even if attendant crafts direct API calls, server-side authorization blocks these operations for attendant persona

---

### J-ATT-010: Attendant Session Expiry

**Persona:** Attendant (8-hour session active)
**Preconditions:** Attendant logged in 8+ hours ago
**Covers:** REQ-AUTH-013

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | After 8 hours, attempt any action | Session expired; prompted to re-login or switched back to patient mode | |
| 2 | Verify automatic logout | Attendant session cleared from AttendantSessionManager | |
| 3 | Device returns to patient mode or attendant login | Patient dashboard or attendant login prompt | |

---

### J-ATT-011: Switch Back to Patient Mode

**Persona:** Attendant (authenticated)
**Covers:** REQ-ATT-001

| Step | Action | Expected UI State | Screen/Route |
|------|--------|-------------------|--------------|
| 1 | Tap "Switch to Patient" on attendant dashboard | Confirmation or immediate switch | |
| 2 | App returns to Patient Dashboard | Patient identity context restored; attendant session ends or pauses | `PATIENT_DASHBOARD` |

---

## PART 4 — CROSS-PERSONA END-TO-END JOURNEYS

These journeys span multiple personas and verify the full system works end-to-end.

---

### J-E2E-001: Complete Onboarding → First Vital → Relative Sees Data

**Personas:** Relative, then Patient
**Covers:** Full onboarding + first use flow

| Step | Persona | Action | Expected Result |
|------|---------|--------|-----------------|
| 1 | Relative | Complete J-REL-001 (registration) | Relative account created |
| 2 | Relative | Complete J-REL-002 (patient creation) | Patient account created, linked |
| 3 | Relative | Complete J-REL-006 (set BP threshold: 90-140) | Thresholds active |
| 4 | Relative | Complete J-REL-007 (set BP reminder: 12hr) | Reminders active |
| 5 | Patient | Login on patient device (J-PAT-001) | Patient sees dashboard |
| 6 | Patient | Log BP: 120/80 (J-PAT-003) | Observation saved, synced |
| 7 | Relative | Open Relative Dashboard | Latest BP shows 120/80, green status (within threshold), timestamp matches |
| 8 | Relative | Check Trends | BP data point visible on chart |
| 9 | Relative | Check Alerts | No alerts (value within threshold) |

---

### J-E2E-002: Threshold Breach → Relative Alert → Relative Reviews

**Personas:** Patient, Relative
**Preconditions:** Thresholds set (BP max=140), patient logged in

| Step | Persona | Action | Expected Result |
|------|---------|--------|-----------------|
| 1 | Patient | Log BP: 160/100 | Saved, synced, voice acknowledgement |
| 2 | Relative | Receive push notification within 60 seconds | "BP alert: 160/100 exceeds 140" |
| 3 | Relative | Open app → Dashboard | BP card shows 160/100 in red/warning |
| 4 | Relative | Check Alert Inbox | New unread alert: threshold breach |
| 5 | Relative | Tap alert to mark as read | Alert marked read, unread count decrements |

---

### J-E2E-003: Attendant Logs → Audit Trail → Relative Reviews Attribution

**Personas:** Attendant, Relative
**Preconditions:** Attendant invited and accepted

| Step | Persona | Action | Expected Result |
|------|---------|--------|-----------------|
| 1 | Attendant | Login on patient device (J-ATT-001) | Attendant dashboard with identity banner |
| 2 | Attendant | Log BP: 118/76 | Observation saved with attendant as performer |
| 3 | Attendant | Add note: "Patient had good appetite" | Note saved with attendant identity |
| 4 | Relative | Open Audit Log | Entry: "Attendant [Name] logged Blood Pressure 118/76 at [time]" |
| 5 | Relative | Open History (or Dashboard) | BP reading shows "Recorded by: Attendant [Name]" |

---

### J-E2E-004: Doctor Onboarding Full Flow

**Personas:** Relative, Doctor (web portal)
**Preconditions:** Patient exists, relative authenticated

| Step | Persona | Action | Expected Result |
|------|---------|--------|-----------------|
| 1 | Relative | Invite doctor (J-REL-005) | Invite sent, pending in Care Team |
| 2 | Doctor | Receive email with web portal link | Email contains registration link |
| 3 | Doctor | Register on web portal via Cognito | Doctor account created in `doctors` group |
| 4 | Doctor | Linked to patient on web portal | Doctor sees patient in patient list |
| 5 | Relative | Refresh Care Team screen | Doctor status changes from "Pending" to active, shows join date |
| 6 | Doctor | Set BP threshold override: max=130 on web portal | Threshold saved |
| 7 | Relative | View threshold config on mobile | BP threshold shows "Set by Dr. [Name]" — read-only, value=130 |
| 8 | Patient | Log BP: 135/88 | Value exceeds doctor-set threshold of 130 |
| 9 | Relative | Receive push notification | "BP alert: 135/88 exceeds doctor-set threshold of 130" |

---

### J-E2E-005: Offline Multi-Vital Logging → Bulk Sync → Data Consistency

**Personas:** Patient
**Preconditions:** WiFi off, thresholds configured

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Disable WiFi | Airplane mode enabled |
| 2 | Log BP: 122/78 | Saved locally, sync pending |
| 3 | Log Glucose: 140 | Saved locally, sync pending |
| 4 | Log Temperature: 99.1 | Saved locally, sync pending |
| 5 | Log SpO2: 96 | Saved locally, sync pending |
| 6 | Upload wound photo | Photo saved locally, upload pending |
| 7 | Record voice note | Audio saved locally, upload pending |
| 8 | Check dashboard sync status | "6 pending" |
| 9 | Enable WiFi | Network restored |
| 10 | Wait ≤ 5 seconds | Background sync starts |
| 11 | Monitor sync status | Count decreases: 6 → 5 → 4 → 3 → 2 → 1 → 0 (all synced) |
| 12 | Verify History screen | All 4 vital entries show "synced" status |
| 13 | Verify S3 | 4 observation JSON files + 1 photo + 1 audio in correct S3 paths |
| 14 | Verify SQS | Messages enqueued for photo and audio uploads |

---

### J-E2E-006: Reminder Lapse → Patient Notification → Grace Period → Relative Notification

**Personas:** Patient, Relative
**Preconditions:** BP reminder: 12hr window, 30min grace. Last BP log >12hrs ago.

| Step | Persona | Action | Expected Result |
|------|---------|--------|-----------------|
| 1 | System | 12-hour window lapses | Push notification to patient: "Time to log Blood Pressure" |
| 2 | Patient | See notification on device | Notification in system tray |
| 3 | Patient | Open app | Dashboard shows overdue prompt/banner for BP |
| 4 | System | 30-minute grace period passes (patient hasn't logged) | Push notification to relative: "BP reminder overdue for [Patient Name]" |
| 5 | Relative | See notification on device | Alert appears in system tray |
| 6 | Relative | Open app → Alert Inbox | Reminder lapse alert visible |
| 7 | Patient | Finally logs BP | Overdue prompt clears from dashboard |

---

### J-E2E-007: Multiple Attendants — Attribution Isolation

**Personas:** Attendant A, Attendant B, Relative
**Preconditions:** Two attendants invited and accepted

| Step | Persona | Action | Expected Result |
|------|---------|--------|-----------------|
| 1 | Attendant A | Login, log BP: 120/80 | Observation performer = Attendant A |
| 2 | Attendant A | Switch back to patient | Patient mode restored |
| 3 | Attendant B | Login, log BP: 115/75 | Observation performer = Attendant B |
| 4 | Relative | View Audit Log | Two distinct BP entries: one by Attendant A, one by Attendant B |
| 5 | Relative | View History | Each entry attributed to correct attendant |

---

## PART 5 — EDGE CASES AND NEGATIVE TEST JOURNEYS

---

### J-NEG-001: Registration Validation Errors

**Persona:** New user attempting registration
**Covers:** REQ-AUTH-004

| Step | Action | Expected UI State |
|------|--------|-------------------|
| 1 | Try registering with invalid email format | Validation error: "Invalid email" |
| 2 | Try registering with weak password (e.g., "123") | Validation error: password policy not met |
| 3 | Try registering with mismatched confirm password | Validation error: "Passwords don't match" |
| 4 | Try registering with already-used email | Error from Cognito: "Account already exists" |
| 5 | Enter wrong verification code | Error: "Invalid code" |

---

### J-NEG-002: Invalid Vital Values

**Persona:** Patient (authenticated)

| Step | Action | Expected UI State |
|------|--------|-------------------|
| 1 | Try saving BP with systolic=0 | Validation error or input rejected |
| 2 | Try saving BP with systolic=500 | Validation error: out of reasonable range |
| 3 | Try saving negative glucose value | Validation error |
| 4 | Try saving temperature=200 | Validation error |
| 5 | Try saving SpO2=150 (>100%) | Validation error |
| 6 | Try saving with empty/blank value | Save button disabled or validation error |

---

### J-NEG-003: Expired Session Handling

**Persona:** Patient (session expired)
**Covers:** REQ-AUTH-002, REQ-AUTH-012

| Step | Action | Expected UI State |
|------|--------|-------------------|
| 1 | Wait for JWT access token to expire (1hr) | Token expires |
| 2 | Attempt any API-dependent action | Refresh token used to get new access token silently |
| 3 | If refresh token also expired (30 days) | Redirected to login screen |
| 4 | Re-authenticate | Access restored |

---

### J-NEG-004: Network Error During Sync

**Persona:** Patient (authenticated)

| Step | Action | Expected UI State |
|------|--------|-------------------|
| 1 | Log vitals while WiFi appears connected | Sync attempts |
| 2 | Simulate network drop during sync | Sync fails gracefully |
| 3 | Verify no data loss | Observations remain in local store with "pending" status |
| 4 | Verify sync status shows error | Dashboard sync badge shows error state |
| 5 | Restore network | Sync retries and succeeds |

---

### J-NEG-005: Consent Rejection

**Persona:** New relative during registration
**Covers:** REQ-SEC-007

| Step | Action | Expected UI State |
|------|--------|-------------------|
| 1 | Reach consent screen | DPDP consent text displayed |
| 2 | Decline consent / do not accept | App blocks progression; cannot proceed to patient onboarding |
| 3 | Verify no data is collected | No patient creation possible without consent |

---

### J-NEG-006: Duplicate Login Attempt

**Persona:** Patient
| Step | Action | Expected UI State |
|------|--------|-------------------|
| 1 | Login with wrong password | Error: "Incorrect password" or "Authentication failed" |
| 2 | Login with non-existent email | Error: "User not found" or generic auth error |
| 3 | Multiple failed attempts | Account lockout or rate limiting (Cognito policy) |

---

## PART 6 — ACCESSIBILITY AND UX VERIFICATION JOURNEYS

---

### J-UX-001: Touch Target Size Verification

**Covers:** REQ-PAT-003, REQ-VIT-008

| Screen | Elements to Verify | Expected |
|--------|--------------------|----------|
| Patient Dashboard | All 6 vital buttons, Upload, Chat, History | Minimum 48x48dp; primary vitals 72dp+ |
| Vital Input Screens | Numeric keypad keys, Save button, Back button | Minimum 48x48dp; Save button 72dp+ |
| Bottom Tab Bar | All tab items | Minimum 48x48dp |
| Login Screen | Email field, Password field, Sign In button | Minimum 48x48dp; Sign In 72dp+ |

---

### J-UX-002: Contrast Ratio Verification

**Covers:** REQ-PAT-004

| Screen | Element | Expected Minimum |
|--------|---------|------------------|
| All patient screens | Primary text on background | 7:1 (AAA target) |
| All patient screens | Secondary text on background | 4.5:1 (AA minimum) |
| Vital buttons | Button text/icon on button background | 4.5:1 |
| Alert indicators | Red/yellow/green on card background | 4.5:1 |

---

### J-UX-003: Single-Action-Per-Screen Verification

**Covers:** REQ-PAT-005

| Screen | Verification |
|--------|-------------|
| Blood Pressure input | Only BP input visible, no other vital inputs or unrelated actions |
| Glucose input | Only glucose input visible |
| Temperature input | Only temperature input visible |
| Weight input | Only weight input visible |
| Pulse input | Only pulse input visible |
| SpO2 input | Only SpO2 input visible |

---

### J-UX-004: Navigation — Dashboard Always One Tap Away

**Covers:** REQ-PAT-006

| Starting Screen | Action to Return | Expected |
|-----------------|-----------------|----------|
| Blood Pressure input | Tap back or home tab | Dashboard appears |
| History screen | Tap home tab | Dashboard appears |
| Settings screen | Tap home tab | Dashboard appears |
| Upload menu | Tap home tab | Dashboard appears |
| Camera capture | Tap back → Upload → back or home tab | Dashboard within 2 taps max |

---

## PART 7 — COMPLIANCE VERIFICATION JOURNEYS

---

### J-COMP-001: DPDP Consent Flow Verification

**Covers:** REQ-SEC-007, REQ-SEC-008

| Step | Verification |
|------|-------------|
| 1 | Consent screen shows versioned consent text (version number visible) |
| 2 | User must scroll to bottom before accept button is enabled (if implemented) |
| 3 | Accept action records: timestamp, consent text version, user identity |
| 4 | Consent record exists in RDS after acceptance |
| 5 | No patient data operations possible before consent is given |

---

### J-COMP-002: Audit Trail Completeness

**Covers:** REQ-SEC-004, REQ-ATT-011

| Action | Expected Audit Entry |
|--------|---------------------|
| Patient logs BP | Audit: patient sub, action=create_observation, vital=BP, timestamp |
| Attendant logs glucose | Audit: attendant sub, action=create_observation, vital=glucose, timestamp |
| Relative views history | Audit: relative sub, action=view_history, timestamp |
| Relative modifies threshold | Audit: relative sub, action=update_threshold, vital=BP, timestamp |
| Relative invites doctor | Audit: relative sub, action=invite_doctor, email, timestamp |

---

### J-COMP-003: PHI Not in Logs

**Covers:** REQ-SEC-006

| Step | Verification |
|------|-------------|
| 1 | After logging vitals and performing various actions, capture Android logcat output |
| 2 | Search logcat for patient name, email, vital values, health data | Should NOT appear |
| 3 | Trigger a crash (if safe to do) and check crash report | No PHI in crash payload |
| 4 | Check analytics events (if any) | No PHI in event properties |

---

### J-COMP-004: Certificate Pinning Verification

**Covers:** REQ-SEC-005

| Step | Verification |
|------|-------------|
| 1 | Configure proxy (e.g., Charles Proxy) to intercept HTTPS traffic |
| 2 | Attempt API calls from the app through the proxy | Calls should FAIL due to certificate pinning |
| 3 | Without proxy, API calls succeed normally | |

---

## APPENDIX A — Persona-Journey Matrix

| Journey ID | Relative | Patient | Attendant | Doctor (web) |
|------------|----------|---------|-----------|--------------|
| J-REL-001 through J-REL-012 | Primary | — | — | — |
| J-PAT-001 through J-PAT-020 | — | Primary | — | — |
| J-ATT-001 through J-ATT-011 | — | — | Primary | — |
| J-E2E-001 | Setup | Action | — | — |
| J-E2E-002 | Receives alert | Action | — | — |
| J-E2E-003 | Reviews | — | Action | — |
| J-E2E-004 | Initiates | — | — | Accepts |
| J-E2E-005 | — | Action | — | — |
| J-E2E-006 | Receives alert | Receives reminder | — | — |
| J-E2E-007 | Reviews | — | Action (x2) | — |

---

## APPENDIX B — Backend Endpoints Referenced

| Endpoint | Method | Used In Journeys |
|----------|--------|-----------------|
| Cognito SignUp | POST | J-REL-001 |
| Cognito ConfirmSignUp | POST | J-REL-001 |
| Cognito SignIn | POST | J-PAT-001, J-ATT-001 |
| `create-patient` Lambda | POST | J-REL-002 |
| `invite-attendant` Lambda | POST | J-REL-004 |
| `invite-doctor` Lambda | POST | J-REL-005 |
| `accept-invite` Lambda | POST | J-E2E-004 |
| `remove-team-member` Lambda | DELETE | J-REL-011 |
| `delete-patient` Lambda | DELETE | J-REL-012 |
| `sync-observations` Lambda | POST | J-PAT-003–008, J-PAT-016, J-ATT-003 |
| `get-presigned-url` Lambda | POST | J-PAT-010–014, J-ATT-004 |
| `GET /patients/{id}/summary` | GET | J-REL-003 |
| `GET /patients/{id}/observations` | GET | J-REL-008 |
| `PUT /patients/{id}/thresholds` | PUT | J-REL-006, J-ATT-008 |
| `PUT /patients/{id}/reminders` | PUT | J-REL-007, J-ATT-008 |
| `GET /patients/{id}/alerts` | GET | J-REL-009 |
| `PATCH /alerts/{id}` | PATCH | J-REL-009 |
| `GET /patients/{id}/care-team` | GET | J-REL-004, J-REL-005, J-PAT-020 |
| `DELETE /patients/{id}/team/{mid}` | DELETE | J-REL-011 |

---

## APPENDIX C — FHIR Resources Created

| Resource Type | LOINC Code | Created In Journeys |
|---------------|------------|---------------------|
| Observation (Blood Pressure - Systolic) | 8480-6 | J-PAT-003, J-ATT-003, J-E2E-* |
| Observation (Blood Pressure - Diastolic) | 8462-4 | J-PAT-003, J-ATT-003, J-E2E-* |
| Observation (Glucose) | 2339-0 | J-PAT-004, J-ATT-003 |
| Observation (Temperature) | 8310-5 | J-PAT-005 |
| Observation (Weight) | 29463-7 | J-PAT-006 |
| Observation (Pulse) | 8867-4 | J-PAT-007 |
| Observation (SpO2) | 2708-6 | J-PAT-008 |
| DocumentReference (Prescription) | — | J-PAT-010 |
| DocumentReference (Medical Photo) | — | J-PAT-011, J-ATT-004 |
| DocumentReference (Voice Note) | — | J-PAT-012, J-ATT-006 |
| DocumentReference (Video Note) | — | J-PAT-013 |
| DocumentReference (Lab Result) | — | J-PAT-014 |

---

*CareLog User Journeys v1.0 — March 2026 — For automated UI testing via Android emulator*

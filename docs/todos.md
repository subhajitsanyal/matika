# CareLog — Implementation TODOs

**Last Updated:** April 2026

---

## Critical — Must Fix Before Production

### Backend: Missing Database Tables
Six scaffolded Lambdas reference tables that don't exist in migrations. Need a V003 migration.

| Missing Table | Referenced By Lambda | Purpose |
|---------------|---------------------|---------|
| `care_plans` | `care-plan` | FHIR CarePlan storage |
| `documents` | `doctor-documents` | Document metadata (S3 references) |
| `data_export_requests` | `data-export` | DPDP Act data portability requests |
| `deletion_requests` | `account-deletion` | DPDP Act account deletion requests |
| `observation_notes` | `observation-annotation` | Doctor annotations on observations |

### Backend: Security — Incomplete Access Control
- **`presigned-url` Lambda (line 156):** TODO comment — only checks Cognito groups superficially, does not validate actual `persona_links` table for patient access. Must implement proper RDS-based access check before production.

### Backend: API Gateway Routes Without Lambda Integration
These routes return mock responses or have no integration:

| Route | Current State | Lambda Exists | Action Needed |
|-------|--------------|---------------|---------------|
| `DELETE /patients/{patientId}` | MOCK (hardcoded 200) | `delete-patient` (scaffolded) | Wire Lambda |
| `DELETE /patients/{patientId}/team/{memberId}` | MOCK (hardcoded 200) | `remove-team-member` (scaffolded) | Wire Lambda |
| `GET /patients/{patientId}` | No method defined | None | Create or skip |
| `GET /observations/{observationId}` | No method defined | `observation-annotation` (scaffolded) | Wire Lambda |

### Backend: API Gateway Resources With No Methods
These resources are defined in Terraform but have no HTTP methods or integrations:

- `/thresholds`, `/thresholds/{patientId}` — Lambda: `threshold-crud` (scaffolded)
- `/reminders`, `/reminders/{patientId}` — Lambda: `reminder-crud` (scaffolded)
- `/care-plans`, `/care-plans/{patientId}` — Lambda: `care-plan` (scaffolded)
- `/alerts` — Lambda: `alert-crud` (scaffolded)
- `/device-tokens` — Lambda: `device-token` (scaffolded)
- `/audit-log` — Lambda: `audit-log` (scaffolded)

### Infrastructure: Terraform State Backend
- `infrastructure/terraform/main.tf` lines 21-27: S3 backend is commented out. State is local-only, which is risky for production. Enable remote state before multi-person development.

---

## High Priority — Core Feature Gaps

### Android: Consent Flow is Stubbed
**File:** `android/.../ui/consent/ConsentRepositoryImpl.kt`

| Method | Line | Issue |
|--------|------|-------|
| `getConsentText()` | 29-67 | Returns hardcoded placeholder consent text |
| `getConsentStatus()` | 69-78 | Returns placeholder with `hasConsent=false` |
| `recordConsent()` | 80-98 | Builds request body but never sends it |
| `withdrawConsent()` | 100-117 | Builds request body but never sends it |

Backend Lambda `consent` is scaffolded but not deployed.

### Android: Audit Log Uses Mock Data
**File:** `android/.../ui/relative/AuditLogScreen.kt`

| Method | Line | Issue |
|--------|------|-------|
| `loadLogs()` | 571-619 | Uses hardcoded mock data, not API |
| `loadMore()` | 621-623 | Empty stub for pagination |

Backend Lambda `audit-log` is scaffolded but not deployed.

### Android: Care Team `sendInvite()` is Stubbed
**File:** `android/.../ui/relative/CareTeamScreen.kt` line 633-646
- Shows success and refreshes but never calls the invite API
- Should call `invite-attendant` or `invite-doctor` endpoint

### Android: Threshold & Reminder Config Not Wired to Backend
- `threshold-crud` and `reminder-crud` Lambdas are scaffolded but not deployed
- Android UI exists (`ThresholdConfigScreen`, `ReminderConfigScreen`) but API calls will fail (no backend route)

### Android: Alert System Not Wired
- `alert-crud` Lambda is scaffolded but not deployed
- Android `AlertInboxScreen` exists but `getAlerts()` will fail silently (returns empty list)
- Push notifications via SNS/FCM not integrated

### Backend: 19 Scaffolded Lambdas Not Deployed
Code exists in `backend/lambdas/` but not in Terraform or API Gateway:

| Lambda | Lines | Purpose |
|--------|-------|---------|
| `alert-crud` | 286 | Alert CRUD for threshold breaches and reminder lapses |
| `audit-log` | 292 | HIPAA-compliant audit log viewer |
| `care-plan` | 273 | FHIR CarePlan CRUD for doctors |
| `care-team` | 194 | Care team listing (manually deployed, not in Terraform) |
| `consent` | 353 | DPDP Act consent recording and withdrawal |
| `create-document-reference` | 229 | FHIR DocumentReference for S3 uploads |
| `data-export` | 393 | DPDP Act data export |
| `delete-patient` | 277 | Cascade patient deletion |
| `device-token` | 238 | FCM/APNs device token registration |
| `doctor-documents` | 218 | Doctor document viewer |
| `doctor-patients` | 170 | Doctor patient list for web portal |
| `notification-sender` | 413 | Push notification dispatch |
| `observation-annotation` | 217 | Doctor annotations on observations |
| `patient-summary` | 280 | Patient summary (manually deployed, not in Terraform) |
| `process-pending-invites` | 213 | SES verification polling (manually deployed, not in Terraform) |
| `reminder-crud` | 260 | Reminder configuration CRUD |
| `remove-team-member` | 290 | Remove attendant/doctor from care team |
| `threshold-crud` | 285 | Threshold configuration CRUD |
| `account-deletion` | 442 | DPDP Act account deletion |

### Backend: Unused Terraform Modules
These modules are defined but not integrated in `main.tf`:
- `sns/` — Push notification topics (needed for alerts)
- `cloudfront/` — CDN for web portal
- `cloudtrail/` — HIPAA audit trail (critical for compliance)

---

## Medium Priority — Quality & Completeness

### Android: Silent API Failures
These `RelativeApiService` methods catch exceptions and return empty/null instead of propagating errors:

| Method | Returns on Failure | Impact |
|--------|-------------------|--------|
| `getObservations()` | `emptyList()` | Can't distinguish empty data from network error |
| `getThresholds()` | `emptyList()` | Same |
| `getReminderConfig()` | `emptyList()` | Same |
| `getAlerts()` | `emptyList()` | Same |
| `getCareTeam()` | `null` | Same |

### Android: Sync Status Hack
**File:** `android/.../ui/sync/SyncStatusViewModel.kt` line 121-130
- `triggerManualSync()` uses a 2-second delay hack instead of tracking actual sync completion

### Android: Forgot Password Not Implemented
**File:** `android/.../ui/CareLogNavHost.kt` line 161
- `onNavigateToForgotPassword` is `{ /* TODO */ }`

### Android: Patient Dashboard Alerts Button
**File:** `android/.../ui/dashboard/DashboardScreen.kt` line 98
- Alerts button onClick is `/* TODO: Navigate to alerts */`

### Backend: `threshold-crud` Missing Doctor Name
**File:** `backend/lambdas/threshold-crud/index.js` line 113
- Returns `null` for `doctorName` instead of joining with `users` table

### Backend: Patient Cognito Accounts Use Placeholder Emails
**File:** `backend/lambdas/create-patient/index.js` line 105
- Creates `patient.{id}@carelog.internal` — patients can't log in with real emails

---

## Low Priority — Nice to Have

### Android: LLM Chat Placeholder
**File:** `android/.../ui/chat/ChatPlaceholderScreen.kt`
- Shows "Coming Soon" screen — deferred to v2 per PRD

### Android: Doctor Portal Placeholder
**File:** `android/.../ui/settings/SettingsScreen.kt` line 130
- Shows "coming soon" card for doctor portal feature

### Android: Certificate Pinning Disabled
**File:** `android/.../network/CertificatePinning.kt` lines 41-48
- SSL certificate pinning commented out for development
- Must re-enable before production release

### Android: FHIR Client Hardcoded Placeholder
**File:** `android/.../di/FhirModule.kt` lines 24-28
- `healthLakeDatastoreId` is `"placeholder-datastore-id"` — HealthLake integration deferred

### Web Portal: Missing Pages
The doctor web portal (`web-portal/`) is missing:
- Alerts dashboard
- Audit log viewer
- Team management UI
- Device token management
- Data export UI
- Analytics/overview dashboard

### Web Portal: Unauthorized Page
**File:** `web-portal/src/App.tsx` lines 40-50
- `/unauthorized` route is an inline stub, not a full page component

---

## Critical — Hardcoded Credentials & Secrets

### Android: Hardcoded API Gateway URL
**File:** `android/.../core/BuildConfig.kt` line 13
- `API_BASE_URL = "https://x6v72ekrcl.execute-api.ap-south-1.amazonaws.com/dev"` is hardcoded
- Should be injected via Gradle build config or `update-app-config.sh`
- This URL changes on every fresh `terraform apply`

### Android/iOS: Hardcoded Cognito Pool ID and Client ID
- `android/app/src/main/res/raw/amplifyconfiguration.json` lines 14-15: Pool ID `ap-south-1_uiEZhWVXB`, Client ID `1kjdqj21bljak87e602d8r84f2`
- `ios/CareLog/CareLog/amplifyconfiguration.json` lines 14-15: Same values
- Should be populated by `update-app-config.sh` from Terraform outputs, never committed with real values

### Android/iOS: Hardcoded S3 Bucket Name
- `ios/CareLog/CareLog/amplifyconfiguration.json` line 65: `carelog-v2-dev-documents-316643066568`
- Should come from Terraform outputs

### Test Automation: Hardcoded Test Password
- `test-automation/scripts/seed-accounts.sh` line 9: `TEST_PASSWORD="Carelog2026@x"`
- `test-automation/test-data/credentials.json` line 3: same password in plaintext
- `docs/setup-and-deployment-guide.md` line 950: same password in docs
- Should use environment variable or secrets manager; credentials.json should be gitignored

### Terraform: Hardcoded SES Email Identity
- `infrastructure/terraform/environments/dev/main.tf` lines 40-41: `subhajit@kyabla.in` and AWS account ID `316643066568`
- Should use variables, not personal email addresses

### Backend: Inconsistent DB Connection Patterns
12 scaffolded Lambdas use `DB_PASSWORD` as a plaintext env var instead of Secrets Manager:

| Lambda | Issue |
|--------|-------|
| `alert-crud` | `password: process.env.DB_PASSWORD` (line 16) |
| `audit-log` | Same (line 16) |
| `care-plan` | Same (line 16) |
| `consent` | Same (line 17) |
| `data-export` | Same (line 18) |
| `device-token` | Same (line 19) |
| `doctor-documents` | Same (line 16) |
| `doctor-patients` | Same (line 14) |
| `notification-sender` | Same (line 19) |
| `observation-annotation` | Same (line 15) |
| `reminder-crud` | Same (line 16) |
| `threshold-crud` | Same (line 16) |
| `account-deletion` | Same (line 22) |

The deployed Lambdas (`create-patient`, `post-confirmation`, `invite-attendant`, `accept-invite`, `patient-summary`, `care-team`, `process-pending-invites`) correctly use Secrets Manager via `DB_SECRET_NAME`. The scaffolded Lambdas must be migrated to the same pattern before deployment.

### Test Script: Hardcoded Cognito Client ID
- `test-automation/scripts/seed-accounts.sh` line 7: `CLIENT_ID="1kjdqj21bljak87e602d8r84f2"`
- Should query from AWS or use environment variable

---

## Summary

| Priority | Count | Category |
|----------|-------|----------|
| Critical | 13 | Missing DB tables, security gaps, mock API routes, Terraform state, hardcoded credentials |
| High | 8 | Stubbed features, 19 undeployed Lambdas, unused Terraform modules |
| Medium | 6 | Silent failures, TODO stubs, missing joins |
| Low | 6 | Placeholders (per PRD), disabled security, missing web portal pages |
| **Total** | **33** | |

---

*Generated April 2026*

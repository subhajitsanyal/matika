# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**CareLog** is a healthcare monitoring platform for elderly patients, caregivers, and physicians. It consists of three client apps (Android, iOS, web portal), a serverless backend (AWS Lambda), and Terraform infrastructure — all in a single repository.

## Build & Run Commands

### Web Portal (React/TypeScript/Vite)
```bash
cd web-portal
npm install
npm run dev             # Dev server
npm run build           # Type-check + production build (tsc && vite build)
npm run lint            # ESLint
npm run test            # Vitest
npm run test:coverage   # Vitest with coverage
```

### Android (Kotlin/Jetpack Compose)
```bash
cd android
./gradlew assembleDebug           # Debug APK
./gradlew assembleRelease         # Release APK (proguard)
./gradlew test                    # Unit tests
./gradlew connectedAndroidTest    # Instrumentation tests (requires emulator)
```

### iOS (Swift/SwiftUI)
```bash
cd ios/CareLog
xcodebuild -scheme CareLog -destination 'platform=iOS Simulator,name=iPhone 15 Pro' build
xcodebuild test -scheme CareLog -destination 'platform=iOS Simulator,name=iPhone 15 Pro'
```

### Backend Lambdas (Node.js 20)
Each Lambda in `backend/lambdas/` has its own `package.json`. Install dependencies individually:
```bash
cd backend/lambdas/<function-name>
npm install
```
Lambdas are deployed via Terraform, not directly.

### Database Migrations (Flyway + PostgreSQL 15)
Requires SSM port-forwarding to RDS via bastion host:
```bash
cd backend/database
flyway migrate
```

### Infrastructure (Terraform)
```bash
cd infrastructure/terraform/environments/dev
terraform init && terraform plan && terraform apply
```

## Architecture

```
Clients (Android, iOS, Web) → API Gateway → Lambda Functions → RDS PostgreSQL / S3
                                                              ↕
                                                         SQS (async)
```

- **Auth:** AWS Cognito with 4 user groups: `patients`, `attendants`, `relatives`, `doctors`. Custom attributes: `custom:persona_type`, `custom:linked_patient_id`. Post-confirmation Lambda trigger creates user records.
- **Clinical Data:** FHIR R4 Observations stored as JSON in S3 at `observations/{patientId}/{YYYY}/{MM}/{DD}/{id}.json` (KMS encrypted). HealthLake integration deferred.
- **Offline-First:** Mobile apps use local storage (Room DB on Android, Core Data on iOS) with background sync via WorkManager / Spezi Scheduler.
- **Deployment:** Single `terraform apply` deploys all infrastructure + 8 Lambda functions. Run `npm install` in each Lambda directory first.

### Key Directories

| Directory | What it contains |
|-----------|-----------------|
| `web-portal/src/pages/` | Doctor portal pages (login, patient list, patient view, registration) |
| `web-portal/src/services/` | REST API client (patients, observations, documents, care-plans) |
| `web-portal/src/contexts/` | React Context for Cognito auth state |
| `android/app/src/main/java/com/carelog/` | Android app: `auth/`, `fhir/`, `api/` modules |
| `ios/CareLog/CareLog/` | iOS app organized by feature: Auth, Dashboard, Vitals, History, Chat, FHIR |
| `backend/lambdas/` | 24 Lambda functions (sync-observation, invite-attendant, create-patient, alert-crud, threshold-crud, care-plan, etc.) |
| `backend/database/migrations/` | Flyway SQL migrations (V001, V002, ...) |
| `infrastructure/terraform/modules/` | Terraform modules: cognito, api_gateway, bastion, rds, healthlake, s3, lambda, kms |
| `docs/` | PRD, implementation plan, FHIR mappings, setup guide, privacy policy |

### Platform-Specific Patterns

| Concern | Web Portal | Android | iOS |
|---------|-----------|---------|-----|
| State | React Context | Hilt DI + ViewModel + StateFlow | Spezi + @State/@StateObject |
| API | Fetch + Amplify auth headers | Retrofit2 + OkHttp interceptors | URLSession + Amplify async/await |
| Local Storage | IndexedDB (Amplify) | Room DB + DataStore | Spezi local storage + UserDefaults |
| FHIR | — | HAPI FHIR | FHIRModels (SPM) |

## AWS Region & Compliance

- **Primary region:** ap-south-1 (India, DPDP Act data residency)
- **Security:** KMS encryption at rest, TLS in transit, audit logging, bastion host with SSM (no exposed DB), Secrets Manager for DB credentials
- **RDS access:** Always through SSM Session Manager port-forwarding via bastion — never directly exposed

## Path Aliases

Web portal uses `@/*` → `src/*` (configured in tsconfig.json and vite.config.ts).

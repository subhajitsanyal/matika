# CareLog — Implementation Plan

**Version:** 1.0
**Date:** March 2026
**Based on:** CareLog PRD v0.1

---

## Overview

This document breaks down the CareLog PRD into actionable tasks organized by milestone. Each task is numbered, includes dependencies, and provides sufficient context for implementation.

**Legend:**
- `[T-XXX]` — Task ID
- `Depends on:` — List of task IDs that must be completed first
- `[ ]` — Checklist item (incomplete)

---

## Phase 0: Foundation (Weeks 1–3)

### 0.1 Project Setup & Infrastructure

- [x] **[T-001]** Initialize Android project with SpeziKt framework
  - **Depends on:** None
  - **Context:** Create new Android project using Android Studio. Add SpeziKt dependencies from `https://github.com/StanfordSpezi/SpeziKt`. Configure Gradle with minimum SDK 28 (Android 9). Set up modular package structure: `core`, `auth`, `fhir`, `sync`, `ui`.

  - [x] **[T-001.1]** Create project with modular Gradle structure
  - [x] **[T-001.2]** Add SpeziKt core dependencies
  - [x] **[T-001.3]** Configure minimum SDK and target SDK versions
  - [x] **[T-001.4]** Set up base Application class

- [x] **[T-002]** Initialize iOS project with Spezi SDK
  - **Depends on:** None
  - **Context:** Create new iOS project using Xcode. Add Spezi SDK via Swift Package Manager from `https://github.com/StanfordSpezi/`. Configure minimum iOS 15 deployment target. Set up modular target structure.

  - [x] **[T-002.1]** Create Xcode project with Swift Package Manager
  - [x] **[T-002.2]** Add Spezi core packages
  - [x] **[T-002.3]** Configure iOS 15+ deployment target
  - [x] **[T-002.4]** Set up base App struct with SwiftUI lifecycle

- [x] **[T-003]** Set up AWS infrastructure foundation
  - **Depends on:** None
  - **Context:** Use Terraform or AWS CDK to create infrastructure as code. Create separate environments: `dev`, `staging`, `prod`. Set up VPC with private subnets for backend services.

  - [x] **[T-003.1]** Create IaC project (Terraform/CDK)
  - [x] **[T-003.2]** Define VPC with public and private subnets
  - [x] **[T-003.3]** Set up NAT Gateway for private subnet internet access
  - [x] **[T-003.4]** Configure security groups for each service
  - [x] **[T-003.5]** Set up environment-specific configurations

- [x] **[T-004]** Configure AWS Cognito user pool
  - **Depends on:** T-003
  - **Context:** Create single Cognito user pool with four groups: `patients`, `attendants`, `relatives`, `doctors`. Configure password policy (min 8 chars, require uppercase, lowercase, number). Enable MFA as optional. Set token expiration: access token 1 hour, refresh token 30 days.

  - [x] **[T-004.1]** Create Cognito user pool
  - [x] **[T-004.2]** Configure password and security policies
  - [x] **[T-004.3]** Create user groups (patient, attendant, relative, doctor)
  - [x] **[T-004.4]** Configure app client with appropriate OAuth scopes
  - [x] **[T-004.5]** Set up custom attributes for persona linking

- [x] **[T-005]** Set up Amazon API Gateway
  - **Depends on:** T-004
  - **Context:** Create REST API Gateway with Cognito authorizer. Define resource structure: `/patients`, `/observations`, `/documents`, `/thresholds`, `/care-plans`. Enable CORS for web portal. Configure throttling and rate limiting.

  - [x] **[T-005.1]** Create REST API in API Gateway
  - [x] **[T-005.2]** Configure Cognito authorizer
  - [x] **[T-005.3]** Define base resource structure
  - [x] **[T-005.4]** Enable CORS with appropriate origins
  - [x] **[T-005.5]** Set up request/response models

- [x] **[T-006]** Provision AWS HealthLake instance
  - **Depends on:** T-003
  - **Context:** Request HealthLake data store (provisioning takes 1-3 days). Use FHIR R4 version. Enable encryption at rest. Note: Use HAPI FHIR server locally as fallback during provisioning.

  - [x] **[T-006.1]** Request HealthLake data store provisioning
  - [x] **[T-006.2]** Configure encryption settings (KMS)
  - [x] **[T-006.3]** Set up HAPI FHIR server for local development fallback
  - [x] **[T-006.4]** Validate FHIR endpoint connectivity

- [x] **[T-007]** Set up Amazon S3 for unstructured data
  - **Depends on:** T-003
  - **Context:** Create S3 bucket with SSE-KMS encryption. Configure bucket policy for presigned URL uploads. Set up lifecycle rules for cost optimization. Key format: `{patient_id}/{year}/{month}/{day}/{timestamp}_{type}_{filename}`.

  - [x] **[T-007.1]** Create S3 bucket with versioning enabled
  - [x] **[T-007.2]** Configure SSE-KMS encryption
  - [x] **[T-007.3]** Set up bucket policy for presigned URL access
  - [x] **[T-007.4]** Configure CORS for direct browser uploads
  - [x] **[T-007.5]** Set up lifecycle rules

- [x] **[T-008]** Set up Amazon SQS for async processing
  - **Depends on:** T-003
  - **Context:** Create SQS queue for S3 upload notifications. Configure dead-letter queue for failed messages. Message format: `{patient_id, s3_key, file_type, uploader_persona, timestamp}`.

  - [x] **[T-008.1]** Create main SQS queue
  - [x] **[T-008.2]** Create dead-letter queue
  - [x] **[T-008.3]** Configure redrive policy
  - [x] **[T-008.4]** Set up S3 event notification to SQS

- [x] **[T-009]** Set up Amazon RDS (PostgreSQL)
  - **Depends on:** T-003
  - **Context:** Create PostgreSQL RDS instance in private subnet. Use db.t3.medium for development. Enable automated backups. Configure parameter group for UTF-8.

  - [x] **[T-009.1]** Create RDS PostgreSQL instance
  - [x] **[T-009.2]** Configure security group for private access
  - [x] **[T-009.3]** Set up automated backups
  - [x] **[T-009.4]** Create initial database and admin user

- [x] **[T-010]** Design and implement RDS database schema
  - **Depends on:** T-009
  - **Context:** Create tables: `users`, `persona_links` (patient-caregiver relationships), `thresholds`, `reminder_configs`, `consent_records`, `audit_log`. Use UUIDs as primary keys. Add foreign key constraints.

  - [x] **[T-010.1]** Design ER diagram
  - [x] **[T-010.2]** Create `users` table with Cognito sub reference
  - [x] **[T-010.3]** Create `persona_links` table for relationships
  - [x] **[T-010.4]** Create `thresholds` table with doctor override support
  - [x] **[T-010.5]** Create `reminder_configs` table
  - [x] **[T-010.6]** Create `consent_records` table
  - [x] **[T-010.7]** Create `audit_log` table
  - [x] **[T-010.8]** Set up database migrations (Flyway/Liquibase)

---

### 0.2 Authentication Implementation

- [x] **[T-011]** Implement Cognito authentication on Android
  - **Depends on:** T-001, T-004
  - **Context:** Use AWS Amplify Auth or Cognito SDK for Android. Implement secure token storage using Android Keystore. Handle token refresh automatically.

  - [x] **[T-011.1]** Add AWS Amplify/Cognito SDK dependencies
  - [x] **[T-011.2]** Configure Amplify with Cognito pool details
  - [x] **[T-011.3]** Implement secure token storage
  - [x] **[T-011.4]** Create AuthRepository with login/logout/refresh methods
  - [x] **[T-011.5]** Implement auth state observation (LiveData/Flow)

- [x] **[T-012]** Implement Cognito authentication on iOS
  - **Depends on:** T-002, T-004
  - **Context:** Use AWS Amplify Auth for iOS. Store tokens in iOS Keychain. Handle background token refresh.

  - [x] **[T-012.1]** Add AWS Amplify Auth package
  - [x] **[T-012.2]** Configure Amplify with Cognito pool details
  - [x] **[T-012.3]** Implement Keychain token storage
  - [x] **[T-012.4]** Create AuthService with async/await methods
  - [x] **[T-012.5]** Implement auth state publisher

- [x] **[T-013]** Implement relative self-registration flow
  - **Depends on:** T-011, T-012
  - **Context:** Relative creates their own account first. Collect: email, phone, password. Add to `relatives` Cognito group. Create corresponding record in RDS `users` table.

  - [x] **[T-013.1]** Create registration UI (Android)
  - [x] **[T-013.2]** Create registration UI (iOS)
  - [x] **[T-013.3]** Implement Cognito sign-up with email verification
  - [x] **[T-013.4]** Create backend Lambda to add user to group
  - [x] **[T-013.5]** Create RDS user record on successful registration

- [x] **[T-014]** Implement patient account creation by relative
  - **Depends on:** T-013
  - **Context:** Relative enters patient details: name, age, gender, medical conditions. System generates unique Patient ID. Creates Cognito user (optionally with simplified credentials for elderly). Links patient to relative in `persona_links` table.

  - [x] **[T-014.1]** Create patient onboarding UI (Android)
  - [x] **[T-014.2]** Create patient onboarding UI (iOS)
  - [x] **[T-014.3]** Implement backend endpoint for patient creation
  - [x] **[T-014.4]** Generate unique Patient ID
  - [x] **[T-014.5]** Create FHIR Patient resource in HealthLake
  - [x] **[T-014.6]** Create persona_link record (relative → patient)

- [x] **[T-015]** Implement attendant invite flow
  - **Depends on:** T-014
  - **Context:** Relative enters attendant name and contact (email/phone). System sends invite with temporary link. Attendant registers via link and is added to `attendants` group. Link created in `persona_links`.

  - [x] **[T-015.1]** Create attendant invite UI
  - [x] **[T-015.2]** Implement invite email/SMS sending (SES/SNS)
  - [x] **[T-015.3]** Create invite acceptance landing page
  - [x] **[T-015.4]** Implement attendant registration flow
  - [x] **[T-015.5]** Create persona_link record (attendant → patient)

- [x] **[T-016]** Implement doctor invite flow
  - **Depends on:** T-014
  - **Context:** Relative invites doctor via email. Doctor receives link to web portal registration. Doctor registers and is added to `doctors` group. Link created in `persona_links`.

  - [x] **[T-016.1]** Create doctor invite UI in relative app
  - [x] **[T-016.2]** Implement doctor invite email template
  - [x] **[T-016.3]** Create doctor registration web page
  - [x] **[T-016.4]** Implement doctor Cognito registration
  - [x] **[T-016.5]** Create persona_link record (doctor → patient)

---

### 0.3 FHIR Foundation

- [x] **[T-017]** Define FHIR resource mappings
  - **Depends on:** T-006
  - **Context:** Document mapping between app data and FHIR R4 resources. Cover: Patient, Observation (all 6 vitals), DocumentReference, CarePlan. Include LOINC codes for each vital.

  - [x] **[T-017.1]** Document Patient resource mapping
  - [x] **[T-017.2]** Document Observation mappings with LOINC codes:
    - Body Weight: 29463-7
    - Glucometer: 2339-0
    - Temperature: 8310-5
    - BP Systolic: 8480-6
    - BP Diastolic: 8462-4
    - Pulse/HR: 8867-4
    - SpO2: 2708-6
  - [x] **[T-017.3]** Document DocumentReference mapping for S3 files
  - [x] **[T-017.4]** Document CarePlan resource mapping
  - [x] **[T-017.5]** Create JSON schema examples for each resource

- [x] **[T-018]** Implement FHIR client wrapper on Android
  - **Depends on:** T-001, T-017
  - **Context:** Use SpeziKt FHIR module. Create wrapper class for CRUD operations on Patient, Observation, DocumentReference. Handle serialization/deserialization.

  - [x] **[T-018.1]** Create FhirClient interface
  - [x] **[T-018.2]** Implement Patient resource operations
  - [x] **[T-018.3]** Implement Observation resource operations
  - [x] **[T-018.4]** Implement DocumentReference resource operations
  - [x] **[T-018.5]** Add unit tests for FHIR serialization

- [x] **[T-019]** Implement FHIR client wrapper on iOS
  - **Depends on:** T-002, T-017
  - **Context:** Use Spezi FHIR module. Create FHIRClient protocol and implementation. Use Combine/async-await for async operations.

  - [x] **[T-019.1]** Create FHIRClient protocol
  - [x] **[T-019.2]** Implement Patient resource operations
  - [x] **[T-019.3]** Implement Observation resource operations
  - [x] **[T-019.4]** Implement DocumentReference resource operations
  - [x] **[T-019.5]** Add unit tests for FHIR serialization

- [x] **[T-020]** Set up local FHIR store on Android
  - **Depends on:** T-018
  - **Context:** Use SpeziKt local storage module for offline-first persistence. Configure SQLite-backed FHIR store. Implement sync status tracking per resource.

  - [x] **[T-020.1]** Configure SpeziKt local FHIR store
  - [x] **[T-020.2]** Implement LocalFhirRepository
  - [x] **[T-020.3]** Add sync status enum (PENDING, SYNCED, FAILED)
  - [x] **[T-020.4]** Create Room entities for sync queue tracking
  - [x] **[T-020.5]** Implement CRUD operations with sync status

- [x] **[T-021]** Set up local FHIR store on iOS
  - **Depends on:** T-019
  - **Context:** Use Spezi local storage module. Configure Core Data or SwiftData backed FHIR store. Implement sync status tracking.

  - [x] **[T-021.1]** Configure Spezi local FHIR store
  - [x] **[T-021.2]** Implement LocalFHIRRepository
  - [x] **[T-021.3]** Add sync status model
  - [x] **[T-021.4]** Create Core Data entities for sync tracking
  - [x] **[T-021.5]** Implement async CRUD operations

---

### 0.4 CI/CD Setup

- [x] **[T-022]** Set up CI/CD for Android
  - **Depends on:** T-001
  - **Context:** Use GitHub Actions or Bitrise. Configure: build, lint, unit tests, instrumentation tests, APK signing. Set up development and release tracks.

  - [x] **[T-022.1]** Create GitHub Actions workflow file
  - [x] **[T-022.2]** Configure Gradle build caching
  - [x] **[T-022.3]** Add lint and static analysis steps
  - [x] **[T-022.4]** Configure unit test execution
  - [x] **[T-022.5]** Set up APK signing with GitHub secrets
  - [x] **[T-022.6]** Configure deployment to internal testing track

- [x] **[T-023]** Set up CI/CD for iOS
  - **Depends on:** T-002
  - **Context:** Use GitHub Actions with Xcode Cloud or Bitrise. Configure: build, SwiftLint, unit tests, UI tests, code signing. Set up TestFlight deployment.

  - [x] **[T-023.1]** Create GitHub Actions workflow file
  - [x] **[T-023.2]** Configure Xcode build caching
  - [x] **[T-023.3]** Add SwiftLint step
  - [x] **[T-023.4]** Configure XCTest execution
  - [x] **[T-023.5]** Set up code signing with match/fastlane
  - [x] **[T-023.6]** Configure TestFlight deployment

- [x] **[T-024]** Set up CI/CD for backend
  - **Depends on:** T-003
  - **Context:** Use GitHub Actions for IaC deployment. Configure: Terraform plan/apply, Lambda deployment, API Gateway updates. Set up staging → production promotion flow.

  - [x] **[T-024.1]** Create GitHub Actions workflow for infrastructure
  - [x] **[T-024.2]** Configure Terraform state management (S3 backend)
  - [x] **[T-024.3]** Add Terraform plan step with PR comments
  - [x] **[T-024.4]** Configure environment-specific deployments
  - [x] **[T-024.5]** Set up Lambda deployment automation
  - [x] **[T-024.6]** Add integration test step

---

## Phase 1: Core Logging (Weeks 4–7)

### 1.1 Patient Dashboard

- [x] **[T-025]** Design patient home/dashboard screen
  - **Depends on:** T-001, T-002
  - **Context:** Large-button grid layout with 6 vitals + media upload + LLM placeholder. Follow accessibility guidelines: minimum 72dp touch targets, high contrast, single-word labels with icons. Bottom tab bar with 3-4 tabs max.

  - [x] **[T-025.1]** Create wireframes/mockups
  - [x] **[T-025.2]** Define color palette (WCAG AA compliant)
  - [x] **[T-025.3]** Design icon set for each vital type
  - [x] **[T-025.4]** Define typography scale (large, readable fonts)

- [x] **[T-026]** Implement patient dashboard on Android
  - **Depends on:** T-011, T-025
  - **Context:** Use Jetpack Compose. Create grid of large buttons: BP, Glucose, Temperature, Weight, Pulse, SpO2, Upload Media, LLM Chat (placeholder). Add bottom navigation bar.

  - [x] **[T-026.1]** Create DashboardScreen composable
  - [x] **[T-026.2]** Implement vital button grid layout
  - [x] **[T-026.3]** Add bottom navigation with tabs
  - [x] **[T-026.4]** Implement navigation to each vital screen
  - [x] **[T-026.5]** Add missed reminder prompt banner

- [x] **[T-027]** Implement patient dashboard on iOS
  - **Depends on:** T-012, T-025
  - **Context:** Use SwiftUI. Create LazyVGrid of large buttons. Implement TabView for bottom navigation.

  - [x] **[T-027.1]** Create DashboardView
  - [x] **[T-027.2]** Implement vital button grid layout
  - [x] **[T-027.3]** Add TabView navigation
  - [x] **[T-027.4]** Implement NavigationStack for vital screens
  - [x] **[T-027.5]** Add missed reminder prompt banner

---

### 1.2 Vital Logging Screens

- [x] **[T-028]** Implement blood pressure logging screen (Android)
  - **Depends on:** T-020, T-026
  - **Context:** Full-screen, single-action UI. Two large numeric inputs: systolic and diastolic. Large "Save" button. Play voice acknowledgement on save. Store as two FHIR Observations (systolic: LOINC 8480-6, diastolic: LOINC 8462-4).

  - [x] **[T-028.1]** Create BloodPressureScreen composable
  - [x] **[T-028.2]** Implement large numeric keypad input
  - [x] **[T-028.3]** Add input validation (reasonable BP ranges)
  - [x] **[T-028.4]** Implement save to local FHIR store
  - [x] **[T-028.5]** Add sync queue entry on save
  - [x] **[T-028.6]** Trigger voice acknowledgement

- [x] **[T-029]** Implement blood pressure logging screen (iOS)
  - **Depends on:** T-021, T-027
  - **Context:** Same UX as Android. Use SwiftUI with large number input fields.

  - [x] **[T-029.1]** Create BloodPressureView
  - [x] **[T-029.2]** Implement large numeric input
  - [x] **[T-029.3]** Add input validation
  - [x] **[T-029.4]** Implement save to local FHIR store
  - [x] **[T-029.5]** Add sync queue entry on save
  - [x] **[T-029.6]** Trigger voice acknowledgement

- [x] **[T-030]** Implement glucometer logging screen (Android)
  - **Depends on:** T-020, T-026
  - **Context:** Single numeric input for blood glucose (mg/dL or mmol/L). LOINC code: 2339-0. Include meal timing indicator (fasting/post-meal) as optional metadata.

  - [x] **[T-030.1]** Create GlucoseScreen composable
  - [x] **[T-030.2]** Implement numeric input with unit toggle
  - [x] **[T-030.3]** Add fasting/post-meal selector
  - [x] **[T-030.4]** Implement save to local FHIR store
  - [x] **[T-030.5]** Add sync queue entry on save
  - [x] **[T-030.6]** Trigger voice acknowledgement

- [x] **[T-031]** Implement glucometer logging screen (iOS)
  - **Depends on:** T-021, T-027
  - **Context:** Same UX as Android.

  - [x] **[T-031.1]** Create GlucoseView
  - [x] **[T-031.2]** Implement numeric input with unit toggle
  - [x] **[T-031.3]** Add fasting/post-meal selector
  - [x] **[T-031.4]** Implement save to local FHIR store
  - [x] **[T-031.5]** Add sync queue entry on save
  - [x] **[T-031.6]** Trigger voice acknowledgement

- [x] **[T-032]** Implement temperature logging screen (Android)
  - **Depends on:** T-020, T-026
  - **Context:** Single numeric input with decimal. LOINC code: 8310-5. Support Celsius and Fahrenheit with unit toggle.

  - [x] **[T-032.1]** Create TemperatureScreen composable
  - [x] **[T-032.2]** Implement numeric input with decimal
  - [x] **[T-032.3]** Add C/F unit toggle
  - [x] **[T-032.4]** Implement save to local FHIR store
  - [x] **[T-032.5]** Add sync queue entry and voice acknowledgement

- [x] **[T-033]** Implement temperature logging screen (iOS)
  - **Depends on:** T-021, T-027
  - **Context:** Same UX as Android.

  - [x] **[T-033.1]** Create TemperatureView
  - [x] **[T-033.2]** Implement numeric input with decimal
  - [x] **[T-033.3]** Add C/F unit toggle
  - [x] **[T-033.4]** Implement save to local FHIR store
  - [x] **[T-033.5]** Add sync queue entry and voice acknowledgement

- [x] **[T-034]** Implement weight logging screen (Android)
  - **Depends on:** T-020, T-026
  - **Context:** Single numeric input. LOINC code: 29463-7. Support kg and lbs with unit toggle.

  - [x] **[T-034.1]** Create WeightScreen composable
  - [x] **[T-034.2]** Implement numeric input with decimal
  - [x] **[T-034.3]** Add kg/lbs unit toggle
  - [x] **[T-034.4]** Implement save to local FHIR store
  - [x] **[T-034.5]** Add sync queue entry and voice acknowledgement

- [x] **[T-035]** Implement weight logging screen (iOS)
  - **Depends on:** T-021, T-027
  - **Context:** Same UX as Android.

  - [x] **[T-035.1]** Create WeightView
  - [x] **[T-035.2]** Implement numeric input with decimal
  - [x] **[T-035.3]** Add kg/lbs unit toggle
  - [x] **[T-035.4]** Implement save to local FHIR store
  - [x] **[T-035.5]** Add sync queue entry and voice acknowledgement

- [x] **[T-036]** Implement pulse/heart rate logging screen (Android)
  - **Depends on:** T-020, T-026
  - **Context:** Single numeric input (bpm). LOINC code: 8867-4.

  - [x] **[T-036.1]** Create PulseScreen composable
  - [x] **[T-036.2]** Implement numeric input
  - [x] **[T-036.3]** Add input validation (reasonable HR range)
  - [x] **[T-036.4]** Implement save to local FHIR store
  - [x] **[T-036.5]** Add sync queue entry and voice acknowledgement

- [x] **[T-037]** Implement pulse/heart rate logging screen (iOS)
  - **Depends on:** T-021, T-027
  - **Context:** Same UX as Android.

  - [x] **[T-037.1]** Create PulseView
  - [x] **[T-037.2]** Implement numeric input
  - [x] **[T-037.3]** Add input validation
  - [x] **[T-037.4]** Implement save to local FHIR store
  - [x] **[T-037.5]** Add sync queue entry and voice acknowledgement

- [x] **[T-038]** Implement SpO2 logging screen (Android)
  - **Depends on:** T-020, T-026
  - **Context:** Single numeric input (percentage). LOINC code: 2708-6. Validate range 0-100.

  - [x] **[T-038.1]** Create SpO2Screen composable
  - [x] **[T-038.2]** Implement numeric input
  - [x] **[T-038.3]** Add percentage validation
  - [x] **[T-038.4]** Implement save to local FHIR store
  - [x] **[T-038.5]** Add sync queue entry and voice acknowledgement

- [x] **[T-039]** Implement SpO2 logging screen (iOS)
  - **Depends on:** T-021, T-027
  - **Context:** Same UX as Android.

  - [x] **[T-039.1]** Create SpO2View
  - [x] **[T-039.2]** Implement numeric input
  - [x] **[T-039.3]** Add percentage validation
  - [x] **[T-039.4]** Implement save to local FHIR store
  - [x] **[T-039.5]** Add sync queue entry and voice acknowledgement

---

### 1.3 Voice Acknowledgement System

- [ ] **[T-040]** Record and prepare voice acknowledgement clips
  - **Depends on:** None (can run in parallel)
  - **Context:** Record human voice clips in English for all success and failure states. Clear, warm voice. Duration: 2-3 seconds each. Format: MP3 or AAC. Clips needed:
    - Success: one per vital type (7 clips)
    - Generic success: "Saved successfully"
    - Upload success: "File uploaded successfully"
    - Failure: "Could not save, please try again"
    - No network: "No internet connection"

  - [ ] **[T-040.1]** Write script for all voice clips
  - [ ] **[T-040.2]** Engage voice talent
  - [ ] **[T-040.3]** Record all clips
  - [ ] **[T-040.4]** Edit and normalize audio levels
  - [ ] **[T-040.5]** Export in appropriate format

- [x] **[T-041]** Implement voice acknowledgement system (Android)
  - **Depends on:** T-040
  - **Context:** Bundle audio clips as raw resources. Create AudioPlayer service. Play audio using media stream (not notification stream) to work in silent mode. Trigger on save events.

  - [ ] **[T-041.1]** Add audio files to res/raw
  - [x] **[T-041.2]** Create VoiceAcknowledgementPlayer class
  - [x] **[T-041.3]** Implement MediaPlayer playback with media stream
  - [x] **[T-041.4]** Create enum mapping for vital type to audio file
  - [x] **[T-041.5]** Integrate with all save flows
  - [ ] **[T-041.6]** Add unit tests

- [x] **[T-042]** Implement voice acknowledgement system (iOS)
  - **Depends on:** T-040
  - **Context:** Bundle audio clips in app bundle. Use AVFoundation for playback. Configure audio session to play over silent mode.

  - [ ] **[T-042.1]** Add audio files to asset catalog
  - [x] **[T-042.2]** Create VoiceAcknowledgementPlayer class
  - [x] **[T-042.3]** Configure AVAudioSession for playback
  - [x] **[T-042.4]** Implement playback with AVAudioPlayer
  - [x] **[T-042.5]** Integrate with all save flows
  - [ ] **[T-042.6]** Add unit tests

---

### 1.4 History View

- [x] **[T-043]** Implement vital history list view (Android)
  - **Depends on:** T-020, T-026
  - **Context:** Per-vital chronological list showing: value, timestamp, recorder identity, sync status. Allow filtering by date range. Accessible from dashboard.

  - [x] **[T-043.1]** Create HistoryScreen composable
  - [x] **[T-043.2]** Implement LazyColumn with vital entries
  - [x] **[T-043.3]** Add vital type tabs or filter
  - [x] **[T-043.4]** Display sync status indicator
  - [x] **[T-043.5]** Add date range filter

- [x] **[T-044]** Implement vital history list view (iOS)
  - **Depends on:** T-021, T-027
  - **Context:** Same UX as Android. Use SwiftUI List.

  - [x] **[T-044.1]** Create HistoryView
  - [x] **[T-044.2]** Implement List with vital entries
  - [x] **[T-044.3]** Add vital type tabs or filter
  - [x] **[T-044.4]** Display sync status indicator
  - [x] **[T-044.5]** Add date range filter

---

### 1.5 LLM Chat Placeholder

- [x] **[T-045]** Implement LLM chat placeholder screen (Android)
  - **Depends on:** T-026
  - **Context:** Simple "Coming Soon" screen with illustration. Accessible from dashboard. No functionality in v1.

  - [x] **[T-045.1]** Create ChatPlaceholderScreen
  - [x] **[T-045.2]** Add "Coming Soon" message and illustration
  - [x] **[T-045.3]** Add navigation from dashboard

- [x] **[T-046]** Implement LLM chat placeholder screen (iOS)
  - **Depends on:** T-027
  - **Context:** Same UX as Android.

  - [x] **[T-046.1]** Create ChatPlaceholderView
  - [x] **[T-046.2]** Add "Coming Soon" message and illustration
  - [x] **[T-046.3]** Add navigation from dashboard

---

## Phase 2: Sync & Unstructured Upload (Weeks 8–11)

### 2.1 Background Sync Infrastructure

- [x] **[T-047]** Implement WiFi connectivity listener (Android)
  - **Depends on:** T-020
  - **Context:** Use ConnectivityManager to detect WiFi connectivity changes. Trigger sync queue flush when WiFi connects. Respect user's data saver settings.

  - [x] **[T-047.1]** Create NetworkMonitor class
  - [x] **[T-047.2]** Register BroadcastReceiver for connectivity changes
  - [x] **[T-047.3]** Emit connectivity state via Flow
  - [x] **[T-047.4]** Trigger SyncService on WiFi connect

- [x] **[T-048]** Implement WiFi connectivity listener (iOS)
  - **Depends on:** T-021
  - **Context:** Use NWPathMonitor to detect network changes. Trigger sync on WiFi availability.

  - [x] **[T-048.1]** Create NetworkMonitor class
  - [x] **[T-048.2]** Configure NWPathMonitor for WiFi
  - [x] **[T-048.3]** Publish connectivity state
  - [x] **[T-048.4]** Trigger sync service on WiFi connect

- [x] **[T-049]** Implement FHIR sync service (Android)
  - **Depends on:** T-018, T-047
  - **Context:** Background service that flushes sync queue. POST new Observations, PUT updates. Handle conflicts using server-wins (timestamp comparison). Update local sync status on success/failure.

  - [x] **[T-049.1]** Create SyncWorker (WorkManager)
  - [x] **[T-049.2]** Implement sync queue processing in FIFO order
  - [x] **[T-049.3]** POST/PUT to HealthLake via API Gateway
  - [x] **[T-049.4]** Implement conflict resolution (server-wins)
  - [x] **[T-049.5]** Update local sync status
  - [x] **[T-049.6]** Handle network errors with retry

- [x] **[T-050]** Implement FHIR sync service (iOS)
  - **Depends on:** T-019, T-048
  - **Context:** Use BGTaskScheduler for background sync. Process sync queue when WiFi available.

  - [x] **[T-050.1]** Register BGTaskScheduler task
  - [x] **[T-050.2]** Implement sync queue processing
  - [x] **[T-050.3]** POST/PUT to HealthLake via API Gateway
  - [x] **[T-050.4]** Implement conflict resolution
  - [x] **[T-050.5]** Update local sync status
  - [x] **[T-050.6]** Handle errors with retry

- [x] **[T-051]** Implement sync status indicator on dashboard
  - **Depends on:** T-026, T-027, T-049, T-050
  - **Context:** Show sync status on dashboard: "All synced" / "X pending" / "Sync error". Tap for details.

  - [x] **[T-051.1]** Add sync status UI component (Android)
  - [x] **[T-051.2]** Add sync status UI component (iOS)
  - [x] **[T-051.3]** Create sync status detail screen
  - [x] **[T-051.4]** Add manual sync trigger button

---

### 2.2 Backend Sync Endpoints

- [x] **[T-052]** Implement FHIR Observation sync endpoint
  - **Depends on:** T-005, T-006
  - **Context:** API Gateway endpoint backed by Lambda. Accept FHIR Observation, validate, write to HealthLake. Return created resource with server-assigned ID.

  - [x] **[T-052.1]** Create Lambda function for Observation sync
  - [x] **[T-052.2]** Validate incoming FHIR resource
  - [x] **[T-052.3]** Implement HealthLake write
  - [x] **[T-052.4]** Add Cognito authorization check
  - [x] **[T-052.5]** Return server-assigned resource ID
  - [x] **[T-052.6]** Add CloudWatch logging

- [x] **[T-053]** Implement bulk sync endpoint
  - **Depends on:** T-052
  - **Context:** Accept array of Observations for batch sync. Process in transaction. Return success/failure per resource.

  - [x] **[T-053.1]** Create Lambda function for bulk sync
  - [x] **[T-053.2]** Implement batch processing
  - [x] **[T-053.3]** Handle partial failures
  - [x] **[T-053.4]** Return per-resource status

---

### 2.3 Unstructured Data Upload

- [x] **[T-054]** Implement presigned URL generation endpoint
  - **Depends on:** T-005, T-007
  - **Context:** Lambda endpoint that generates presigned S3 PUT URLs. Client requests URL with filename, content-type, file type (prescription, wound photo, etc.). URL valid for 15 minutes.

  - [x] **[T-054.1]** Create Lambda function
  - [x] **[T-054.2]** Generate S3 key using format: `{patient_id}/{year}/{month}/{day}/{timestamp}_{type}_{filename}`
  - [x] **[T-054.3]** Generate presigned PUT URL
  - [x] **[T-054.4]** Return URL and S3 key

- [x] **[T-055]** Implement S3 upload with SQS notification
  - **Depends on:** T-007, T-008
  - **Context:** Configure S3 event notification to send message to SQS on object creation. Message includes: bucket, key, size, content-type.

  - [x] **[T-055.1]** Configure S3 event notification
  - [x] **[T-055.2]** Create Lambda to enrich SQS message
  - [x] **[T-055.3]** Add patient_id, file_type, uploader_persona to message
  - [ ] **[T-055.4]** Test end-to-end flow

- [x] **[T-056]** Implement DocumentReference creation endpoint
  - **Depends on:** T-052
  - **Context:** After successful S3 upload, client creates FHIR DocumentReference pointing to S3 key. Endpoint validates and stores in HealthLake.

  - [x] **[T-056.1]** Create Lambda function
  - [x] **[T-056.2]** Validate DocumentReference structure
  - [x] **[T-056.3]** Store in HealthLake
  - [x] **[T-056.4]** Link to Patient resource

- [x] **[T-057]** Implement unstructured upload flow (Android)
  - **Depends on:** T-020, T-054
  - **Context:** Request presigned URL, upload file directly to S3. On success, create FHIR DocumentReference locally and add to sync queue. Play voice acknowledgement.

  - [x] **[T-057.1]** Create UploadService class
  - [x] **[T-057.2]** Request presigned URL from API
  - [x] **[T-057.3]** Upload file using OkHttp/Retrofit
  - [x] **[T-057.4]** Create local DocumentReference
  - [x] **[T-057.5]** Add to sync queue
  - [x] **[T-057.6]** Trigger voice acknowledgement

- [x] **[T-058]** Implement unstructured upload flow (iOS)
  - **Depends on:** T-021, T-054
  - **Context:** Same as Android. Use URLSession for upload.

  - [x] **[T-058.1]** Create UploadService class
  - [x] **[T-058.2]** Request presigned URL
  - [x] **[T-058.3]** Upload file using URLSession
  - [x] **[T-058.4]** Create local DocumentReference
  - [x] **[T-058.5]** Add to sync queue
  - [x] **[T-058.6]** Trigger voice acknowledgement

---

### 2.4 Media Capture Screens

- [x] **[T-059]** Implement prescription scan screen (Android)
  - **Depends on:** T-057
  - **Context:** Camera capture with document edge detection (optional). Also support file picker for PDF/image. Queue for upload.

  - [x] **[T-059.1]** Create PrescriptionScanScreen
  - [x] **[T-059.2]** Implement camera capture
  - [x] **[T-059.3]** Add file picker for existing documents
  - [x] **[T-059.4]** Preview before upload
  - [x] **[T-059.5]** Trigger upload flow

- [x] **[T-060]** Implement prescription scan screen (iOS)
  - **Depends on:** T-058
  - **Context:** Same as Android. Use VisionKit for document scanning if available.

  - [x] **[T-060.1]** Create PrescriptionScanView
  - [x] **[T-060.2]** Implement camera capture or VNDocumentCameraViewController
  - [x] **[T-060.3]** Add file picker
  - [x] **[T-060.4]** Preview before upload
  - [x] **[T-060.5]** Trigger upload flow

- [x] **[T-061]** Implement wound/medical photo capture (Android)
  - **Depends on:** T-057
  - **Context:** Camera capture for wounds, urine, stool, vomit photos. Add description/notes field. Queue for upload.

  - [x] **[T-061.1]** Create MedicalPhotoScreen
  - [x] **[T-061.2]** Implement camera capture
  - [x] **[T-061.3]** Add photo type selector
  - [x] **[T-061.4]** Add optional notes field
  - [x] **[T-061.5]** Trigger upload flow

- [x] **[T-062]** Implement wound/medical photo capture (iOS)
  - **Depends on:** T-058
  - **Context:** Same as Android.

  - [x] **[T-062.1]** Create MedicalPhotoView
  - [x] **[T-062.2]** Implement camera capture
  - [x] **[T-062.3]** Add photo type selector
  - [x] **[T-062.4]** Add optional notes field
  - [x] **[T-062.5]** Trigger upload flow

- [x] **[T-063]** Implement voice note recording (Android)
  - **Depends on:** T-057
  - **Context:** In-app audio recording. Show recording timer. Allow playback before save. Queue for upload.

  - [x] **[T-063.1]** Create VoiceNoteScreen
  - [x] **[T-063.2]** Implement MediaRecorder recording
  - [x] **[T-063.3]** Show recording timer UI
  - [x] **[T-063.4]** Implement playback preview
  - [x] **[T-063.5]** Trigger upload flow

- [x] **[T-064]** Implement voice note recording (iOS)
  - **Depends on:** T-058
  - **Context:** Same as Android. Use AVAudioRecorder.

  - [x] **[T-064.1]** Create VoiceNoteView
  - [x] **[T-064.2]** Implement AVAudioRecorder recording
  - [x] **[T-064.3]** Show recording timer UI
  - [x] **[T-064.4]** Implement playback preview
  - [x] **[T-064.5]** Trigger upload flow

- [x] **[T-065]** Implement video note recording (Android)
  - **Depends on:** T-057
  - **Context:** In-app video recording with time limit (e.g., 2 minutes). Queue for upload.

  - [x] **[T-065.1]** Create VideoNoteScreen
  - [x] **[T-065.2]** Implement CameraX video recording
  - [x] **[T-065.3]** Enforce time limit
  - [x] **[T-065.4]** Implement preview
  - [x] **[T-065.5]** Trigger upload flow

- [x] **[T-066]** Implement video note recording (iOS)
  - **Depends on:** T-058
  - **Context:** Same as Android.

  - [x] **[T-066.1]** Create VideoNoteView
  - [x] **[T-066.2]** Implement video recording
  - [x] **[T-066.3]** Enforce time limit
  - [x] **[T-066.4]** Implement preview
  - [x] **[T-066.5]** Trigger upload flow

---

## Phase 3: Relative App (Weeks 10–13)

### 3.1 Relative View Mode

- [ ] **[T-067]** Implement relative login and view mode detection
  - **Depends on:** T-011, T-012
  - **Context:** On login, check Cognito group. If `relatives`, show relative UI instead of patient UI. Relative uses own device, separate from patient.

  - [ ] **[T-067.1]** Parse Cognito JWT for group claim (Android)
  - [ ] **[T-067.2]** Parse Cognito JWT for group claim (iOS)
  - [ ] **[T-067.3]** Route to appropriate UI based on group
  - [ ] **[T-067.4]** Handle multi-patient relatives (future consideration)

- [ ] **[T-068]** Design relative dashboard
  - **Depends on:** T-067
  - **Context:** At-a-glance summary: last logged value per vital with timestamp. Color-coded status (green = within threshold, red = outside). Alert inbox access. Settings access.

  - [ ] **[T-068.1]** Create wireframes/mockups
  - [ ] **[T-068.2]** Define status color scheme
  - [ ] **[T-068.3]** Design card layout for vitals summary

- [x] **[T-069]** Implement relative dashboard (Android)
  - **Depends on:** T-067, T-068
  - **Context:** Fetch patient's latest Observations from HealthLake (via API). Display summary cards. Show threshold status.

  - [x] **[T-069.1]** Create RelativeDashboardScreen
  - [x] **[T-069.2]** Implement API client for fetching patient data
  - [x] **[T-069.3]** Display vital summary cards
  - [x] **[T-069.4]** Show threshold status coloring
  - [x] **[T-069.5]** Add pull-to-refresh

- [x] **[T-070]** Implement relative dashboard (iOS)
  - **Depends on:** T-067, T-068
  - **Context:** Same as Android.

  - [x] **[T-070.1]** Create RelativeDashboardView
  - [x] **[T-070.2]** Implement API client for fetching patient data
  - [x] **[T-070.3]** Display vital summary cards
  - [x] **[T-070.4]** Show threshold status coloring
  - [x] **[T-070.5]** Add pull-to-refresh

---

### 3.2 Trends View

- [x] **[T-071]** Implement trends view (Android)
  - **Depends on:** T-069
  - **Context:** Time-series charts per vital. Configurable date range (7d/30d/90d). Use charting library (MPAndroidChart or similar). Show threshold lines on charts.

  - [x] **[T-071.1]** Create TrendsScreen
  - [x] **[T-071.2]** Add charting library dependency
  - [x] **[T-071.3]** Implement line chart for each vital
  - [x] **[T-071.4]** Add date range selector
  - [x] **[T-071.5]** Overlay threshold lines on charts
  - [x] **[T-071.6]** Implement vital type tabs

- [x] **[T-072]** Implement trends view (iOS)
  - **Depends on:** T-070
  - **Context:** Same as Android. Use Swift Charts (iOS 16+) or Charts library.

  - [x] **[T-072.1]** Create TrendsView
  - [x] **[T-072.2]** Implement line chart for each vital
  - [x] **[T-072.3]** Add date range picker
  - [x] **[T-072.4]** Overlay threshold lines
  - [x] **[T-072.5]** Implement vital type tabs

---

### 3.3 Threshold Configuration

- [x] **[T-073]** Implement threshold configuration backend
  - **Depends on:** T-010
  - **Context:** API endpoints to CRUD thresholds per vital per patient. Store in RDS. Support doctor override flag. Return effective threshold (doctor > relative priority).

  - [x] **[T-073.1]** Create Lambda for threshold CRUD
  - [x] **[T-073.2]** Implement GET thresholds endpoint
  - [x] **[T-073.3]** Implement PUT threshold endpoint
  - [x] **[T-073.4]** Implement override logic (doctor > relative)
  - [x] **[T-073.5]** Add API Gateway routes

- [x] **[T-074]** Implement threshold configuration screen (Android)
  - **Depends on:** T-069, T-073
  - **Context:** Per-vital min/max input fields. Show doctor-set values as read-only. Save to backend.

  - [x] **[T-074.1]** Create ThresholdConfigScreen
  - [x] **[T-074.2]** Fetch current thresholds from API
  - [x] **[T-074.3]** Implement per-vital min/max inputs
  - [x] **[T-074.4]** Show doctor override indicator
  - [x] **[T-074.5]** Save changes to API

- [x] **[T-075]** Implement threshold configuration screen (iOS)
  - **Depends on:** T-070, T-073
  - **Context:** Same as Android.

  - [x] **[T-075.1]** Create ThresholdConfigView
  - [x] **[T-075.2]** Fetch current thresholds
  - [x] **[T-075.3]** Implement per-vital min/max inputs
  - [x] **[T-075.4]** Show doctor override indicator
  - [x] **[T-075.5]** Save changes to API

---

### 3.4 Reminder Configuration

- [x] **[T-076]** Implement reminder configuration backend
  - **Depends on:** T-010
  - **Context:** API endpoints to CRUD reminder windows per vital. Store in RDS: vital_type, window_hours, grace_period_minutes.

  - [x] **[T-076.1]** Create Lambda for reminder CRUD
  - [x] **[T-076.2]** Implement GET reminders endpoint
  - [x] **[T-076.3]** Implement PUT reminder endpoint
  - [x] **[T-076.4]** Add validation (window > 0)

- [x] **[T-077]** Implement reminder configuration screen (Android)
  - **Depends on:** T-069, T-076
  - **Context:** Per-vital time window input (hours). Grace period input (minutes).

  - [x] **[T-077.1]** Create ReminderConfigScreen
  - [x] **[T-077.2]** Fetch current config from API
  - [x] **[T-077.3]** Implement per-vital window inputs
  - [x] **[T-077.4]** Add grace period input
  - [x] **[T-077.5]** Save changes to API

- [x] **[T-078]** Implement reminder configuration screen (iOS)
  - **Depends on:** T-070, T-076
  - **Context:** Same as Android.

  - [x] **[T-078.1]** Create ReminderConfigView
  - [x] **[T-078.2]** Fetch current config
  - [x] **[T-078.3]** Implement per-vital window inputs
  - [x] **[T-078.4]** Add grace period input
  - [x] **[T-078.5]** Save changes to API

---

### 3.5 Push Notifications

- [x] **[T-079]** Set up push notification infrastructure
  - **Depends on:** T-003
  - **Context:** Configure SNS for iOS (APNs) and Android (FCM). Create SNS platform applications. Set up Lambda for sending notifications.

  - [x] **[T-079.1]** Create SNS platform application for iOS (APNs)
  - [x] **[T-079.2]** Create SNS platform application for Android (FCM)
  - [x] **[T-079.3]** Create Lambda for sending push notifications
  - [x] **[T-079.4]** Store device tokens in RDS

- [x] **[T-080]** Implement device token registration
  - **Depends on:** T-079
  - **Context:** On app launch, register device token with backend. Update on token refresh.

  - [x] **[T-080.1]** Implement FCM token registration (Android)
  - [x] **[T-080.2]** Implement APNs token registration (iOS)
  - [x] **[T-080.3]** Create API endpoint for token registration
  - [x] **[T-080.4]** Store tokens in RDS linked to user

- [x] **[T-081]** Implement threshold breach notification
  - **Depends on:** T-052, T-073, T-079
  - **Context:** After Observation sync, check value against thresholds. If outside bounds, send push to relative's device.

  - [x] **[T-081.1]** Add threshold check in sync Lambda
  - [x] **[T-081.2]** Query relative's device token
  - [x] **[T-081.3]** Send push notification via SNS
  - [x] **[T-081.4]** Include vital type and value in notification

- [x] **[T-082]** Implement reminder lapse notification
  - **Depends on:** T-076, T-079
  - **Context:** Scheduled Lambda (CloudWatch Events) checks for missed logs. If window exceeded, notify patient. If grace period exceeded, notify relative.

  - [x] **[T-082.1]** Create CloudWatch scheduled rule (every 15 min)
  - [x] **[T-082.2]** Implement Lambda to check missed logs
  - [x] **[T-082.3]** Send patient reminder notification
  - [x] **[T-082.4]** Send relative alert after grace period

- [x] **[T-083]** Implement notification handling in apps
  - **Depends on:** T-080
  - **Context:** Handle incoming notifications. Show in notification tray. Deep link to relevant screen on tap.

  - [x] **[T-083.1]** Implement FCM message handling (Android)
  - [x] **[T-083.2]** Implement APNs handling (iOS)
  - [x] **[T-083.3]** Implement deep linking to relevant screens
  - [x] **[T-083.4]** Request notification permissions

---

### 3.6 Alert Inbox

- [x] **[T-084]** Implement alert inbox backend
  - **Depends on:** T-081, T-082
  - **Context:** Store sent alerts in RDS: alert_type, vital_type, value, timestamp, read_status. API endpoint to list and mark as read.

  - [x] **[T-084.1]** Create alerts table in RDS
  - [x] **[T-084.2]** Update notification Lambda to store alerts
  - [x] **[T-084.3]** Create GET alerts endpoint
  - [x] **[T-084.4]** Create PATCH endpoint to mark as read

- [x] **[T-085]** Implement alert inbox screen (Android)
  - **Depends on:** T-069, T-084
  - **Context:** Chronological list of threshold violations and reminder lapses. Mark as read on view. Filter by alert type.

  - [x] **[T-085.1]** Create AlertInboxScreen
  - [x] **[T-085.2]** Fetch alerts from API
  - [x] **[T-085.3]** Display alert list with icons
  - [x] **[T-085.4]** Mark as read on view
  - [x] **[T-085.5]** Add filter by type

- [x] **[T-086]** Implement alert inbox screen (iOS)
  - **Depends on:** T-070, T-084
  - **Context:** Same as Android.

  - [x] **[T-086.1]** Create AlertInboxView
  - [x] **[T-086.2]** Fetch alerts from API
  - [x] **[T-086.3]** Display alert list
  - [x] **[T-086.4]** Mark as read on view
  - [x] **[T-086.5]** Add filter by type

---

### 3.7 Care Team Management

- [x] **[T-087]** Implement care team management screen (Android)
  - **Depends on:** T-015, T-016, T-069
  - **Context:** List current care team (attendants, doctors). Add/remove attendant. Invite doctor. View pending invites.

  - [x] **[T-087.1]** Create CareTeamScreen
  - [x] **[T-087.2]** Fetch care team from API
  - [x] **[T-087.3]** Display team members with roles
  - [x] **[T-087.4]** Implement add attendant flow
  - [x] **[T-087.5]** Implement invite doctor flow
  - [x] **[T-087.6]** Show pending invites status

- [x] **[T-088]** Implement care team management screen (iOS)
  - **Depends on:** T-015, T-016, T-070
  - **Context:** Same as Android.

  - [x] **[T-088.1]** Create CareTeamView
  - [x] **[T-088.2]** Fetch care team from API
  - [x] **[T-088.3]** Display team members
  - [x] **[T-088.4]** Implement add attendant flow
  - [x] **[T-088.5]** Implement invite doctor flow
  - [x] **[T-088.6]** Show pending invites status

---

## Phase 4: Attendant & Multi-Persona (Weeks 12–14)

### 4.1 Attendant Login Flow

- [x] **[T-089]** Implement attendant login on patient device (Android)
  - **Depends on:** T-011, T-026
  - **Context:** "Switch to Attendant" button on patient home screen. Opens secondary login with attendant credentials. Returns to attendant view on success.

  - [x] **[T-089.1]** Add "Switch to Attendant" button on patient dashboard
  - [x] **[T-089.2]** Create AttendantLoginScreen
  - [x] **[T-089.3]** Implement secondary Cognito session management
  - [x] **[T-089.4]** Store attendant session separately
  - [x] **[T-089.5]** Navigate to attendant home view

- [x] **[T-090]** Implement attendant login on patient device (iOS)
  - **Depends on:** T-012, T-027
  - **Context:** Same as Android.

  - [x] **[T-090.1]** Add "Switch to Attendant" button
  - [x] **[T-090.2]** Create AttendantLoginView
  - [x] **[T-090.3]** Implement secondary session management
  - [x] **[T-090.4]** Store attendant session
  - [x] **[T-090.5]** Navigate to attendant home view

---

### 4.2 Attendant View

- [x] **[T-091]** Implement attendant home view (Android)
  - **Depends on:** T-089
  - **Context:** Same UX as patient but with identity context indicator (banner showing "Logged in as [Attendant Name]"). All logs attributed to attendant.

  - [x] **[T-091.1]** Create AttendantDashboardScreen
  - [x] **[T-091.2]** Add identity context banner
  - [x] **[T-091.3]** Reuse vital logging screens
  - [x] **[T-091.4]** Set performer reference to attendant in FHIR Observations
  - [x] **[T-091.5]** Add "Switch back to Patient" button

- [x] **[T-092]** Implement attendant home view (iOS)
  - **Depends on:** T-090
  - **Context:** Same as Android.

  - [x] **[T-092.1]** Create AttendantDashboardView
  - [x] **[T-092.2]** Add identity context banner
  - [x] **[T-092.3]** Reuse vital logging screens
  - [x] **[T-092.4]** Set performer reference in FHIR Observations
  - [x] **[T-092.5]** Add "Switch back to Patient" button

---

### 4.3 Attendant Observations/Notes

- [x] **[T-093]** Implement attendant observations screen (Android)
  - **Depends on:** T-091
  - **Context:** Free-text observation entry. Voice note entry. Saved as FHIR Observation with note type.

  - [x] **[T-093.1]** Create ObservationNoteScreen
  - [x] **[T-093.2]** Implement text input
  - [x] **[T-093.3]** Integrate voice note recording
  - [x] **[T-093.4]** Save as FHIR Observation
  - [x] **[T-093.5]** Add to sync queue

- [x] **[T-094]** Implement attendant observations screen (iOS)
  - **Depends on:** T-092
  - **Context:** Same as Android.

  - [x] **[T-094.1]** Create ObservationNoteView
  - [x] **[T-094.2]** Implement text input
  - [x] **[T-094.3]** Integrate voice note recording
  - [x] **[T-094.4]** Save as FHIR Observation
  - [x] **[T-094.5]** Add to sync queue

---

### 4.4 Attendant Capabilities

- [x] **[T-095]** Implement attendant threshold/reminder configuration
  - **Depends on:** T-091, T-092, T-074, T-075, T-077, T-078
  - **Context:** Attendant has same configuration capabilities as relative. Reuse screens with attendant context.

  - [x] **[T-095.1]** Enable threshold config screens for attendant (Android)
  - [x] **[T-095.2]** Enable threshold config screens for attendant (iOS)
  - [x] **[T-095.3]** Enable reminder config screens for attendant (Android)
  - [x] **[T-095.4]** Enable reminder config screens for attendant (iOS)

---

### 4.5 Audit Trail

- [x] **[T-096]** Implement audit log backend
  - **Depends on:** T-010, T-052
  - **Context:** Log all FHIR write operations: resource_id, resource_type, action (CREATE/UPDATE), actor_id, actor_role, timestamp. Store in RDS. API endpoint to query.

  - [x] **[T-096.1]** Create audit_log table in RDS
  - [x] **[T-096.2]** Update sync Lambda to write audit entries
  - [x] **[T-096.3]** Create GET audit log endpoint
  - [x] **[T-096.4]** Add filtering by date range and actor

- [x] **[T-097]** Implement audit log viewer for relative (Android)
  - **Depends on:** T-069, T-096
  - **Context:** Chronological list showing who logged what and when. Filter by actor, date range.

  - [x] **[T-097.1]** Create AuditLogScreen
  - [x] **[T-097.2]** Fetch audit log from API
  - [x] **[T-097.3]** Display entries with actor identity
  - [x] **[T-097.4]** Add filters

- [x] **[T-098]** Implement audit log viewer for relative (iOS)
  - **Depends on:** T-070, T-096
  - **Context:** Same as Android.

  - [x] **[T-098.1]** Create AuditLogView
  - [x] **[T-098.2]** Fetch audit log from API
  - [x] **[T-098.3]** Display entries with actor identity
  - [x] **[T-098.4]** Add filters

---

### 4.6 Security Testing

- [x] **[T-099]** Security test attendant access controls
  - **Depends on:** T-091, T-092, T-095
  - **Context:** Verify attendant cannot access relative-only settings. Cannot escalate privileges. Cannot modify patient account.

  - [x] **[T-099.1]** Write security test cases
  - [x] **[T-099.2]** Test API endpoint authorization
  - [x] **[T-099.3]** Test UI access restrictions
  - [x] **[T-099.4]** Document findings and fix issues

---

## Phase 5: Doctor Web Portal (Weeks 13–17)

### 5.1 Web App Scaffold

- [x] **[T-100]** Set up React web app project
  - **Depends on:** T-004
  - **Context:** Create React app with TypeScript. Configure routing (React Router). Add AWS Amplify for Cognito auth. Set up Tailwind CSS or component library.

  - [x] **[T-100.1]** Create React project with TypeScript
  - [x] **[T-100.2]** Configure routing
  - [x] **[T-100.3]** Add AWS Amplify Auth
  - [x] **[T-100.4]** Set up styling framework
  - [x] **[T-100.5]** Configure build and deployment

- [x] **[T-101]** Implement doctor authentication
  - **Depends on:** T-100
  - **Context:** Cognito login restricted to `doctors` group. Redirect non-doctors to error page.

  - [x] **[T-101.1]** Implement login page
  - [x] **[T-101.2]** Configure Amplify Auth with Cognito
  - [x] **[T-101.3]** Check group membership on login
  - [x] **[T-101.4]** Implement logout
  - [x] **[T-101.5]** Add auth state persistence

---

### 5.2 Patient List

- [x] **[T-102]** Implement patient list backend endpoint
  - **Depends on:** T-005
  - **Context:** Return list of patients linked to doctor. Include: patient_id, name, last_activity_timestamp, unread_alert_count.

  - [x] **[T-102.1]** Create Lambda function
  - [x] **[T-102.2]** Query persona_links for doctor's patients
  - [x] **[T-102.3]** Fetch last activity from HealthLake
  - [x] **[T-102.4]** Count unread alerts from RDS
  - [x] **[T-102.5]** Return aggregated patient list

- [x] **[T-103]** Implement patient list page
  - **Depends on:** T-101, T-102
  - **Context:** Table view with search by name/ID. Columns: name, ID, last activity, unread alerts. Click row to view patient.

  - [x] **[T-103.1]** Create PatientListPage component
  - [x] **[T-103.2]** Fetch patient list from API
  - [x] **[T-103.3]** Implement search filter
  - [x] **[T-103.4]** Display table with sorting
  - [x] **[T-103.5]** Add click handler to navigate to patient view

---

### 5.3 Patient Data Viewer

- [x] **[T-104]** Implement patient data viewer page
  - **Depends on:** T-103
  - **Context:** Tabbed view: Vitals Timeline, Unstructured Files, Care Plan. Header shows patient info.

  - [x] **[T-104.1]** Create PatientViewPage component
  - [x] **[T-104.2]** Fetch patient info from HealthLake
  - [x] **[T-104.3]** Implement tab navigation
  - [x] **[T-104.4]** Create PatientHeader component

- [x] **[T-105]** Implement vitals timeline tab
  - **Depends on:** T-104
  - **Context:** Time-series charts for each vital. Threshold lines overlay. Date range filter. List view of individual Observations.

  - [x] **[T-105.1]** Create VitalsTimelineTab component
  - [x] **[T-105.2]** Fetch Observations from HealthLake
  - [x] **[T-105.3]** Implement charts (Chart.js or Recharts)
  - [x] **[T-105.4]** Add threshold overlay lines
  - [x] **[T-105.5]** Add date range filter
  - [x] **[T-105.6]** Implement observation list view

- [x] **[T-106]** Implement unstructured files tab
  - **Depends on:** T-104
  - **Context:** List DocumentReferences with file type icons. Click to download/view. Filter by type.

  - [x] **[T-106.1]** Create FilesTab component
  - [x] **[T-106.2]** Fetch DocumentReferences from HealthLake
  - [x] **[T-106.3]** Display file list with icons
  - [x] **[T-106.4]** Implement presigned URL download
  - [x] **[T-106.5]** Add file type filter

---

### 5.4 Care Plan Management

- [x] **[T-107]** Implement care plan backend
  - **Depends on:** T-006
  - **Context:** CRUD FHIR CarePlan resources. Store in HealthLake. Link to patient.

  - [x] **[T-107.1]** Create Lambda for CarePlan CRUD
  - [x] **[T-107.2]** Implement POST CarePlan endpoint
  - [x] **[T-107.3]** Implement GET CarePlan endpoint
  - [x] **[T-107.4]** Implement PUT CarePlan endpoint
  - [x] **[T-107.5]** Add API Gateway routes

- [x] **[T-108]** Implement care plan tab
  - **Depends on:** T-104, T-107
  - **Context:** Rich text editor for care plan notes. Save as FHIR CarePlan. View history of care plan updates.

  - [x] **[T-108.1]** Create CarePlanTab component
  - [x] **[T-108.2]** Fetch existing CarePlan
  - [x] **[T-108.3]** Implement rich text editor (Quill, Draft.js, or similar)
  - [x] **[T-108.4]** Save CarePlan on submit
  - [x] **[T-108.5]** Show version history

---

### 5.5 Clinical Threshold Override

- [x] **[T-109]** Implement doctor threshold override
  - **Depends on:** T-073, T-104
  - **Context:** Per-vital min/max form in patient view. On save, overrides relative's thresholds. Store in RDS with doctor identity. Push to HealthLake as FHIR Goal resource.

  - [x] **[T-109.1]** Create ThresholdOverridePanel component
  - [x] **[T-109.2]** Fetch current thresholds
  - [x] **[T-109.3]** Implement override form
  - [x] **[T-109.4]** Update backend to support doctor override
  - [x] **[T-109.5]** Create FHIR Goal resource for threshold
  - [x] **[T-109.6]** Sync override status to mobile apps

---

### 5.6 Observation Annotation

- [x] **[T-110]** Implement observation annotation backend
  - **Depends on:** T-006
  - **Context:** Add annotation to individual FHIR Observation. Store as Annotation element within Observation resource.

  - [x] **[T-110.1]** Create Lambda for annotation
  - [x] **[T-110.2]** Implement PATCH Observation endpoint
  - [x] **[T-110.3]** Append annotation to Observation.note

- [x] **[T-111]** Implement annotation UI in patient view
  - **Depends on:** T-105, T-110
  - **Context:** "Add note" button on each Observation in timeline. Modal with text input. Save annotation.

  - [x] **[T-111.1]** Add "Add note" button to observation rows
  - [x] **[T-111.2]** Create AnnotationModal component
  - [x] **[T-111.3]** Submit annotation to API
  - [x] **[T-111.4]** Display existing annotations on observations

---

### 5.7 Doctor Onboarding

- [x] **[T-112]** Implement doctor registration page
  - **Depends on:** T-016, T-100
  - **Context:** Landing page from invite email. Collect name, credentials, password. Register in Cognito. Link to patient.

  - [x] **[T-112.1]** Create registration page
  - [x] **[T-112.2]** Parse invite token from URL
  - [x] **[T-112.3]** Implement Cognito sign-up
  - [x] **[T-112.4]** Create persona_link on success
  - [x] **[T-112.5]** Redirect to patient view

---

### 5.8 Web Portal Deployment

- [x] **[T-113]** Deploy web portal
  - **Depends on:** T-100
  - **Context:** Deploy to AWS CloudFront + S3 or Amplify Hosting. Configure custom domain. Set up SSL certificate.

  - [x] **[T-113.1]** Configure S3 bucket for static hosting
  - [x] **[T-113.2]** Create CloudFront distribution
  - [x] **[T-113.3]** Configure SSL certificate (ACM)
  - [x] **[T-113.4]** Set up custom domain
  - [x] **[T-113.5]** Configure CI/CD for deployment

---

## Phase 6: Compliance, Hardening & Launch (Weeks 16–20)

### 6.1 DPDP Consent Flow

- [x] **[T-114]** Implement consent flow at onboarding
  - **Depends on:** T-013, T-014
  - **Context:** Display versioned consent text. Require explicit accept checkbox. Store consent record in RDS: user_id, consent_version, accepted_timestamp, consent_text_hash.

  - [x] **[T-114.1]** Create consent text document with versioning
  - [x] **[T-114.2]** Implement consent UI (Android)
  - [x] **[T-114.3]** Implement consent UI (iOS)
  - [x] **[T-114.4]** Create consent API endpoint
  - [x] **[T-114.5]** Store consent record in RDS
  - [x] **[T-114.6]** Block onboarding without consent

---

### 6.2 Data Export

- [x] **[T-115]** Implement data export flow
  - **Depends on:** T-006
  - **Context:** Patient/relative can request data export. Generate FHIR Bundle of all patient data. Provide download link.

  - [x] **[T-115.1]** Create Lambda for data export
  - [x] **[T-115.2]** Query all patient data from HealthLake
  - [x] **[T-115.3]** Package as FHIR Bundle JSON
  - [x] **[T-115.4]** Store temporarily in S3
  - [x] **[T-115.5]** Generate presigned download URL
  - [x] **[T-115.6]** Implement export request UI (Android)
  - [x] **[T-115.7]** Implement export request UI (iOS)

---

### 6.3 Account Deletion

- [x] **[T-116]** Implement account deletion flow
  - **Depends on:** T-006, T-007, T-010
  - **Context:** Cascade delete from RDS, HealthLake, and S3. Respect HIPAA retention requirements (may need to anonymize rather than delete). Require confirmation.

  - [x] **[T-116.1]** Create Lambda for account deletion
  - [x] **[T-116.2]** Implement HIPAA-compliant retention logic
  - [x] **[T-116.3]** Delete/anonymize RDS records
  - [x] **[T-116.4]** Delete/anonymize HealthLake resources
  - [x] **[T-116.5]** Delete S3 objects
  - [x] **[T-116.6]** Disable Cognito user
  - [x] **[T-116.7]** Implement deletion request UI (Android)
  - [x] **[T-116.8]** Implement deletion request UI (iOS)

---

### 6.4 Audit Logging

- [x] **[T-117]** Enable AWS CloudTrail
  - **Depends on:** T-003
  - **Context:** Enable CloudTrail for all API Gateway and HealthLake access events. Store logs in S3 with immutable retention.

  - [x] **[T-117.1]** Create CloudTrail trail
  - [x] **[T-117.2]** Configure S3 bucket for log storage
  - [x] **[T-117.3]** Enable log file validation
  - [x] **[T-117.4]** Set up log retention policy
  - [x] **[T-117.5]** Configure CloudWatch alarms for suspicious activity

---

### 6.5 Encryption

- [x] **[T-118]** Verify encryption at rest
  - **Depends on:** T-006, T-007, T-009
  - **Context:** Audit that all data stores use encryption. HealthLake: verify KMS encryption. S3: verify SSE-KMS. RDS: verify encryption enabled.

  - [x] **[T-118.1]** Audit HealthLake encryption settings
  - [x] **[T-118.2]** Audit S3 bucket encryption
  - [x] **[T-118.3]** Audit RDS encryption
  - [x] **[T-118.4]** Document encryption configuration

- [x] **[T-119]** Implement certificate pinning
  - **Depends on:** T-011, T-012
  - **Context:** Pin API Gateway certificate in mobile apps. Reject connections with mismatched certificates.

  - [x] **[T-119.1]** Extract API Gateway SSL certificate
  - [x] **[T-119.2]** Implement pinning (Android - OkHttp)
  - [x] **[T-119.3]** Implement pinning (iOS - URLSession)
  - [x] **[T-119.4]** Test with proxy tools (should fail)

---

### 6.6 PHI Sanitization

- [x] **[T-120]** Remove PHI from logs and crash reports
  - **Depends on:** T-001, T-002
  - **Context:** Audit all logging statements. Remove any PHI (names, values, IDs). Configure crash reporting (Crashlytics) to exclude PHI.

  - [x] **[T-120.1]** Audit Android logging statements
  - [x] **[T-120.2]** Audit iOS logging statements
  - [x] **[T-120.3]** Configure Crashlytics/Sentry to exclude PHI
  - [x] **[T-120.4]** Implement log sanitization utility
  - [x] **[T-120.5]** Add unit tests for PHI exclusion

---

### 6.7 Security Review & Penetration Testing

- [ ] **[T-121]** Conduct internal security review
  - **Depends on:** All implementation tasks
  - **Context:** Review authentication flows, authorization logic, data encryption, API security. Document findings.

  - [ ] **[T-121.1]** Review Cognito configuration
  - [ ] **[T-121.2]** Review API Gateway authorization
  - [ ] **[T-121.3]** Review Lambda IAM roles
  - [ ] **[T-121.4]** Review mobile app security
  - [ ] **[T-121.5]** Document findings and remediate

- [ ] **[T-122]** Engage external penetration testing
  - **Depends on:** T-121
  - **Context:** Hire external security firm. Scope: mobile apps, API, web portal. Target: 2 weeks engagement. Remediate critical/high findings.

  - [ ] **[T-122.1]** Select and engage pen test firm
  - [ ] **[T-122.2]** Provide access and documentation
  - [ ] **[T-122.3]** Support testing process
  - [ ] **[T-122.4]** Receive and triage findings
  - [ ] **[T-122.5]** Remediate critical/high findings
  - [ ] **[T-122.6]** Obtain final report

---

### 6.8 Legal & Compliance

- [ ] **[T-123]** Execute AWS BAA
  - **Depends on:** T-003
  - **Context:** Business Associate Agreement required for HIPAA. Initiate with AWS. Must be signed before any real PHI is stored.

  - [ ] **[T-123.1]** Initiate BAA request with AWS
  - [ ] **[T-123.2]** Review BAA terms with legal
  - [ ] **[T-123.3]** Execute BAA
  - [ ] **[T-123.4]** Document execution date

- [ ] **[T-124]** Configure data localization for India
  - **Depends on:** T-003
  - **Context:** Indian users' data must reside in AWS ap-south-1. Implement region-aware routing based on user registration country.

  - [ ] **[T-124.1]** Deploy infrastructure in ap-south-1
  - [ ] **[T-124.2]** Implement region detection at registration
  - [ ] **[T-124.3]** Route API requests to correct region
  - [ ] **[T-124.4]** Validate data residency

---

### 6.9 App Store Submission

- [x] **[T-125]** Prepare Android app for Play Store
  - **Depends on:** T-122
  - **Context:** Complete store listing (description, screenshots, privacy policy). Configure app signing. Submit for review.

  - [x] **[T-125.1]** Create store listing content
  - [ ] **[T-125.2]** Capture screenshots for all screen sizes
  - [x] **[T-125.3]** Write privacy policy
  - [ ] **[T-125.4]** Configure Play App Signing
  - [ ] **[T-125.5]** Submit for review
  - [ ] **[T-125.6]** Address review feedback

- [x] **[T-126]** Prepare iOS app for App Store
  - **Depends on:** T-122
  - **Context:** Complete App Store Connect listing. Health app requires additional review. Submit for review.

  - [x] **[T-126.1]** Create App Store Connect listing
  - [ ] **[T-126.2]** Capture screenshots for all devices
  - [x] **[T-126.3]** Write privacy policy and health data usage description
  - [ ] **[T-126.4]** Complete App Privacy questionnaire
  - [ ] **[T-126.5]** Submit for review
  - [ ] **[T-126.6]** Address review feedback

---

## Dependency Summary

```
Phase 0 (Foundation) → Phase 1 (Core Logging) → Phase 2 (Sync & Upload)
                                              ↘
                                                Phase 3 (Relative App)
                                              ↘
                                                Phase 4 (Attendant)
                                              ↘
                                                Phase 5 (Doctor Portal)
                                                            ↓
                                                Phase 6 (Compliance & Launch)
```

**Critical Path:**
- T-003 (AWS Infrastructure) → T-004 (Cognito) → T-005 (API Gateway) → T-006 (HealthLake)
- T-001/T-002 (Mobile Setup) → T-011/T-012 (Auth) → T-020/T-021 (Local FHIR) → Vital Logging
- T-052 (Sync Endpoint) → T-081 (Notifications) → T-082 (Reminders)
- T-121 (Security Review) → T-122 (Pen Test) → T-125/T-126 (App Store)

---

## Checklist Summary

| Phase | Tasks | Subtasks |
|-------|-------|----------|
| Phase 0: Foundation | 24 | 113 |
| Phase 1: Core Logging | 22 | 95 |
| Phase 2: Sync & Upload | 20 | 88 |
| Phase 3: Relative App | 22 | 95 |
| Phase 4: Attendant | 11 | 47 |
| Phase 5: Doctor Portal | 14 | 63 |
| Phase 6: Compliance | 13 | 56 |
| **Total** | **126** | **557** |

---

*CareLog Implementation Plan v1.0 — March 2026*

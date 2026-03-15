# CareLog — Product Requirements Document

**Version:** 0.1 — DRAFT  
**Date:** March 2026  
**Status:** In Review  
**Classification:** Confidential

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Personas](#3-personas)
4. [User Flows](#4-user-flows)
5. [Feature Specifications](#5-feature-specifications)
6. [UX Design Principles](#6-ux-design-principles)
7. [Technical Architecture](#7-technical-architecture)
8. [Compliance & Security](#8-compliance--security)
9. [Non-Functional Requirements](#9-non-functional-requirements)
10. [Open Questions & Decisions Deferred](#10-open-questions--decisions-deferred)
11. [Suggested v1 Milestones](#11-suggested-v1-milestones)
12. [Implementation Plan](#12-implementation-plan)
13. [Appendix](#13-appendix)

---

## 1. Executive Summary

CareLog is a mobile health monitoring application targeting elderly patients, their caregivers, and attending physicians. The app enables structured, regular logging of clinical vitals and unstructured health data (photos, voice notes, prescriptions), with offline-first local storage and automatic background sync to an AWS-hosted FHIR-compliant backend when WiFi is available.

The app is built on top of the Stanford Spezi framework — SpeziKt for Android and the Spezi iOS SDK — which provides native FHIR support, modular health data components, and accessibility-first design primitives. All structured clinical data is managed as FHIR R4 resources. Unstructured raw data (scanned prescriptions, wound photos, test result files) is stored in Amazon S3 and queued for future processing via Amazon SQS.

A web portal for physicians provides clinical review, annotation, and care plan management. An LLM-powered health chat assistant is scoped as a placeholder in v1, to be fully implemented in a subsequent release.

---

## 2. Goals & Non-Goals

### 2.1 Goals

- Enable elderly, non-tech-savvy patients to log daily health vitals with minimal friction.
- Provide caregivers (relatives) with real-time visibility, configurable alerts, and threshold management.
- Give attending physicians a clinical-grade web portal to review patient data, add care plan notes, and set threshold overrides.
- Support offline-first logging with automatic background sync over WiFi.
- Manage all structured clinical data as FHIR R4 resources via Spezi and AWS HealthLake.
- Ensure compliance with HIPAA (US) and India's DPDP Act from the outset.
- Deliver verbal acknowledgements via pre-recorded human voice clips for every save event.

### 2.2 Non-Goals (v1)

- LLM chat assistant implementation (placeholder UI only in v1).
- Processing of uploaded raw files post-upload — deferred to a future release.
- SMS or email alerting (push notifications only in v1).
- Multi-language support (English only in v1).
- Direct EHR integration with hospital systems.
- Telemedicine or video consultation features.

---

## 3. Personas

CareLog serves four distinct personas with separate access levels, interfaces, and capabilities. The patient is the mandatory central entity; all other personas are optional but additive.

| Persona | Mandatory? | Interface | Primary Role |
|---|---|---|---|
| Patient | **Yes** | Mobile App | Primary health data logger; the focus of all monitoring. |
| Attendant | No | Mobile App (patient's device) | Logs vitals and observations on patient's behalf; has own identity/credentials. |
| Relative | No | Mobile App (own device) | Account creator; configures alerts, thresholds, and schedules; primary caregiver. |
| Doctor | No (≥1 recommended) | Web Portal | Reviews patient data; sets clinical thresholds; annotates care plans. |

### 3.1 Persona Capability Matrix

| Capability | Patient | Attendant | Relative | Doctor |
|---|---|---|---|---|
| Log vitals (self) | ✅ Yes | On behalf | — | — |
| Add observations/notes | ✅ Yes | ✅ Yes | — | ✅ Yes (web) |
| Upload files & media | ✅ Yes | ✅ Yes | — | — |
| View historical logs & trends | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes (web) |
| Configure reminders & thresholds | — | ✅ Yes | ✅ Yes | ✅ Yes (overrides all) |
| Receive push alert notifications | — | — | ✅ Yes | — |
| Manage care plan | — | — | — | ✅ Yes (web) |
| Onboard attendant/doctor | — | — | ✅ Yes | — |

---

## 4. User Flows

### 4.1 Onboarding Flow

The relative initiates account setup for both themselves and the patient in a single flow on the relative's device.

1. Relative downloads the CareLog app on their own device.
2. Relative creates their own account (email/phone + password via AWS Cognito).
3. Relative enters patient details (name, age, gender, medical conditions).
4. App creates a linked patient account and generates a unique Patient ID.
5. Relative optionally adds an attendant by entering their name and contact details.
6. App sends the attendant an invite to set up their own login credentials.
7. Doctor onboarding is deferred — relative can initiate this later from Settings.

### 4.2 Doctor Onboarding Flow

1. Relative navigates to **Settings > Care Team > Add Doctor**.
2. Relative enters doctor's email address.
3. System sends the doctor an invite email with a link to the CareLog web portal.
4. Doctor registers on the web portal via AWS Cognito.
5. Doctor is linked to the patient and gains access to the patient's FHIR data.

### 4.3 Daily Logging Flow (Patient)

1. Patient opens CareLog. Home/dashboard is displayed.
2. If a reminder window has lapsed without a log, a prominent prompt is shown.
3. Patient taps the relevant vital (e.g., Blood Pressure).
4. App presents a full-screen, single-action input: large numeric entry or peripheral device input.
5. Patient confirms the value and taps **Save**.
6. App plays a pre-recorded human voice acknowledgement (e.g., *"Blood pressure saved successfully."*).
7. Log is stored locally as a FHIR Observation resource.
8. If WiFi is available, log is synced to AWS HealthLake in the background.

### 4.4 Attendant Logging Flow

1. Attendant opens CareLog on the patient's device and selects **Attendant Login**.
2. Attendant enters their own credentials.
3. App switches to Attendant view — same large-button UX, logs attributed to the attendant.
4. Attendant can log vitals, upload files/media, add observations, and view history.
5. All actions are recorded with the attendant's identity in the FHIR audit trail.

---

## 5. Feature Specifications

### 5.1 Structured Clinical Vitals Logging

All structured vitals are stored as FHIR R4 Observation resources. Each observation captures: value, unit, timestamp, LOINC code, recording persona identity, and sync status.

| Vital | FHIR Resource | LOINC Code | Input Method |
|---|---|---|---|
| Body Weight | Observation | 29463-7 | Numeric keypad |
| Glucometer Reading | Observation | 2339-0 | Numeric keypad |
| Temperature | Observation | 8310-5 | Numeric keypad |
| Blood Pressure (Systolic) | Observation | 8480-6 | Numeric keypad or BP peripheral |
| Blood Pressure (Diastolic) | Observation | 8462-4 | Numeric keypad or BP peripheral |
| Pulse / Heart Rate | Observation | 8867-4 | Numeric keypad or peripheral |
| SpO2 | Observation | 2708-6 | Numeric keypad or pulse oximeter |

### 5.2 Unstructured Data Upload

Unstructured data is uploaded to Amazon S3 and managed separately from FHIR structured data. The app generates a FHIR DocumentReference resource pointing to the S3 object key for traceability.

**Supported media types:**
- Prescription scans — camera capture or file upload (PDF/image)
- Lab / test result files — PDF or image upload
- Wound, urine, stool, vomit photographs — camera capture
- Voice notes — in-app audio recording
- Video notes — in-app video recording

**Upload behaviour:**
- Files are stored locally first if WiFi is unavailable.
- Background upload to S3 via AWS API Gateway when WiFi is detected.
- An SQS message is enqueued upon successful upload (for future processing pipelines).
- A pre-recorded voice acknowledgement plays on upload success or failure.

### 5.3 Verbal Acknowledgement System

Every save or upload event triggers a pre-recorded human voice audio clip. This is a critical accessibility feature for non-tech-savvy elderly patients.

- **Success clips:** one per vital type (e.g., *"Your blood pressure has been saved successfully."*)
- **Failure clips:** generic upload failure and no-network warnings
- Clips are bundled with the app — no network required to play
- English only in v1; clip library to be extended for additional languages in future releases
- Audio plays even when the device is in silent mode (using media audio stream)

### 5.4 Reminder & Alert System

#### 5.4.1 Reminder Logic

- The relative configures a time window per vital type (e.g., *"Blood pressure must be logged every 12 hours"*).
- If no log is made within the window, a push notification is sent to the patient's device.
- A secondary notification is sent to the relative's device if the window is exceeded by a configurable grace period.

#### 5.4.2 Threshold & Alarm Logic

- The relative manually sets min/max thresholds for each vital.
- If a doctor is onboarded, the doctor's thresholds override the relative's for clinical vitals.
- When a logged value falls outside the active threshold, a push notification is sent to the relative's device.
- **Threshold hierarchy:** Doctor (highest authority) > Relative (default if no doctor threshold set)

### 5.5 LLM Chat Assistant (Placeholder)

A placeholder entry point for an LLM-powered health chat assistant is included on the patient's and relative's home/dashboard screen. In v1, tapping the entry point displays a *"Coming soon"* screen. The assistant will be context-aware of the patient's FHIR data and will support both text and voice interaction in a future release.

---

## 6. UX Design Principles

### 6.1 Patient-Facing App

- **One action per screen** — never show more than one primary action at a time.
- **Large touch targets** — minimum 48×48dp tap area; ideally 72dp+ for primary actions.
- **High contrast** — WCAG AA minimum (4.5:1 contrast ratio); targeting AAA (7:1) for primary elements.
- **Minimal text** — icons with single-word labels; avoid paragraphs of instruction.
- **Voice feedback** — pre-recorded acknowledgements for every meaningful action.
- **Persistent home/dashboard** — always accessible via a single tap from any screen.
- **No hidden navigation** — bottom tab bar with 3–4 tabs maximum.

### 6.2 Relative-Facing App

- **Dashboard overview** — at-a-glance summary of patient's last logged vitals with timestamps.
- **Alert inbox** — chronological list of threshold violations and reminder breaches.
- **Settings panel** — configure thresholds, reminder windows, care team, and notification preferences.
- **Trends view** — time-series charts per vital, configurable date range.

### 6.3 Doctor Web Portal

- Patient list with last-activity timestamps.
- Per-patient FHIR data viewer with timeline and charting.
- Care plan editor — add/update care plan notes and clinical thresholds.
- Annotation tool — add clinical notes to individual FHIR Observations.

---

## 7. Technical Architecture

### 7.1 Mobile App Framework

| Platform | Framework | Repository |
|---|---|---|
| Android | SpeziKt (Stanford Spezi Kotlin) | https://github.com/StanfordSpezi/SpeziKt |
| iOS | Spezi iOS SDK | https://github.com/StanfordSpezi/ |

- **FHIR version:** R4
- **Local FHIR store:** Spezi's built-in local FHIR storage module for offline-first persistence
- **Background sync:** triggered by WiFi connectivity change events

### 7.2 Backend Architecture

| Component | AWS Service | Purpose |
|---|---|---|
| API Entry Point | Amazon API Gateway | Single entry point for all client requests; auth via Cognito authorizer |
| Structured FHIR Data | AWS HealthLake | FHIR R4-compliant store for all structured clinical Observations |
| Raw Unstructured Files | Amazon S3 | Storage for photos, voice notes, videos, scans, PDFs |
| App Metadata & Config | Amazon RDS (PostgreSQL) | Users, persona links, thresholds, reminder configs, audit metadata |
| Async Processing Queue | Amazon SQS | Message queue triggered on S3 upload; enables future raw data processing pipelines |
| Identity & Auth | Amazon Cognito | All persona authentication (patient, attendant, relative, doctor) |
| Push Notifications | Amazon SNS / Firebase FCM | Push alerts to relative's device for threshold violations and reminder breaches |

### 7.3 Data Architecture

#### 7.3.1 Structured Data (FHIR)

- All clinical vitals stored as FHIR R4 Observation resources in AWS HealthLake.
- Each Observation references: Patient resource, author identity, LOINC code, value, timestamp.
- Unstructured file uploads produce a FHIR DocumentReference pointing to the S3 object key.
- Care plan entries stored as FHIR CarePlan resources.
- Doctor annotations stored as FHIR Annotation elements within Observations or CarePlan.

#### 7.3.2 Unstructured Data (S3)

- **S3 key format:** `{patient_id}/{year}/{month}/{day}/{timestamp}_{type}_{filename}`
- All objects encrypted at rest using SSE-KMS.
- Presigned URLs used for upload from mobile app — never expose S3 credentials.
- Upon successful upload, SQS message enqueued with: `patient_id`, `s3_key`, `file_type`, `uploader_persona`, `timestamp`.

#### 7.3.3 Offline Sync Strategy

- All data written to local Spezi FHIR store immediately on save.
- A sync queue tracks unsynced resources (FHIR Observations + S3 pending uploads).
- On WiFi connect event: sync queue is flushed in FIFO order.
- **Conflict resolution:** server-wins for FHIR Observations (last-write-wins with timestamp); for S3 objects, always upload if not yet present.

### 7.4 Identity & Access Control

| Persona | Access |
|---|---|
| Auth Provider | AWS Cognito — single user pool with groups per persona |
| Patient | Read/write own Observations; read-only own history |
| Attendant | Read/write Observations attributed to patient; own identity in audit log |
| Relative | Full read access to patient data; write access to thresholds, reminders, care team config |
| Doctor | Full read access via web portal; write access to care plan and clinical thresholds |
| Token Strategy | JWT access tokens (1hr) + refresh tokens; stored in secure device keystore |

---

## 8. Compliance & Security

### 8.1 HIPAA (United States)

- Business Associate Agreement (BAA) required with AWS.
- All PHI encrypted in transit (TLS 1.2+) and at rest (AES-256 / SSE-KMS).
- Audit logging: all access and modification events logged to AWS CloudTrail and stored in immutable S3.
- Access controls: minimum necessary access enforced via Cognito groups and IAM roles.
- Data retention and deletion policies to be defined per HIPAA requirements.
- Breach notification procedures to be documented in operational runbook.

### 8.2 India DPDP Act

- Explicit, informed consent collected from the patient (or relative on behalf) at onboarding.
- Consent records stored in RDS with timestamp and version of consent text shown.
- **Data localisation:** patient data for Indian users stored in `aws ap-south-1` (Mumbai) region.
- Data principal rights: patient/relative can request data export or deletion via in-app request flow.
- Purpose limitation: data collected only for health monitoring; no secondary use without re-consent.

### 8.3 General Security Requirements

- App requires device passcode/biometric to be enabled.
- Certificate pinning on all API calls from the mobile app.
- No PHI stored in device logs, analytics, or crash reports.
- Penetration testing required before v1 release.
- Vulnerability disclosure policy to be published.

---

## 9. Non-Functional Requirements

| Category | Requirement | Target |
|---|---|---|
| Performance | Vital log screen load time | < 1 second |
| Performance | Background sync initiation after WiFi connect | < 5 seconds |
| Performance | Voice acknowledgement playback latency | < 500ms after save |
| Reliability | Local storage availability (offline) | 100% — no dependency on network for logging |
| Reliability | API Gateway uptime | 99.9% SLA |
| Scalability | Concurrent patients per deployment | 10,000+ (v1 target) |
| Accessibility | WCAG compliance level | AA minimum; AAA for core patient screens |
| Platforms | Android version support | Android 9 (API 28)+ |
| Platforms | iOS version support | iOS 15+ |

---

## 10. Open Questions & Decisions Deferred

| Open Question | Notes |
|---|---|
| Bluetooth peripheral integration | Will the app integrate directly with BLE blood pressure cuffs, glucometers, or pulse oximeters via Spezi's peripheral modules? Scope TBD. |
| Raw file processing pipeline | Post-upload processing of scanned prescriptions and test results is out of scope for v1. SQS placeholder is in place. |
| LLM chat assistant implementation | Placeholder UI in v1. Model selection, RAG over patient FHIR data, and voice interaction deferred to v2. |
| Multi-language support | English only in v1. Localization for Hindi and regional languages to be scoped for v2. |
| Doctor threshold conflict UI | If a doctor overrides a relative's threshold, should the relative receive a notification? UX flow not yet defined. |
| Patient data export format | FHIR Bundle export vs. human-readable PDF summary for DPDP Act data portability compliance. |
| App store distribution | Internal enterprise distribution vs. public App Store / Play Store — affects MDM requirements. |

---

## 11. Suggested v1 Milestones

| Milestone | Name | Key Deliverables |
|---|---|---|
| M0 | Foundation | Spezi project setup (Android + iOS), AWS Cognito auth, local FHIR store, basic patient profile creation |
| M1 | Core Logging | All 6 vital logging screens, pre-recorded voice acknowledgements, offline local storage, FHIR Observation mapping |
| M2 | Sync & Upload | Background WiFi sync to HealthLake, S3 upload for unstructured files, SQS integration, sync status indicators |
| M3 | Relative App | Relative mobile app: dashboard, trends view, threshold configuration, reminder window config, push notifications |
| M4 | Attendant & Multi-persona | Attendant login flow on patient device, persona-attributed audit trail, attendant capability enforcement |
| M5 | Doctor Web Portal | Read-only data viewer, care plan editor, clinical threshold override, doctor onboarding via invite |
| M6 | Compliance & Hardening | HIPAA audit logging, DPDP consent flow, encryption audit, penetration testing, app store submission |

---

## 12. Implementation Plan

### 12.1 Team & Roles

| Role | Headcount | Primary Responsibilities |
|---|---|---|
| Mobile Engineer (Android) | 1 | SpeziKt integration, Android app screens, offline sync, BLE peripherals |
| Mobile Engineer (iOS) | 1 | Spezi iOS integration, iOS app screens, offline sync, BLE peripherals |
| Backend Engineer | 1 | AWS infrastructure, API Gateway, HealthLake, S3, SQS, Cognito, RDS |
| Frontend Engineer | 1 | Doctor web portal (React), dashboard charts, care plan editor |
| UX/Product Designer | 1 | Patient-facing UX (accessibility-first), relative app, design system |
| QA Engineer | 1 | Test plans, FHIR validation, compliance testing, regression suite |

---

### 12.2 Milestone Detail

#### M0 — Foundation (Weeks 1–3)

**Goal:** Establish the project skeleton, CI/CD, and auth layer. No user-facing features yet.

- Set up SpeziKt (Android) and Spezi iOS SDK project repos with modular structure.
- Configure AWS environment: Cognito user pool with groups (patient, attendant, relative, doctor), API Gateway, VPC.
- Implement all four Cognito user flows: patient creation by relative, attendant invite, relative self-registration, doctor invite.
- Set up AWS HealthLake FHIR R4 instance and validate FHIR Patient resource create/read.
- Configure RDS (PostgreSQL) schema: users, persona_links, thresholds, reminder_configs.
- Establish CI/CD pipelines (GitHub Actions or Bitrise) for Android, iOS, and backend.
- Define and document FHIR resource mapping for all 6 vitals.

> **Exit criteria:** A logged-in patient can be created by a relative; Cognito tokens are issued; FHIR Patient resource is created in HealthLake.

---

#### M1 — Core Logging (Weeks 4–7)

**Goal:** Patient can log all 6 vitals on their device with full offline support and voice acknowledgements.

- Build patient home/dashboard screen: large-button grid of 6 vitals + media upload + LLM placeholder.
- Implement all 6 vital logging screens (full-screen, single-action, accessibility-first UX).
- Integrate pre-recorded voice acknowledgement clips for all success/failure states.
- Implement local Spezi FHIR store: write Observation on save, read for history view.
- Build per-vital history list view with timestamp and recorded value.
- Implement sync queue data structure: tracks unsynced FHIR Observations locally.
- Unit tests: FHIR Observation mapping, voice clip triggering, local store read/write.

> **Exit criteria:** Patient logs a blood pressure reading offline; it is stored locally as a valid FHIR Observation; voice acknowledgement plays; history view shows the entry.

---

#### M2 — Sync & Unstructured Upload (Weeks 8–11)

**Goal:** Structured vitals sync to HealthLake over WiFi; unstructured files upload to S3.

- Implement WiFi connectivity listener: trigger sync queue flush on connect.
- Build FHIR sync service: POST/PUT Observations to HealthLake via API Gateway; handle conflicts (server-wins, timestamp comparison).
- Implement S3 presigned URL upload flow: request URL from API Gateway, upload file directly to S3 from device.
- Build SQS producer: enqueue message on successful S3 upload with metadata payload.
- Implement unstructured data capture screens: prescription scan, wound photo, voice note recorder, video note recorder.
- Generate FHIR DocumentReference for each S3 upload and sync to HealthLake.
- Add sync status indicator on dashboard (synced / pending / error).
- Integration tests: end-to-end vital log → sync → HealthLake query.

> **Exit criteria:** Vitals logged offline sync to HealthLake when WiFi connects; a wound photo uploads to S3 and a DocumentReference appears in HealthLake; SQS message is enqueued.

---

#### M3 — Relative App (Weeks 10–13)

**Goal:** Relative has a fully functional companion app on their own device. *(Overlaps M2 in backend.)*

- Build relative app: separate view mode detected from Cognito group on login.
- Implement dashboard: last-logged value per vital with timestamp, colour-coded status (within/outside threshold).
- Build trends view: time-series chart per vital with configurable date range (7d / 30d / 90d).
- Implement threshold configuration screen: per-vital min/max input; doctor overrides shown as read-only.
- Build reminder window configuration: per-vital time window input.
- Integrate push notifications (SNS/FCM): threshold breach alerts and reminder lapse alerts.
- Implement care team management: add/remove attendant, invite doctor.
- QA: push notification delivery testing across Android and iOS.

> **Exit criteria:** Relative receives a push notification within 60 seconds of a threshold-breaching vital being synced; trends chart renders correctly for 30-day range.

---

#### M4 — Attendant & Multi-Persona (Weeks 12–14)

**Goal:** Attendant can log on the patient's device under their own identity with full audit attribution.

- Implement *Switch to Attendant* flow on patient device: secondary login screen with attendant credentials.
- Build attendant home view (same UX as patient but with attendant identity context indicator).
- Ensure all FHIR Observations logged by attendant carry attendant's Cognito sub as performer reference.
- Implement attendant-specific observations/notes screen: free-text and voice note entry.
- Implement attendant threshold/reminder configuration screens (mirrors relative capability).
- Build audit log viewer for relative: chronological list of who logged what and when.
- Security test: verify attendant cannot access relative-only settings or escalate privileges.

> **Exit criteria:** Attendant logs a glucometer reading; the FHIR Observation's `performer` field contains the attendant's identity, not the patient's; relative can see the attribution in the audit log.

---

#### M5 — Doctor Web Portal (Weeks 13–17)

**Goal:** Doctor has a clinical-grade web portal to review, annotate, and manage care plans.

- Scaffold React web app with Cognito auth (doctor group only).
- Implement patient list view: search by name/ID, last activity timestamp, unread alert count.
- Build per-patient data viewer: tabbed view of vitals timeline, unstructured files list, care plan.
- Implement vital time-series charts with threshold overlay lines.
- Build care plan editor: rich text note entry stored as FHIR CarePlan resource.
- Implement clinical threshold override: per-vital min/max form saved to RDS with doctor identity; pushed to HealthLake as FHIR Goal resource.
- Implement annotation tool: add a note to any individual FHIR Observation.
- Build doctor onboarding acceptance flow: receive invite email, register, link to patient.
- QA: verify doctor threshold overrides are reflected on mobile apps within one sync cycle.

> **Exit criteria:** Doctor sets a systolic BP upper threshold of 140; relative's app shows the threshold as doctor-set and read-only; a value of 145 triggers a push notification to the relative.

---

#### M6 — Compliance, Hardening & Launch (Weeks 16–20)

**Goal:** The app meets HIPAA and DPDP Act requirements and is ready for production deployment.

- Implement DPDP consent flow at onboarding: versioned consent text, explicit accept, stored consent record in RDS.
- Implement data export flow: generate FHIR Bundle export for patient on request.
- Implement account deletion flow: cascade delete from RDS, HealthLake, and S3 (with HIPAA-compliant retention overrides).
- Enable AWS CloudTrail for all API Gateway and HealthLake access events.
- Enable S3 SSE-KMS encryption and HealthLake encryption at rest.
- Implement certificate pinning on mobile API clients.
- Remove all PHI from device logs and crash reporting.
- Conduct internal security review and remediate findings.
- Engage external penetration testing firm; remediate critical/high findings.
- Execute BAA with AWS.
- App store submission (Google Play + Apple App Store) and review cycle.

> **Exit criteria:** Penetration test report with no critical/high open findings; DPDP consent record created at onboarding; HIPAA audit log query returns all PHI access events; app approved on both stores.

---

### 12.3 Indicative Timeline

```
Milestone                   │ Wk 1-3 │ Wk 4-7 │ Wk 8-11 │ Wk 12-15 │ Wk 16-20
────────────────────────────┼────────┼────────┼─────────┼──────────┼──────────
M0  Foundation              │ ████   │        │         │          │
M1  Core Logging            │        │ ████   │         │          │
M2  Sync & Upload           │        │        │ ████    │          │
M3  Relative App            │        │   ██   │ ██      │          │
M4  Attendant               │        │        │    ██   │ ██       │
M5  Doctor Portal           │        │        │    ██   │ ████     │
M6  Compliance & Launch     │        │        │         │    ██    │ ████
```

> M2 and M3 overlap intentionally — backend sync infrastructure (M2) is built in parallel with the relative app frontend (M3). M4 and M5 similarly overlap with the tail of M2/M3.

---

### 12.4 Key Dependencies & Risks

| Risk / Dependency | Severity | Mitigation |
|---|---|---|
| AWS HealthLake provisioning time | 🟡 Medium | Request HealthLake instance in Week 1; provisioning can take several days. Use a HAPI FHIR server locally as a fallback during M0–M1. |
| SpeziKt maturity on Android | 🟡 Medium | SpeziKt is less mature than Spezi iOS. Audit available modules in M0; build thin wrappers for missing functionality. |
| Pre-recorded voice clip production | 🟢 Low | Clips must be recorded before M1 ends. Engage voice talent in M0 in parallel with engineering setup. |
| App Store review for medical apps | 🔴 High | Apple and Google have elevated scrutiny for health apps. Engage App Store review guidelines in M0; budget 2–4 weeks for review in M6. |
| HIPAA BAA with AWS | 🔴 High | BAA must be executed before any real PHI is stored. Initiate legal/procurement process in M0. Use synthetic test data until BAA is signed. |
| Penetration testing lead time | 🟡 Medium | External pen test firms have 4–6 week booking lead times. Engage firm no later than end of M4 for M6 slot. |
| DPDP Act data localisation | 🟡 Medium | Indian users' data must reside in AWS `ap-south-1`. Region-aware routing must be designed in M0 and validated in M6. |

---

## 13. Appendix

### 13.1 Key References

- [Stanford SpeziKt (Android)](https://github.com/StanfordSpezi/SpeziKt)
- [Stanford Spezi (iOS)](https://github.com/StanfordSpezi/)
- [HL7 FHIR R4 Specification](https://hl7.org/fhir/R4/)
- [AWS HealthLake](https://aws.amazon.com/healthlake/)
- [LOINC Code System](https://loinc.org/)
- HIPAA Security Rule: 45 CFR Part 164
- [India DPDP Act 2023](https://www.meity.gov.in/)

### 13.2 Glossary

| Term | Definition |
|---|---|
| FHIR | Fast Healthcare Interoperability Resources — HL7 standard for health data exchange |
| Spezi | Stanford open-source digital health framework with native FHIR support |
| HealthLake | AWS managed FHIR R4-compliant data store |
| LOINC | Logical Observation Identifiers Names and Codes — standard vocabulary for clinical observations |
| PHI | Protected Health Information — any individually identifiable health information |
| DPDP | Digital Personal Data Protection Act 2023 (India) |
| SQS | Amazon Simple Queue Service — managed message queuing service |
| Cognito | AWS identity and access management service for web and mobile apps |
| WCAG | Web Content Accessibility Guidelines |
| BAA | Business Associate Agreement — required HIPAA contract with cloud providers handling PHI |
| BLE | Bluetooth Low Energy — used for peripheral device integration |
| RAG | Retrieval-Augmented Generation — LLM pattern for querying over patient FHIR data |

---

*CareLog PRD v0.1 — DRAFT — March 2026 — CONFIDENTIAL*

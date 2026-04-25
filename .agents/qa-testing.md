# Agent: QA & Testing

## Role

You are the **QA & Testing** agent. You own test automation, end-to-end test scenarios, multilingual validation, latency benchmarking, and compliance verification. You ensure the system works correctly across all three personas, all three languages, and all deployment boundaries.

## Owned Directories

```
test-automation/
├── e2e/
│   ├── scenarios/
│   │   ├── e2e-01-full-patient-logging.test.ts
│   │   ├── e2e-02-photo-device-reading.test.ts
│   │   ├── e2e-03-threshold-breach-alert.test.ts
│   │   ├── e2e-04-missed-measurement-alert.test.ts
│   │   ├── e2e-05-caregiver-onboarding.test.ts
│   │   ├── e2e-06-pause-timeout.test.ts
│   │   ├── e2e-07-doctor-protocol-update.test.ts
│   │   ├── e2e-08-stt-failure-fallback.test.ts
│   │   ├── e2e-09-emergency-detection.test.ts
│   │   └── e2e-10-mac-mini-offline.test.ts
│   └── helpers/
│       ├── api-client.ts              # Cloud API test client
│       ├── mac-mini-client.ts         # Mac Mini API test client
│       └── test-data.ts              # Fixtures and test patients
│
├── integration/
│   ├── conversation-fhir-pipeline.test.ts
│   ├── threshold-evaluation.test.ts
│   ├── session-config-fetch.test.ts
│   ├── interaction-storage.test.ts
│   ├── reminder-pipeline.test.ts
│   ├── missed-measurement.test.ts
│   └── doctor-protocol-update.test.ts
│
├── multilingual/
│   ├── stt-accuracy/
│   │   ├── english.test.ts
│   │   ├── hindi.test.ts
│   │   └── bengali.test.ts
│   ├── llm-extraction/
│   │   ├── value-extraction.test.ts
│   │   └── code-mixing.test.ts
│   ├── tts-quality/
│   │   └── pronunciation.test.ts
│   └── test-audio/                    # Sample audio files per language
│       ├── en/
│       ├── hi/
│       └── bn/
│
├── performance/
│   ├── latency-benchmark.ts           # Pipeline timing (t0-t7)
│   ├── latency-report.ts             # Generate P50/P95/P99 report
│   └── results/                       # Benchmark output
│
├── compliance/
│   ├── dpdp-checklist.md
│   ├── hipaa-checklist.md
│   ├── data-localisation-verify.ts    # Verify all data in ap-south-1
│   ├── phi-log-scan.ts               # Scan for PHI in logs
│   └── mac-mini-cleanup-verify.ts    # Verify ephemeral data deletion
│
├── results/                           # Test output (gitignored)
│   ├── journey-results/
│   └── screenshots/
│
├── package.json
└── tsconfig.json
```

You do NOT modify production code in: `mac-mini/`, `android/`, `backend/lambdas/`, `web-portal/src/`. You may read them for test design.

## Specifications

Refer to `docs/carelog_spec.md`:
- Section 12 — Testing Strategy (your blueprint)
  - 12.1 Unit Tests (verify each agent has written theirs)
  - 12.2 Integration Tests (7 integration test scenarios)
  - 12.3 End-to-End Test Scenarios (10 E2E scenarios with steps and expected outcomes)
  - 12.4 Multilingual Test Matrix (3 languages x 9 test cases)
  - 12.5 Latency Benchmarking Methodology (t0-t7 pipeline timing, P50/P95/P99)

## Phase Assignments

### P4 — Integration & Polish (Weeks 16-18)

Epic 4.1: End-to-End Flows
- **4.1.1** Implement and run E2E test scenarios 1-10 (see table below)

Epic 4.3: Multilingual Validation
- **4.3.1** Hindi end-to-end validation (full test matrix)
- **4.3.2** Bengali end-to-end validation (full test matrix)
- **4.3.3** Code-mixing validation (English medical terms in Hindi/Bengali)

Epic 4.4: Performance Optimization
- **4.4.1** Run latency benchmarking protocol (100 turns, 3 languages, compute P50/P95/P99)

### P5 — Compliance & Pilot (Weeks 19-22)

Epic 5.1: Compliance Verification
- **5.1.4** Verify data localisation (all S3/RDS in ap-south-1)
- **5.1.5** Verify HIPAA audit logging (CloudTrail + audit_log coverage)
- PHI log scan (no PHI in Logcat, CloudWatch, Crashlytics)
- Mac Mini cleanup verification (no persistent patient data)

Epic 5.2: Security Testing
- **5.2.1** Certificate pinning verification (test with MITM proxy)
- **5.2.3** Mac Mini security review (LAN-only, no persistent data, cleanup audit)

## E2E Test Scenarios

| # | Scenario | Steps | Expected Outcome |
|---|---|---|---|
| E2E-1 | Full patient logging session | Caregiver configures BP + glucose → Patient conversation → Speaks BP → Confirms → Speaks glucose → Confirms → Session ends | 2 FHIR Observations in S3; interaction logged; session complete |
| E2E-2 | Photo-based device reading | Patient starts → Mentions BP without value → Takes photo → Vision extracts → Confirms | FHIR Observation with vision-extracted value |
| E2E-3 | Threshold breach alert | Patient logs BP 165/100 (threshold 140/90) → FHIR batch → threshold eval | Caregiver push notification within 60s |
| E2E-4 | Missed measurement alert | Patient doesn't log weight for 4 days (configured: every 3) | Caregiver receives missed measurement notification |
| E2E-5 | Caregiver onboarding | Register → Onboard patient via conversation → Configure protocol → Send invite | Patient account created; configs stored; invite sent |
| E2E-6 | Pause timeout | Patient starts → Pauses → 5 min wait | Session auto-ends; Mac Mini cleaned up; incomplete session logged |
| E2E-7 | Doctor protocol update | Doctor adds threshold via portal → Patient logs next day | Session uses doctor's thresholds |
| E2E-8 | STT failure fallback | Speak → STT garbage → Repeat x2 → Text input | Text input shown; session continues |
| E2E-9 | Emergency detection | Patient says "chest pain" in Hindi | Emergency advice; session ends; caregiver alerted |
| E2E-10 | Mac Mini offline | Power off Mac Mini → Open app | Health check fails; conversation button disabled |

## Multilingual Test Matrix

| Test Case | English | Hindi | Bengali |
|---|---|---|---|
| STT: Simple vital report | | | |
| STT: Code-mixed speech | N/A | | |
| STT: Elderly accent/unclear | | | |
| LLM: Value extraction | | | |
| LLM: Response in correct language | | | |
| LLM: Empathetic tone | | | |
| TTS: Natural-sounding output | | | |
| TTS: Medical term pronunciation | | | |
| Full session end-to-end | | | |

## Latency Benchmarking

Instrument the Android app to capture timestamps at each pipeline stage:
```
t0 = user finishes speaking (VAD silence detected)
t1 = STT request sent
t2 = STT response received
t3 = LLM request sent
t4 = LLM response received
t5 = TTS request sent
t6 = TTS first audio byte received
t7 = audio playback begins

Total latency = t7 - t0
```

Protocol:
1. 100 turns with varied utterance lengths (3-15 seconds)
2. Test in all 3 languages
3. Compute P50, P95, P99 for total and per-component
4. Target: P95 total < 2000ms
5. If over target: identify bottleneck component

## Dependencies

| What I need | From whom | When |
|---|---|---|
| All services deployed and running | all agents | P4 start |
| Android app with pipeline instrumentation (t0-t7) | android-app | P4 |
| Mac Mini with all models loaded | mac-mini-services + devops | P4 |
| Sample audio files (3 languages, varied accents) | manually curated | P4 start |
| CloudTrail and CloudWatch access | devops | P5 |

| What I provide | To whom | When |
|---|---|---|
| E2E test results and bug reports | all agents | P4 |
| Latency benchmark report | mac-mini-services (for optimization) | P4 |
| Compliance verification report | orchestrator | P5 |
| Multilingual accuracy report | mac-mini-services | P4 |

## Constraints

- Test framework: TypeScript-based (Jest or Vitest for E2E/integration)
- Android unit tests owned by android-app agent; you verify they exist
- Lambda unit tests owned by backend agent; you verify they exist
- Mac Mini unit tests owned by mac-mini-services agent; you verify they exist
- Web portal unit tests owned by web-portal agent; you verify they exist

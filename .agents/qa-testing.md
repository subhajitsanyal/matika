# Agent: QA & Testing

## Role

You are the **QA & Testing** agent. You own test automation, end-to-end test scenarios, multilingual validation, latency benchmarking, cost telemetry baselining, and compliance verification. You ensure Matika works correctly across three personas, three languages, two model tiers, and the cross-region inference data flow.

## Owned Directories

```
test-automation/
├── e2e/
│   ├── scenarios/
│   │   ├── e2e-01-full-patient-logging.test.ts
│   │   ├── e2e-02-photo-mlkit-success.test.ts             # NEW — on-device OCR clean case
│   │   ├── e2e-02b-photo-bedrock-fallback.test.ts         # NEW — ML Kit miss → Haiku → Sonnet
│   │   ├── e2e-03-threshold-breach-alert.test.ts
│   │   ├── e2e-04-missed-measurement-alert.test.ts
│   │   ├── e2e-05-caregiver-onboarding.test.ts
│   │   ├── e2e-06-pause-timeout.test.ts
│   │   ├── e2e-07-doctor-protocol-update.test.ts
│   │   ├── e2e-08-stt-failure-fallback.test.ts
│   │   ├── e2e-09-emergency-detection.test.ts             # On-device matcher + Guardrails second line
│   │   └── e2e-10-cloud-connectivity-loss.test.ts         # REPLACES v1 mac-mini-offline
│   └── helpers/
│       ├── api-client.ts
│       ├── sse-client.ts                                   # NEW — SSE consumer for streamed turns
│       └── test-data.ts
│
├── integration/
│   ├── conversation-fhir-pipeline.test.ts
│   ├── threshold-evaluation.test.ts
│   ├── interaction-storage.test.ts
│   ├── reminder-pipeline.test.ts
│   ├── missed-measurement.test.ts
│   ├── doctor-protocol-update.test.ts
│   ├── bedrock-prompt-cache.test.ts                       # NEW — verify cache hit rate > 80%
│   ├── bedrock-escalation-signals.test.ts                 # NEW — every signal routes correctly
│   ├── bedrock-guardrail-blocks.test.ts                   # NEW — denied topics + custom triggers
│   └── cross-region-data-flow.test.ts                     # NEW — verify PHI persistence stays in ap-south-1
│
├── multilingual/
│   ├── stt-accuracy/
│   │   ├── english.test.ts                                 # Now tests Android SpeechRecognizer (recorded audio replay)
│   │   ├── hindi.test.ts
│   │   └── bengali.test.ts                                 # P0 metric: correction rate < 10%
│   ├── llm-extraction/
│   │   ├── value-extraction.test.ts
│   │   └── code-mixing.test.ts
│   ├── tts-quality/
│   │   └── pronunciation.test.ts                           # Android TextToSpeech naturalness rubric
│   └── test-audio/
│       ├── en/, hi/, bn/
│
├── performance/
│   ├── latency-benchmark.ts                                # NEW pipeline timing model — see below
│   ├── latency-report.ts
│   └── results/
│
├── cost/
│   ├── cost-baseline.ts                                    # NEW — daily cost-per-patient telemetry baseline
│   ├── cost-report.ts                                      # NEW — generates report for week-4 cap-setting
│   └── results/
│
├── compliance/
│   ├── dpdp-checklist.md                                   # UPDATED — v2.0 cross-region disclosure
│   ├── hipaa-checklist.md                                  # UPDATED — Bedrock + Guardrails as audit controls
│   ├── data-localisation-verify.ts                         # UPDATED — verify storage in ap-south-1; inference may be cross-region
│   ├── consent-v2-acceptance-verify.ts                     # NEW — verify all pilot users on consent v2.0
│   ├── phi-log-scan.ts                                     # Scan Logcat, CloudWatch, Crashlytics
│   ├── bedrock-cloudtrail-audit.ts                         # NEW — every Bedrock invocation has CloudTrail evidence
│   └── per-patient-call-log-verify.ts                      # NEW — model_call table coverage
│
├── results/                            # Gitignored
└── package.json
```

You do NOT modify production code in: `android/`, `backend/lambdas/`, `web-portal/src/`, `infrastructure/terraform/`, `inference-platform/prompts/`. You may read them for test design.

## Specifications

Refer to `docs/matika_spec_v2.md`:
- Section 12 — Testing Strategy (your blueprint)
- Section 7.4 — Latency Budget Breakdown (the SLO targets you measure against)
- Section 11.3 — Cross-Region Inference Data Flow (compliance audit basis)
- Section 14.4 — Observability (telemetry tables you query)

Refer to `docs/matika_prd_v2.md` §3 for SLO targets you verify pilot meets.

## Phase Assignments

### P1 — Conversational Core (Weeks 3–6)
- Curate multilingual test audio (10 utterances × 5 parameters × 3 noise conditions × 3 languages = 450 clips). Coordinate with `inference-platform` for golden transcripts.
- Implement STT-accuracy tests against recorded-audio replay → Android `SpeechRecognizer`. Track per-language correction rate.

### P2 — Vision + Escalation (Weeks 7–8)
- Implement E2E-02 (clean OCR) and E2E-02b (cloud fallback chain).
- Implement E2E-09 (emergency detection) — verify on-device matcher fires < 200ms; verify Guardrail second-line fires when keyword matcher misses.

### P4 — Integration & Polish (Weeks 12–14)
- **[T-V2-400]** All PRD §6 acceptance criteria end-to-end in en, hi, bn.
- **[T-V2-401]** All caregiver journeys (CG-01..CG-19; CG-20 dropped — Mac Mini gone) and patient journeys (PT-01..PT-25, PT-27; PT-26 dropped).
- **[T-V2-410..414]** Edge case scenarios.
- Run latency benchmark protocol — see "Latency Benchmarking" below.
- Run cost-baseline harness in shadow against staging traffic — feeds `cost/cost-baseline.ts` results.
- Verify SLO compliance per PRD §3.

### P5 — Compliance & Pilot (Weeks 15–16)
- **[T-V2-502]** Compliance verification:
  - Data localisation: storage in ap-south-1 verified; inference cross-region documented; CloudTrail evidence collated.
  - HIPAA: Bedrock + Guardrails as audit controls documented; `model_call` per-patient log coverage verified.
  - DPDP consent v2.0: all pilot users on consent v2.0 verified.
  - PHI log scan across Logcat, CloudWatch logs, Crashlytics, Sentry (if used).
- **[T-V2-511]** During pilot: daily cost review, weekly latency P95 review, bi-weekly transcript audit (sampled, with re-consent for audit purpose).
- **[T-V2-515]** Week 4 of pilot: produce cost-cap recommendation based on `cost/results/`.

## E2E Test Scenarios (v2)

| # | Scenario | Replaces v1 | Verification |
|---|---|---|---|
| E2E-1 | Full patient logging session | Same | 2 FHIR Observations in S3; interaction logged; session complete; Bedrock telemetry rows present |
| E2E-2 | Photo via ML Kit on-device | E2E-2 | OCR succeeds in < 300ms; no Bedrock vision call; FHIR Observation with `source: "mlkit"` |
| E2E-2b | Photo glare → Haiku → Sonnet fallback | NEW | ML Kit returns low confidence; Haiku called; if confidence < 0.80, Sonnet called; final FHIR Observation logged |
| E2E-3 | Threshold breach alert | Same | Caregiver FCM within 60s |
| E2E-4 | Missed measurement alert | Same | Caregiver FCM |
| E2E-5 | Caregiver onboarding | Same; defaults to Sonnet now | Patient created; protocol stored; invite sent |
| E2E-6 | Pause timeout | Same | Auto-end at 30 min; incomplete session logged |
| E2E-7 | Doctor protocol update | Same | Next session uses doctor's thresholds |
| E2E-8 | STT failure fallback | Same | Text input shown after 2 failures |
| E2E-9 | Emergency detection | Same flow | On-device matcher fires < 200ms; emergency UI shown; caregiver alerted within 60s; Guardrail second-line evidence in `model_call` |
| E2E-10 | Cloud connectivity loss mid-session | REPLACES v1 mac-mini-offline | "Reconnecting…" shown < 3s; session resumes from last confirmed turn on reconnection |

## Multilingual Test Matrix

Same shape as v1, with notes:

| Test Case | English | Hindi | Bengali |
|---|---|---|---|
| STT: Simple vital report | | | **Track correction rate; if > 10%, flag for Bhashini fallback in v2.1** |
| STT: Code-mixed speech | N/A | | |
| STT: Elderly accent / unclear | | | |
| LLM: Value extraction | | | |
| LLM: Response in correct language | | | |
| LLM: Empathetic tone | | | |
| LLM: Code-switching density routing → Sonnet | | | |
| TTS: Natural-sounding output | | | |
| TTS: Medical term pronunciation | | | |
| Full session end-to-end | | | |

## Latency Benchmarking (v2 model)

The v1 t0..t7 model had Mac Mini boundaries. v2 has new stages — instrument the Android app and Lambda:

```
t0  = STT final transcript ready (on-device)
t1  = POST /conversation/turn(-stream) sent
t2  = Lambda invocation begins (warm or cold)
t3  = Bedrock invocation begins (after prompt build + Guardrails input)
t4  = Bedrock first token received (TTFT) — for streamed turns, the key metric
t5  = Bedrock generation complete
t6  = Lambda response sent (or final SSE event)
t7  = App receives last byte / first sentence event
t8  = TTS first audio byte
t9  = TTS audio playback begins

Key derived metrics:
  - Time-to-first-audio (streamed) = t8 - t0
  - Total turn (sync) = t9 - t0
  - Bedrock TTFT = t4 - t3
  - Lambda overhead = (t3 - t2) + (t6 - t5)
  - Network RTT = (t1 - t0) before the turn + (t7 - t6) after
```

Protocol:
1. 100 turns per scenario (T2 short, T2 long streamed, T3 streamed, vision fallback) × 3 languages.
2. Compute P50 / P95 / P99 per stage and end-to-end.
3. SLO targets per PRD §3:
   - Time-to-first-audio (streamed) P95 < 1.5s
   - Total turn (T2 short) P95 < 2s
   - Total turn (T3 / long) P95 < 3s
4. If over target: identify dominant stage, escalate to relevant agent (Bedrock TTFT → `inference-platform`; Lambda overhead → `backend`/`devops`; on-device → `android-app`).

## Cost Baseline Harness (v2 new)

`cost/cost-baseline.ts` queries `model_call` and `cost_telemetry` and produces a daily report:

- Per-patient cost
- Cost broken down by tier (T2 / T3 / T2_VISION / T3_VISION)
- Escalation rate
- Cached vs. non-cached input token ratio
- Vision cloud-fallback rate (vs. ML Kit success rate)

Run daily during pilot. Week 4 deliverable: cap recommendation for `SOFT_RATE_LIMIT_PER_PATIENT` and `HARD_RATE_LIMIT_PER_PATIENT` env vars in `bedrock-router`.

## Compliance Verification (v2 changes)

| Check | v1 | v2 |
|---|---|---|
| Data localisation | All data in ap-south-1 | **Storage** in ap-south-1; **inference** cross-region documented; CloudTrail evidence required |
| Mac Mini cleanup | Verify `/tmp/carelog/` deletion | **Removed** — no Mac Mini |
| Consent | DPDP v1 acceptance | DPDP v2.0 with cross-region disclosure; verify all pilot users re-consented |
| Audit trail | Lambda + CloudTrail | + `model_call` table per-patient PHI-touch log |
| Guardrail evidence | N/A | Verify `guardrail_blocked` flagged in `model_call`; spot-check Guardrail block samples |
| Emergency detection | Mac Mini LLM | + on-device matcher + Bedrock Guardrails second line; both must produce evidence |

## Dependencies

| What I need | From whom | When |
|---|---|---|
| All services deployed | all agents | P4 start |
| Pipeline timing instrumentation in Android | android-app | P4 |
| `model_call` and `cost_telemetry` tables populated | backend | P1+ |
| Multilingual test audio | (curated by you) | P1 start |
| Sample emergency utterances (en, hi, bn) | inference-platform (golden cases) | P2 |

| What I provide | To whom | When |
|---|---|---|
| E2E test results + bug reports | all agents | P4 |
| Latency benchmark report | inference-platform, backend, devops | P4 |
| Cost baseline + cap recommendation | (PRD owner; sets env vars in bedrock-router) | P5 week 4 |
| Compliance verification report | (orchestrator / legal) | P5 |
| Multilingual accuracy report | inference-platform (drives tuning) | P4 |
| Bengali correction-rate metric | (drives v2.1 Bhashini decision) | P4+ |

## Constraints

- TypeScript-based test framework (Jest or Vitest).
- Android unit tests owned by `android-app`; you verify they exist and pass.
- Lambda unit tests owned by `backend`; you verify.
- Prompt evals owned by `inference-platform`; you verify they run on every prompt change.
- Web portal unit tests owned by `web-portal`; you verify.
- Test data: only synthetic patient data in non-prod environments. No real PHI in tests.
- All test artifacts (results, screenshots) gitignored.

# Matika — Implementation Plan v2.0

**Version:** 2.0
**Date:** May 2026
**Source PRD:** `docs/matika_prd_v2.md` v2.0
**Source Spec:** `docs/matika_spec_v2.md` v2.0

---

> ## ⚠️ Status as of 2026-05-03 — Phase 0 + Phase 1 backend mostly done
>
> The unticked checkboxes below are out of date. Many Phase 0 and
> Phase 1 items have been completed since this doc was authored.
> Authoritative sources for current status:
>
> - `git log --oneline -- backend/lambdas/bedrock-router backend/lambdas/bedrock-vision infrastructure/terraform/`
> - `docs/v2_status_pre_pilot.md` — see the 2026-05-03 update at the end
> - `docs/v2_remaining_todos.md` — currently scoped to the deferred
>   prod Terraform apply
>
> **Done since this plan was written** (commits in parentheses):
> T-V2-002 Bedrock model access · T-V2-005 quota increase to 1000 ·
> T-V2-022 health-check (`4847a34`) · T-V2-023 v2 DevOps + IAM
> (`6e81f89` and several others) · T-V2-046 PG runtime fetch (`5a2984e`) ·
> T-V2-100..108, 110, 111, 210, 211 (bedrock-router + vision deployed
> end-to-end) · T-V2-302 caregiver protocol persistence (`91e00ca`) ·
> T-V2-303 caregiver attribution (`1d7dd46`) · T-V2-304 FHIR
> Observation bridge (`7c19c37`) · V005 migration applied to dev RDS.
>
> Items still unticked **and still genuinely open**: the entire
> Increment 6 (Android v2 client), T-V2-001 AWS BAA cross-region
> scope (legal), DPDP review of `global.*` profiles (legal), and the
> prod Terraform apply (scaffolded in `906260e`, deferred until limited
> trials on dev surface signals worth incorporating).
>
> The checkboxes below are now best read as a reading exercise, not a
> worklist.

---

## Overview

This plan reorganizes the v1 22-week timeline around the v2 architecture: cloud-only inference (AWS Bedrock), on-device STT/TTS/OCR, and removal of the Mac Mini stack. Total estimated duration: **16 weeks**, a 6-week saving from v1 (Mac Mini setup, model serving infrastructure, household deployment work all eliminated).

**Legend:**
- `[T-XXX]` — task ID
- `Depends on:` — prerequisite tasks
- `[ ]` — checklist item

---

## Phase 0: Foundation (Weeks 1–2)

### 0.1 AWS Bedrock Foundation

- [ ] **[T-V2-001]** Confirm AWS BAA covers Bedrock cross-region inference
  - **Depends on:** None
  - **Context:** Verify with AWS account team that the existing BAA covers Bedrock inference profiles spanning ap-south-1 + ap-southeast-1 + us-east-1. If not, escalate to AWS healthcare team.

- [ ] **[T-V2-002]** Submit Bedrock model access request for Claude Haiku 4.5 + Sonnet 4.x
  - **Depends on:** None
  - **Context:** Bedrock model access in cross-region profiles requires explicit per-account enablement. Submit through Bedrock console; typically approved in 1–2 business days. Block all downstream work until approved.

- [ ] **[T-V2-003]** Create Bedrock inference profiles (Haiku + Sonnet)
  - **Depends on:** T-V2-002
  - **Context:** Use Bedrock console or Terraform `aws_bedrock_inference_profile` to create cross-region profiles. Validate with a smoke test (`InvokeModel` with 1-token prompt).

- [ ] **[T-V2-004]** Configure Bedrock Guardrails
  - **Depends on:** T-V2-002
  - **Context:** Create one guardrail per `docs/matika_spec_v2.md` §11.5. Test denied-topic rejections and PII redaction. Iterate config to minimize false positives on health language.

- [ ] **[T-V2-005]** Submit Bedrock quota increase requests
  - **Depends on:** T-V2-003
  - **Context:** Default Bedrock quotas are typically sufficient for 10-patient pilot but request increase early (1–3 day SLA) to avoid blocking later phases. Target: 50 RPM Haiku, 10 RPM Sonnet on each inference profile.

### 0.2 Repository Cleanup

- [ ] **[T-V2-010]** Delete `mac-mini/` directory
  - **Depends on:** None
  - **Context:** Entire directory including `services/`, `deploy/`, `tests/`, `scripts/`, `pyproject.toml`, `requirements.txt`. Open PR with deletion clearly described. Tag the v1 commit before deleting.

- [ ] **[T-V2-011]** Remove Mac Mini references from Android app
  - **Depends on:** None
  - **Context:** Delete `com.carelog.macmini.*` package, mDNS discovery code, LAN HTTP client, model health endpoint polling. Verify build still compiles; update DI graph.

- [ ] **[T-V2-012]** Update `docs/setup-and-deployment-guide.md`
  - **Depends on:** T-V2-010
  - **Context:** Remove Mac Mini setup sections; add Bedrock setup, Cognito test user creation, smoke-test instructions.

- [ ] **[T-V2-013]** Rebrand CareLog → Matika across docs
  - **Depends on:** None
  - **Context:** Search-and-replace in `README.md`, all `docs/*.md`, web portal title, Android app strings (do not rename packages yet — defer to a v2.1 chore to avoid touching every file).

### 0.3 Lambda Skeleton

- [ ] **[T-V2-020]** Create `bedrock-router` Lambda skeleton
  - **Depends on:** T-V2-003
  - **Context:** Node.js 20, Lambda Layer for `@aws-sdk/client-bedrock-runtime`. Wire up API Gateway route `POST /conversation/turn`. Returns canned response for now.

- [ ] **[T-V2-021]** Create `bedrock-vision` Lambda skeleton
  - **Depends on:** T-V2-003
  - **Context:** Same as router but for vision. Wire route `POST /conversation/photo-extract`.

- [ ] **[T-V2-022]** Create `health-check` Lambda
  - **Depends on:** T-V2-003
  - **Context:** Implements RDS ping + S3 list + Bedrock 1-token ping per spec §7.6. Wire route `GET /health`.

- [ ] **[T-V2-023]** Configure provisioned concurrency on `bedrock-router`
  - **Depends on:** T-V2-020
  - **Context:** PC = 1 for pilot. Document scaling plan in spec §7.5.

**Exit criteria:** Bedrock access approved; Mac Mini fully deleted from repo; new Lambda routes return canned responses authenticated via Cognito; `GET /health` returns true health.

---

## Phase 1: Conversational Core (Weeks 3–6)

### 1.1 Bedrock Router — Real Inference

- [ ] **[T-V2-100]** Implement system prompt v2.0
  - **Depends on:** T-V2-020
  - **Context:** Port v1's `mac-mini/services/llm_service.py` system prompt into `lambdas/bedrock-router/prompts/system_v2.md`. Keep ~3K tokens, structured for prompt caching. Reference: `docs/matika_spec_v2.md` §6.3.

- [ ] **[T-V2-101]** Implement per-patient context builder
  - **Depends on:** T-V2-100
  - **Context:** Function loads patient profile + protocol + topics + last 3 sessions from RDS; renders ~1K-token cached context block.

- [ ] **[T-V2-102]** Implement per-turn context builder
  - **Depends on:** T-V2-101
  - **Context:** Sliding window of last 6 turns + current transcript. Implements summarization of overflow turns via Haiku call.

- [ ] **[T-V2-103]** Implement Bedrock invocation with prompt caching
  - **Depends on:** T-V2-102
  - **Context:** Use cache breakpoints to mark system + per-patient cached segments. Verify cache hits via response metadata.

- [ ] **[T-V2-104]** Implement structured output parser
  - **Depends on:** T-V2-103
  - **Context:** Parses `<output>` JSON; validates against schema; one retry on parse failure with stricter prompt; surfaces 503 on second failure.

- [ ] **[T-V2-105]** Implement state machine in router
  - **Depends on:** T-V2-104
  - **Context:** Reads `interaction_session` state at start, applies LLM-returned `stateTransition`, writes back. Per spec §6.2.

- [ ] **[T-V2-106]** Implement escalation signal detection
  - **Depends on:** T-V2-105
  - **Context:** Per-turn signals (implausible, emergency keyword, code-switch density, low-confidence retry, etc.) → choose Haiku or Sonnet. Per spec §6.5.

- [ ] **[T-V2-107]** Implement model_call telemetry recording
  - **Depends on:** T-V2-103
  - **Context:** After each Bedrock call, insert into `model_call` table with tokens, latency, cost calc.

- [ ] **[T-V2-108]** Migrate cost_telemetry rollup
  - **Depends on:** T-V2-107
  - **Context:** Daily Lambda or DB trigger that rolls `model_call` into `cost_telemetry`. EventBridge cron, not real-time (cheaper).

### 1.2 Streaming Turn

- [ ] **[T-V2-110]** Implement `POST /conversation/turn-stream`
  - **Depends on:** T-V2-103
  - **Context:** Uses `InvokeModelWithResponseStream`; emits SSE chunks per spec §4.1. Test with `curl -N` against staging.

- [ ] **[T-V2-111]** Implement streaming decision logic
  - **Depends on:** T-V2-110
  - **Context:** Per spec §6.6.

### 1.3 Android Audio I/O

- [ ] **[T-V2-120]** Implement `SttManager` (`SpeechRecognizer` wrapper)
  - **Depends on:** None
  - **Context:** Per spec §8.3. `EXTRA_PREFER_OFFLINE = true`. Hindi/Bengali/English locales. Telemetry tag for online vs offline.

- [ ] **[T-V2-121]** Implement language-pack onboarding flow
  - **Depends on:** T-V2-120
  - **Context:** On first launch, prompt user to download offline packs for selected language(s). Handle download failure gracefully (fall back to online STT with warning).

- [ ] **[T-V2-122]** Implement `TtsManager` (`TextToSpeech` wrapper)
  - **Depends on:** None
  - **Context:** `QUEUE_ADD` for sentence-buffered streaming. Number formatter (LLM provides `ttsHints.spellOutNumbers` — if true, app pre-formats "130/85" → "one thirty over eighty five").

- [ ] **[T-V2-123]** Implement `SentenceQueue` for streaming TTS
  - **Depends on:** T-V2-122
  - **Context:** Consumes `sentence` SSE events; queues each to TTS as it arrives. Handles barge-in (user starts talking → flush queue).

### 1.4 Android Inference Client

- [ ] **[T-V2-130]** Implement `BedrockClient` with sync + SSE
  - **Depends on:** T-V2-103, T-V2-110
  - **Context:** Retrofit2 for sync `/turn`; custom SSE consumer for `/turn-stream`. Reconnect-once-on-failure with idempotency key.

- [ ] **[T-V2-131]** Implement `ConversationViewModel` and state
  - **Depends on:** T-V2-130
  - **Context:** Per spec §8.5. Single source of truth for session state; UI subscribes to flows.

- [ ] **[T-V2-132]** Implement conversation UI screen
  - **Depends on:** T-V2-131
  - **Context:** Voice waveform, transcript preview, value-confirmation cards, "Reconnecting…" banner. Reuse v1 components where possible.

### 1.5 Multilingual Support

- [ ] **[T-V2-140]** Validate end-to-end flow in English
  - **Depends on:** T-V2-132
  - **Context:** Smoke test with caregiver speaking BP, glucose, weight. Latency P95 under 2s.

- [ ] **[T-V2-141]** Validate end-to-end flow in Hindi
  - **Depends on:** T-V2-140
  - **Context:** Same set of utterances. Includes Hindi-English code-switching.

- [ ] **[T-V2-142]** Validate end-to-end flow in Bengali
  - **Depends on:** T-V2-141
  - **Context:** Same. Track Bengali-specific STT correction rate as a key metric for Q4 fallback decision.

**Exit criteria:** Patient speaks in Hindi or Bengali; system extracts a BP reading, confirms verbally, produces a valid FHIR Observation, logs the interaction. P95 latency < 2s on T2 short turns.

---

## Phase 2: Vision + Escalation (Weeks 7–8)

### 2.1 ML Kit OCR

- [ ] **[T-V2-200]** Add ML Kit Text Recognition v2 dependency
  - **Depends on:** None

- [ ] **[T-V2-201]** Implement `OcrManager`
  - **Depends on:** T-V2-200
  - **Context:** Camera capture → ML Kit → text blocks with confidence. `DigitExtractor` post-processes for value + unit per parameter context.

- [ ] **[T-V2-202]** Implement OCR confidence threshold + fallback decision
  - **Depends on:** T-V2-201
  - **Context:** Confidence < 0.85 OR multi-block ambiguity → upload photo to S3 and call `/photo-extract`.

### 2.2 Bedrock Vision

- [ ] **[T-V2-210]** Implement `bedrock-vision` Lambda business logic
  - **Depends on:** T-V2-021
  - **Context:** Loads photo from S3; calls Haiku vision; on confidence < 0.80, escalates to Sonnet vision; returns structured value + confidence.

- [ ] **[T-V2-211]** Implement vision telemetry
  - **Depends on:** T-V2-210
  - **Context:** Records into `model_call` with tier `T2_VISION` or `T3_VISION`. Costs accrue to `cost_telemetry`.

### 2.3 Escalation in Patient Conversation

- [ ] **[T-V2-220]** Implement implausible-value escalation flow
  - **Depends on:** T-V2-106
  - **Context:** Plausibility ranges checked in router before invoking model; if outside hard range, route to Sonnet with a focused "challenge this value" sub-prompt.

- [ ] **[T-V2-221]** Implement on-device emergency keyword matcher
  - **Depends on:** None
  - **Context:** Fast-path emergency detection in app (regex against transcript). On match, immediately surfaces emergency UI + sends caregiver alert without waiting for Bedrock.

- [ ] **[T-V2-222]** Wire Guardrails emergency-trigger to caregiver alert
  - **Depends on:** T-V2-004, T-V2-105
  - **Context:** When Guardrails fires custom topic trigger, router records flag in session state and enqueues SQS alert message → notification-sender Lambda → caregiver FCM.

**Exit criteria:** Photo of clean glucometer reads in < 300ms via ML Kit. Photo on glare falls back through Haiku → Sonnet successfully. Implausible BP value triggers Sonnet challenge. Saying "chest pain" triggers caregiver alert within 60s end-to-end.

---

## Phase 3: Caregiver Experience (Weeks 9–11)

### 3.1 Caregiver Onboarding Conversation

- [ ] **[T-V2-300]** Implement Sonnet-default for `caregiver_config` session type
  - **Depends on:** T-V2-105
  - **Context:** Router selects Sonnet automatically for caregiver sessions. Streaming on by default.

- [ ] **[T-V2-301]** Implement caregiver onboarding prompt template
  - **Depends on:** T-V2-300
  - **Context:** Patient profile extraction, monitoring parameter elicitation, frequency/deadline configuration. Per v1 spec §6.2 for caregiver flow.

- [ ] **[T-V2-302]** Implement protocol persistence
  - **Depends on:** T-V2-301
  - **Context:** Extracted parameter configs written to `parameter_config` table. Reuse v1 Lambda APIs.

### 3.2 Invite Flow

- [ ] **[T-V2-310]** Verify v1 `invite-caregiver`, `invite-doctor` Lambdas work end-to-end
  - **Depends on:** T-V2-302
  - **Context:** No code changes expected; sanity test that SMS + email delivery still works in v2 stack.

### 3.3 Reminder + Alert Engine

- [ ] **[T-V2-320]** Verify v1 `check-daily-deadline`, `check-missed-measurements`, `evaluate-thresholds-batch` Lambdas
  - **Depends on:** None
  - **Context:** Should be unchanged from v1. Smoke test push notification delivery to test caregiver device.

### 3.4 Caregiver Dashboard

- [ ] **[T-V2-330]** Caregiver dashboard for log viewing
  - **Depends on:** T-V2-320
  - **Context:** Reuse v1 Caregiver dashboard. Verify all journeys CG-06 through CG-19 work.

**Exit criteria:** Caregiver onboards a new patient in one conversational session. Patient receives SMS + email invite, logs in, completes a logging session. Caregiver receives push notification on threshold breach within 60s.

---

## Phase 4: Integration & Polish (Weeks 12–14)

### 4.1 End-to-End

- [ ] **[T-V2-400]** Run all PRD §6 acceptance criteria end-to-end in en, hi, bn
- [ ] **[T-V2-401]** Run journeys CG-01 through CG-20 (caregiver) and PT-01 through PT-27 (patient) — drop journeys related to Mac Mini discovery (CG-20, PT-26)

### 4.2 Edge Cases

- [ ] **[T-V2-410]** Implausible value soft + hard ranges
- [ ] **[T-V2-411]** Confused/unresponsive patient
- [ ] **[T-V2-412]** Emergency detection accuracy + false-positive audit
- [ ] **[T-V2-413]** Connectivity loss mid-session resume
- [ ] **[T-V2-414]** Mid-stream Bedrock failure handling

### 4.3 Telemetry + Dashboards

- [ ] **[T-V2-420]** CloudWatch metrics + alarms (P95 latency, escalation rate, Guardrail block rate, cost per patient)
- [ ] **[T-V2-421]** Cost dashboard in admin web portal tab
- [ ] **[T-V2-422]** Latency P95 by tier dashboard

### 4.4 Latency Tuning

- [ ] **[T-V2-430]** Audit prompt cache hit rate; aim for > 80% on system + per-patient blocks
- [ ] **[T-V2-431]** Tune provisioned concurrency on `bedrock-router`
- [ ] **[T-V2-432]** Validate P95 SLOs hold under simulated 10-patient concurrent load

**Exit criteria:** All acceptance criteria pass in all 3 languages. SLOs hold. Cost dashboard live with first 2 weeks of pilot-shadow data.

---

## Phase 5: Compliance & Pilot (Weeks 15–16)

### 5.1 Compliance

- [ ] **[T-V2-500]** Update DPDP consent text with cross-region inference disclosure
  - **Depends on:** Legal review
- [ ] **[T-V2-501]** Re-version consent records (existing pilot users re-consent)
- [ ] **[T-V2-502]** Verify CloudTrail captures Bedrock invocations including cross-region
- [ ] **[T-V2-503]** Document Bedrock Guardrails + per-patient model_call audit in HIPAA assessment doc
- [ ] **[T-V2-504]** Penetration test (if pilot warrants) — focus on `/conversation/turn` and `/photo-extract` routes

### 5.2 Pilot

- [ ] **[T-V2-510]** Onboard 10 pilot patients (close family + friends)
- [ ] **[T-V2-511]** Daily cost review for first 2 weeks
- [ ] **[T-V2-512]** Weekly latency P95 review
- [ ] **[T-V2-513]** Bi-weekly transcript audit (sampled, with re-consent for audit purpose)
- [ ] **[T-V2-514]** Pilot feedback collection
- [ ] **[T-V2-515]** Set per-patient cost cap based on 4-week pilot data; configure soft/hard caps in `bedrock-router` env vars

**Exit criteria:** Pilot users actively using Matika. No critical security findings. Cost-per-patient-per-day baseline established. Open question on T1 reintroduction informed by escalation-rate data.

---

## Timeline

```
Phase                          │ Wk 1-2 │ Wk 3-6 │ Wk 7-8 │ Wk 9-11 │ Wk 12-14 │ Wk 15-16
───────────────────────────────┼────────┼────────┼────────┼─────────┼──────────┼─────────
P0  Foundation                 │ ████   │        │        │         │          │
P1  Conversational Core        │        │ ████   │        │         │          │
P2  Vision + Escalation        │        │        │ ██     │         │          │
P3  Caregiver Experience       │        │        │        │ ███     │          │
P4  Integration & Polish       │        │        │        │         │ ███      │
P5  Compliance & Pilot         │        │        │        │         │          │ ██
```

---

## Key Risks to Plan

| Risk | Owner | Mitigation in plan |
|---|---|---|
| Bedrock model access not approved in P0 week 1 | Eng lead | T-V2-002 submitted before T-V2-001; team works on T-V2-010..T-V2-013 in parallel |
| Bengali STT quality below threshold | Eng lead | T-V2-142 measures correction rate; if > 10%, schedule v2.1 Bhashini integration |
| P95 latency drift > 2s in P4 | Eng lead | T-V2-430..T-V2-432 with explicit mitigations; T1 reintroduction is the escape hatch |
| Cross-region inference legal pushback | Compliance | T-V2-500 done before pilot; willingness to switch to Llama-only in-region if regulator requires |

---

*Matika Implementation Plan v2.0 — May 2026 — CONFIDENTIAL*

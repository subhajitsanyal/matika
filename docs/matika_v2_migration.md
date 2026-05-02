# Matika v2.0 — Migration Guide

**Version:** 2.0
**Date:** May 2026
**Source PRD:** `docs/matika_prd_v2.md`
**Source Spec:** `docs/matika_spec_v2.md`

---

## Purpose

This document is the concrete checklist of what changes when moving from CareLog v1 (Mac Mini + LAN inference) to Matika v2 (cloud Bedrock + on-device STT/TTS). It complements the implementation plan and is the authoritative source for "what needs to be deleted, refactored, or added."

---

## Repository Changes

### Delete

| Path | Reason |
|---|---|
| `mac-mini/` (entire directory) | All Mac Mini inference services replaced by Bedrock |
| `mac-mini/services/llm_service.py` | Replaced by `bedrock-router` Lambda |
| `mac-mini/services/stt_service.py` | Replaced by Android `SpeechRecognizer` |
| `mac-mini/services/tts_service.py` | Replaced by Android `TextToSpeech` |
| `mac-mini/services/vision_service.py` | Replaced by ML Kit OCR + `bedrock-vision` Lambda |
| `mac-mini/services/health_aggregator.py` | Replaced by `health-check` Lambda |
| `mac-mini/deploy/` | No more household deployment |
| `mac-mini/scripts/` | No more household scripts |
| `mac-mini/tests/` | Tests follow code |
| `mac-mini/pyproject.toml`, `mac-mini/requirements.txt` | Python service deps no longer needed |
| Android: `com.carelog.macmini.*` package | LAN client + mDNS discovery code |
| Android: `MacMiniHealthChecker` and observers | Replaced by `CloudHealthChecker` |
| Android: `LanInferenceClient` | Replaced by `BedrockClient` |
| Backend: `lambdas/fetch-session-config/` | Folded into `bedrock-router` |
| Docs: Mac Mini setup sections in `docs/setup-and-deployment-guide.md` | No Mac Mini |
| Journeys: CG-20, PT-26 (Mac Mini discovery) | No Mac Mini |

Tag the v1 commit before deletion: `git tag carelog-v1.0-final` so historical state is recoverable.

### Add

| Path | Purpose |
|---|---|
| `backend/lambdas/bedrock-router/` | New Lambda — see spec §3.2 |
| `backend/lambdas/bedrock-vision/` | New Lambda — see spec §3.2 |
| `backend/lambdas/health-check/` | New Lambda — see spec §4.3 |
| `backend/lambdas/bedrock-router/prompts/system_v2.md` | System prompt template |
| `backend/lambdas/bedrock-router/prompts/per_patient_context_v2.md` | Per-patient context block template |
| `infrastructure/terraform/modules/bedrock/` | Inference profiles + Guardrail resource |
| `android/app/src/main/java/com/matika/inference/` | `BedrockClient`, SSE consumer, repository |
| `android/app/src/main/java/com/matika/audio/stt/` | `SttManager`, `LanguagePackChecker` |
| `android/app/src/main/java/com/matika/audio/tts/` | `TtsManager`, `SentenceQueue`, `NumberFormatter` |
| `android/app/src/main/java/com/matika/vision/` | `OcrManager`, `DigitExtractor` |
| `backend/database/migrations/V0XX__add_model_call_and_cost_telemetry.sql` | New tables per spec §5.1 |
| `backend/database/migrations/V0XX__alter_interaction_session_v2.sql` | New columns per spec §5.2 |
| `docs/matika_prd_v2.md` | This release's PRD |
| `docs/matika_spec_v2.md` | This release's spec |
| `docs/matika_implementation_plan_v2.md` | Phased plan |
| `docs/matika_v2_migration.md` | This document |

### Refactor

| Path | Change |
|---|---|
| `android/app/src/main/AndroidManifest.xml` | Add `RECORD_AUDIO`, `INTERNET`, `CAMERA` permissions; remove any LAN multicast / Bonjour permissions |
| `android/app/src/main/java/com/carelog/...` | Rename root package to `com.matika` (deferred to a v2.1 chore — large refactor; not blocking pilot) |
| `web-portal/src/...` | Rename "CareLog" string to "Matika" in user-facing copy; add admin "Cost & Telemetry" tab |
| `infrastructure/terraform/modules/lambda/` | Register new Lambdas; configure provisioned concurrency on `bedrock-router` |
| `infrastructure/terraform/modules/api_gateway/` | New routes per spec §4 |
| `infrastructure/terraform/modules/iam/` | New scoped Bedrock policies per spec §11.4 |
| `README.md`, `CLAUDE.md` | Reflect new architecture; remove Mac Mini references |

### Brand Rename Strategy

The product name in v2 is **Matika** (the project repo name). v1 codebase used "CareLog" extensively in user-facing strings, package names (`com.carelog.*`), Cognito client names, S3 bucket names, etc.

**Pilot rename scope (P0 week 2):**
- User-facing strings only (Android `strings.xml`, web portal copy, email templates, SMS templates).
- Documentation (PRD, spec, README, CLAUDE.md).

**Deferred to v2.1 (not blocking pilot):**
- Android package rename `com.carelog.*` → `com.matika.*` (touches every Kotlin file; requires AndroidManifest, Gradle, Hilt graph updates).
- Cognito client / IAM role renaming.
- S3 bucket renaming (requires migration; defer indefinitely unless required).

This split lets pilot users see the new brand without the v2 release becoming a code-wide rename PR.

---

## Cloud Configuration Changes

### Bedrock

- **Model access**: request access to `anthropic.claude-haiku-4-5-v1:0` and `anthropic.claude-sonnet-4-x-v1:0` in source regions of the inference profiles (typically ap-southeast-1, us-east-1).
- **Inference profiles**: create cross-region inference profiles `apac.anthropic.claude-haiku-4-5` and `apac.anthropic.claude-sonnet-4-x`.
- **Guardrails**: one Matika guardrail per spec §11.5.
- **Prompt caching**: enabled by default for Anthropic models on Bedrock; ensure cache breakpoints are set on system + per-patient context blocks.

### IAM

- New role `matika-bedrock-router-role` with policy per spec §11.4.
- New role `matika-bedrock-vision-role` (similar but vision-only; optional separation).
- New role `matika-health-check-role` (Bedrock + RDS + S3 read-only ping permissions).

### API Gateway

- Add routes:
  - `POST /conversation/turn`
  - `POST /conversation/turn-stream` (binary media type for SSE)
  - `POST /conversation/photo-extract`
  - `GET /health`
- All authenticated via existing Cognito authorizer.

### CloudWatch

- New metrics: `BedrockTtfTMs`, `BedrockTotalLatencyMs`, `GuardrailBlockRate`, `EscalationRate`, `CostPerPatientPerDay`.
- New alarms per spec §14.4.
- New dashboards (one per role: eng, compliance, business).

### RDS

- Run new migrations:
  - `V0XX__add_model_call_and_cost_telemetry.sql`
  - `V0XX__alter_interaction_session_v2.sql`
- No data migration needed (new tables; new optional columns).

### S3

- No bucket changes. Photo upload flow remains: app uploads photo to `interactions/{patientId}/{YYYY}/{MM}/{DD}/{sessionId}/photos/uuid.jpg` via presigned URL, then calls `/photo-extract`.

---

## Mobile Migration Notes

### Pilot User Experience

For existing CareLog v1 pilot users (if any), the v2 update is a forced app upgrade:
1. Push update via Play Store (or sideload for pilot).
2. On first launch post-upgrade, app prompts to download offline language packs (STT + TTS).
3. Patient re-consents to updated DPDP terms (cross-region inference disclosure).
4. Caregiver re-confirms protocol settings (no change expected; just a confirmation screen).
5. First conversation session uses the new cloud path; v1 Mac Mini is ignored even if still on the LAN.

### Offline Language Packs

Required packs per supported language (downloaded from Google):
- `en-IN`: STT and TTS, ~30 MB combined
- `hi-IN`: STT and TTS, ~40 MB combined
- `bn-IN`: STT and TTS, ~35 MB combined

App enforces pack download before first conversation; surfaces clear progress UI. Total: ~100 MB — disclose in Play Store listing.

---

## Compliance Migration

### DPDP Consent Versioning

Existing v1 consent text is invalidated. New consent text v2.0 must include the cross-region inference disclosure:

> "Some health-related conversations may be processed by AI services running in AWS data centers outside India (specifically, Singapore and the United States) under our agreement with AWS for healthcare data. No health information is stored outside India; only the conversation processing happens in those regions, and only momentarily."

All existing pilot users re-consent on first v2 launch. New `consent_version` column tracks v1 vs v2 acceptance.

### HIPAA

- Confirm AWS BAA covers Bedrock inference (typically yes; verify with AWS account team).
- Update HIPAA risk assessment doc to reference Bedrock Guardrails as PHI-redaction control.
- Update audit log catalog to include `model_call` table as a per-PHI-touch audit source.

### Audit Trail

Every Bedrock call now leaves three traces:
1. CloudTrail (API-level, automatic, immutable)
2. `model_call` table row (per-patient, queryable, includes prompt-cache and Guardrail flags)
3. CloudWatch logs (`bedrock-router` Lambda execution log)

This is *more* audit visibility than v1 (which had only CloudTrail-equivalent logs from the Mac Mini, often inaccessible to compliance team). Surface this in compliance docs as a v2 improvement.

---

## Cutover Plan

### Recommended sequence

1. **Week -2 to 0 (pre-pilot)**: Provision Bedrock access, deploy infrastructure, run smoke tests, validate end-to-end in staging with synthetic data.
2. **Week 0**: Pilot patient onboarding via v2 only. No v1/v2 dual-running. Mac Minis (if any are still in homes from v1 pilot dev) are powered down and reclaimed.
3. **Week 1-4**: Daily ops review (cost, latency, errors, transcript audits).
4. **Week 4**: Set per-patient cost cap based on 4-week telemetry. Decide on T1 reintroduction (re-evaluate with data).

### Rollback Plan

Because v2 deletes the Mac Mini path entirely, rollback to v1 means redeploying v1 code + re-provisioning Mac Minis. This is a multi-day operation, not a feature flag flip. To mitigate:

- **Bedrock model swap** is feature-flagged (env var); a regression in Haiku 4.5 can be rolled back to Haiku 4.0 in minutes.
- **Sonnet escalation** is feature-flagged; can be force-disabled to Haiku-only via env var.
- **Streaming** is feature-flagged; can be force-disabled to non-streaming via env var.
- **Cross-region inference profile** can be swapped to a different region via env var if a region has issues.

True full rollback to v1 is intentionally hard — moving back to per-household hardware is not a desired escape hatch.

---

## Acceptance Sign-off

The migration is complete when:

- [ ] All v1 Mac Mini code is deleted from `main` branch.
- [ ] v2 PRD, spec, plan, migration docs are merged.
- [ ] All v2 acceptance criteria from PRD §6 pass in en, hi, bn.
- [ ] All P5 compliance tasks (T-V2-500..T-V2-504) signed off.
- [ ] 10 pilot patients onboarded; 4 weeks of telemetry collected.
- [ ] Per-patient cost cap configured based on real data.
- [ ] Open Question 1 (T1 reintroduction) decided with telemetry-driven recommendation.

---

*Matika v2.0 Migration Guide — May 2026 — CONFIDENTIAL*

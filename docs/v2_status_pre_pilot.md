# Matika v2 — Pre-Pilot Status

**Date:** 2026-05-02
**Status:** Backend code-complete for the conversational core; awaiting AWS provisioning + Android v2 client + integration testing.
**Audience:** Project owner (you), to plan the next phase of real-world work.

---

## Executive summary

**Where we are:** 25 of 66 plan tasks done (~38%). The backend conversational pipeline — bedrock-router, bedrock-vision, cost-telemetry-rollup, plus inference-platform prompts and evals — is code-complete and unit-tested. **466 tests across 5 packages, all green.** Schema migration V005 is written but never run.

**Where the bottlenecks are:** Three things gate further progress, and only you can unblock them. (1) **Bedrock model access** (T-V2-002) — submit the request; 1–3 day AWS SLA. (2) **V005 migration applied** to a real Postgres in dev — needed to validate my SQL against reality. (3) **Android dev environment** — to start v2 Android client work that I can write but cannot verify in this sandbox.

**The one bug class I want to flag loudly:** all my SQL is unit-tested only against stubbed `PgClient` mocks. No integration tests against a real Postgres exist. I caught one table-name drift (singular/plural) in Increment 9 by reading V004 carefully; **there could be more.** First real DB run will likely surface 1–3 column-name or type mismatches I didn't catch by inspection.

---

## What's been built

Traceability: each row maps to commits on `origin/main`.

| Lambda / module | Closes | Commits | Tests | Production-ready? |
|---|---|---|---|---|
| `bedrock-router` Lambda | T-V2-100..107, 110, 111, 220, 222, 300 (parts), §6.7 summarization, §11.6 rate limit | cc7807e, 40716e7, d52ae39, 45fe079, 030da66, 348fe81, 2c2b479, 8cc4afb, baddad6, 2ed675f | 320 unit | Code yes; needs deployment |
| `bedrock-vision` Lambda | T-V2-210, 211 | cb86458 | 48 unit | Code yes; needs deployment |
| `health-check` Lambda | T-V2-022 (scaffold only) | ff39bc9 | 1 stub | Stub — not real |
| `cost-telemetry-rollup` Lambda | T-V2-108 | 7e8d6aa | 31 unit | Code yes; needs EventBridge schedule (devops) |
| `inference-platform/` evals | Continuous | (multiple) | 66 across 6 prompt evals | N/A — quality gate, not deployed |
| V005 migration SQL | Schema for above | ca15505 | None (no integration test) | **Never applied; never validated on real Postgres** |
| Existing v1 Lambdas (24 of them) | Unchanged from v1 | — | v1 tests | Already deployed pre-v2 |

### Code stats

- TypeScript source: ~7,400 lines across 4 v2 Lambdas
- Tests: ~6,200 lines across 466 cases
- Prompt content: ~520 lines of Markdown across 6 prompts (system, vision, summarize, caregiver_onboarding, emergency.md sub-prompt, implausible_value.md sub-prompt)
- SQL migrations: V005 = 150 lines, never run

---

## Deployment readiness matrix

Per-component honest assessment.

### Backend Lambdas

| Component | Code | Unit tests | SDK mocked tests | Real-Bedrock test | Real-Pg test | Lambda deployed | Ready to invoke? |
|---|---|---|---|---|---|---|---|
| bedrock-router POST /conversation/turn | ✅ | ✅ 320 | ✅ via mocked SDK | ❌ | ❌ | ❌ | **No** |
| bedrock-router POST /conversation/turn-stream | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | **No** |
| bedrock-vision POST /conversation/photo-extract | ✅ | ✅ 48 | ✅ via mocked SDK | ❌ | ❌ | ❌ | **No** |
| health-check GET /health | ⚠️ stub | ⚠️ stub | N/A | ❌ | ❌ | ❌ | **No** |
| cost-telemetry-rollup (EventBridge) | ✅ | ✅ 31 | N/A (no Bedrock calls) | N/A | ❌ | ❌ | **No** |

**What "ready to invoke" means:** would a `curl` against the API Gateway URL, with a real Cognito JWT, actually work end-to-end? Today: no, on every Lambda. The blockers are different per Lambda — see "Real-environment dependencies" below.

### Inference platform (prompts + schemas + evals)

| Item | Status |
|---|---|
| `prompts/system_v2.md` (patient_logging) | ✅ Authored, structurally validated, examples validate against schema |
| `prompts/system_v2_caregiver_onboarding.md` | ✅ Authored, validated |
| `prompts/summarize.md` | ✅ Authored, validated |
| `escalation_subprompts/emergency.md` | ✅ Authored, validated |
| `escalation_subprompts/implausible_value.md` | ✅ Authored, validated |
| `prompts/extract_value.md` (vision) | ✅ Authored, validated |
| `output_schema.json` (conversational) | ✅ Strict, draft-07, drives parser |
| `bedrock-vision/output_schema.json` | ✅ Strict |
| Prompt-vs-schema drift gate | ✅ All example blocks validate against their respective schemas in CI |

**Semantic quality:** zero data. These prompts have never been seen by a real Claude model. Structurally clean ≠ produces good output. The first weeks of pilot will surface prompt-tuning needs that no amount of structural eval can predict.

### Schema (RDS Postgres)

| Migration | Status |
|---|---|
| V001..V004 | ✅ Already deployed (v1 era) |
| V005 (this v2 work) | ⚠️ **Written but never executed** |

**V005 risk areas — what could fail when first run:**

1. **`ALTER TABLE patients ALTER COLUMN language TYPE VARCHAR(8)`** — works only if no constraints reference the column type. v1 added a `DEFAULT 'en'` but no CHECK; should be fine.
2. **`UPDATE language = language || '-IN' WHERE length(language) = 2`** — backfills the BCP-47 form. Will run once; idempotent (length(language) won't be 2 after update).
3. **FK constraints with `ON DELETE CASCADE`** to `interaction_sessions` and `patients` — relies on those tables already existing (they do, from V004 and V001).
4. **`gen_random_uuid()`** — requires the `pgcrypto` extension. v1 must have already enabled it (V001 uses it); should be fine.
5. **Column defaults like `'[]'::jsonb`** — standard Postgres, works.

The migration is wrapped in BEGIN/COMMIT, so partial failure rolls back. Recommended: run on a dev Postgres copy first; verify with `\d interaction_sessions` and `\d model_call`.

### Mobile app (Android)

| Item | Status |
|---|---|
| v1 Mac Mini code in Android | ⚠️ **Still present** (T-V2-011 deferred to Increment 6) |
| Android v2 STT/TTS/SSE/inference modules | ❌ **Not started** |
| Android consent v2.0 flow | ❌ Not started |
| Android language-pack onboarding | ❌ Not started |
| Android emergency keyword matcher | ❌ Not started (T-V2-221) |
| Android ML Kit OCR integration | ❌ Not started |
| Android tests passing | ⚠️ Unknown — haven't run Gradle |
| APK builds | ⚠️ Unknown |

**The mobile app is the largest remaining piece.** I can write Kotlin source files but cannot verify they compile or that ML Kit / `SpeechRecognizer` / `TextToSpeech` integrate correctly without a real Android dev environment.

### Web portal (doctor / admin)

| Item | Status |
|---|---|
| Existing v1 doctor portal | ✅ Already deployed |
| Admin "Cost & Telemetry" tab (spec §9.1) | ❌ Not started |
| Admin "Escalations" tab | ❌ Not started |
| Admin "Latency" tab | ❌ Not started |
| Cognito `admins` group | ⚠️ Likely doesn't exist yet |

### Infrastructure (Terraform)

| Module | Status |
|---|---|
| Existing v1 modules | ✅ Already applied |
| `infrastructure/terraform/modules/bedrock/` | ⚠️ Scaffold exists; resources commented out pending model access |
| `bedrock-router` Lambda definition | ⚠️ Not in Terraform yet (devops T-V2-022 / T-V2-023) |
| `bedrock-vision` Lambda definition | ⚠️ Not in Terraform yet |
| `cost-telemetry-rollup` Lambda definition | ⚠️ Not in Terraform yet |
| `cost-telemetry-rollup` EventBridge rule | ⚠️ Not in Terraform yet |
| API Gateway routes for v2 endpoints | ⚠️ Not added |
| IAM roles for v2 Lambdas | ⚠️ Not added |
| Bedrock Guardrail resource | ⚠️ Not deployed |
| `MATIKA_ALERT_QUEUE_URL` SQS queue | ⚠️ Not provisioned |
| CloudWatch alarms (P95 latency, cost-per-patient, etc.) | ⚠️ Not configured |

**Devops work is non-trivial.** Multi-day effort: provisioning + IAM + EventBridge + API Gateway + CloudWatch dashboards + Terraform module wiring. None of it is started.

---

## Real-environment dependencies

What needs to happen *externally* before any v2 code can actually run end-to-end.

### User (you) — AWS provisioning

| Action | Owner | SLA | Blocks |
|---|---|---|---|
| Verify AWS BAA covers Bedrock cross-region inference (T-V2-001) | You + AWS account team | 1–3 days | Everything Bedrock |
| Submit Bedrock model access request for Claude Haiku 4.5 + Sonnet 4.x (T-V2-002) | You via Bedrock console | 1–3 days | Real Bedrock testing |
| Create Bedrock cross-region inference profiles (T-V2-003) | Devops via Terraform | After T-V2-002 | bedrock-router/vision deployment |
| Configure Bedrock Guardrails (T-V2-004) | Devops + inference-platform | 1 day | Production calls |
| Submit Bedrock quota increase requests (T-V2-005) | You | 1–3 days | Pilot scale |
| Apply V005 migration to dev Postgres | Devops | 30 min | Real DB testing |
| Provision SQS alert queue, set `MATIKA_ALERT_QUEUE_URL` | Devops | 1 hour | Emergency / rate-limit alert delivery |
| Create Cognito `admins` group | Devops | 15 min | Admin telemetry views |

### User (you) — Android development

| Action | Owner | Effort | Blocks |
|---|---|---|---|
| Set up Android Studio + AVD + Gradle environment | You | 1 hour | Verifying any Android v2 code I write |
| Decide: do you want me to write Android v2 code blind, or wait until you have the env? | You decision | — | All P1 Increment 6 |

### Devops (Terraform / CI / monitoring)

| Action | Owner | Effort | Blocks |
|---|---|---|---|
| Add `bedrock-router`, `bedrock-vision`, `cost-telemetry-rollup`, `health-check` Lambdas to `infrastructure/terraform/modules/lambda/` | Devops | 2 hours | Lambda deploy |
| Wire API Gateway routes: `POST /conversation/turn`, `POST /conversation/turn-stream`, `POST /conversation/photo-extract`, `GET /health` | Devops | 1 hour | App can call them |
| Create scoped IAM roles per Lambda (per spec §11.4 — no `bedrock:*` wildcard) | Devops | 2 hours | Production-grade auth |
| Wire `cost-telemetry-rollup` to EventBridge daily schedule (e.g. `cron(0 1 * * ? *)`) | Devops | 30 min | Cost dashboards populate |
| Configure provisioned concurrency on `bedrock-router` (recommend: 1–2 for pilot) | Devops | 15 min | Avoid cold-start on every turn |
| Apply V005 migration in dev → smoke test → apply in prod | Devops | 1 hour | Real DB writes work |
| Create CloudWatch alarms: P95 latency > SLO, GuardrailBlockRate > 5%, cost-per-patient anomaly | Devops | 2 hours | Operational visibility |

---

## Known gaps and risks

Honest acknowledgment of what's not in the codebase yet, what I'm uncertain about, and what could bite in pilot.

### Code I haven't written

| Gap | Plan task | Severity | Notes |
|---|---|---|---|
| Android v2 STT/TTS/SSE/inference client | T-V2-120..132 | Critical | Largest single area; blocks pilot |
| Android Mac Mini code removal | T-V2-011 | High | Deferred to alongside Android v2 work; can't ship Android v2 without it |
| T-V2-302 protocol persistence | T-V2-302 | High | Caregiver onboarding produces structured data; nothing writes it to RDS yet |
| Web portal admin cost/telemetry tabs | Increment 8b in plan | Medium | Have telemetry data with no UI to view it |
| CloudWatch metric emission | T-V2-420 | Medium | All telemetry sits in RDS; no CloudWatch metrics for alarms to fire on |
| Idempotency keys on `/conversation/turn` | T-V2-413 | Medium | A retry-on-network-blip can duplicate state |
| Multilingual smoke validation | T-V2-140..142 | Medium | Hindi/Bengali behavior unmeasured |
| Real incremental sentence streaming (Option A) | (deferred from 4b) | Low–Medium | Today's "streaming" delivers events at `</output>` close — no real time-to-first-audio win |
| Web portal "Last session telemetry" card | (spec §9.1) | Low | Doctor-facing observability |

### Code I wrote but can't fully verify

| Component | What's mocked | Risk |
|---|---|---|
| All `pg`-backed loaders/persisters/recorders | `PgClient` interface stubbed | Real Postgres may reject SQL I haven't tested. Increment 9 caught one drift; could be more |
| Bedrock SDK calls | `BedrockInvoker` stubbed | Anthropic-on-Bedrock body shape may have evolved since I wrote the code |
| AWS SDK for SQS (alerts), S3 (vision photos) | Top-level interfaces stubbed | Same |
| Lambda cold-start timing | Not measured | Provisioned concurrency may need tuning |
| Lambda warm-pool prompt cache | Module-scope cache implemented | Lambda lifecycle quirks (warm-pool eviction) may hurt cache hit rate |

### Bugs and gaps I've explicitly acknowledged

| In commit | What I flagged |
|---|---|
| ca15505 | Singular/plural table-name drift between v2 spec docs and V004 reality. Code now uses plural (matches reality); spec docs still say singular (cosmetic — to fix in the docs cleanup pass) |
| baddad6 | Per-patient rate limiter has a concurrent-call race at exactly the cap boundary (10 simultaneous turns at limit-1 might all pass the check). Mitigation deferred — pilot scale doesn't see this |
| 348fe81 | Streaming endpoint exists but doesn't yet deliver real time-to-first-audio improvement (Option B not Option A) |
| (multiple) | `ocr_local_calls` column exists but no code path writes to it; reserved for future client-telemetry endpoint |
| (multiple) | No real integration tests anywhere. All tests use stubbed external systems |

### Spec drift

`docs/matika_spec_v2.md` was written before I had visibility into V004's actual table names. It uses singular forms (`interaction_session`, `patient`, etc.) where V004's reality is plural. The migration (V005) and code now match V004 reality. The spec docs are wrong. **Recommend a docs cleanup pass before pilot** to bring spec back in sync.

### Realistic risk profile for first real-Bedrock test

When you finally run a real `POST /conversation/turn` against deployed Lambda + real Bedrock + real Postgres, I'd expect:

- **70% probability** it works on the first or second try, with maybe one column-name mismatch to fix
- **20% probability** the prompt produces output that doesn't match my schema (LLM behavior surprise) — parser will throw schema_validation, retry will fire, second attempt may fix it or may also fail
- **10% probability** Bedrock cross-region inference profile shape has evolved since I wrote against the docs, requiring SDK / body adjustments

The 30% combined risk is normal for "code that's never seen production." Mitigation is staged rollout: dev → staging smoke test → pilot.

---

## Recommended next steps

### Immediate (you)

1. **Submit Bedrock model access request** (T-V2-002). Slowest external dependency.
2. **Set up a dev Postgres** (or borrow your existing dev RDS), apply V005 migration, run `\d interaction_sessions` and `\d model_call` to verify shape. Surface any errors back to me.
3. **Decide on Android dev**: do you have a working Android Studio + emulator setup somewhere I can target via you? If not, I shouldn't write Android code blind. We should plan that work in a different session where you can verify alongside.

### Useful work I can still do here (without real environment)

In rough priority order:

1. **Web portal admin cost/telemetry tabs** — I can build the React UI (Vitest + React Testing Library is in the existing portal). Surfaces the telemetry data we're collecting; useful for pilot ops; doesn't need real Bedrock to verify.
2. **Idempotency keys on `/conversation/turn`** — short increment; real safety feature; makes the network-retry story bulletproof for pilot.
3. **CloudWatch metric emission** — wire the existing telemetry to `cloudwatch:PutMetricData` so alarms can actually fire. Mockable; testable.
4. **T-V2-302 caregiver protocol persistence** — when a caregiver does onboarding, the structured output (selected parameters, frequencies) needs to write to `parameter_configs`. Backend work; testable.
5. **Spec docs cleanup** — fix the singular/plural drift, refresh Open Questions, update what's actually shipped.
6. **Real incremental streaming (Option A)** — cross-agent prompt format change. Touches inference-platform; would unblock the actual P95 first-audio SLO win.

### Once Bedrock access lands

1. Smoke test `bedrock-router` against real Haiku with one canned transcript, verify model_call telemetry row created.
2. Run `inference-platform/eval/` against real Bedrock to catch prompt-quality regressions before pilot.
3. Pilot multilingual validation (T-V2-140..142): Hindi and Bengali turns, measure transcription correction rate, decide on Bhashini fallback.

### Once Android dev env is ready

1. T-V2-011 Android Mac Mini code removal.
2. T-V2-120..132 Android v2 client (STT, TTS, SSE consumer, ML Kit OCR, conversation UI).
3. End-to-end pilot smoke test: phone → API Gateway → Lambda → Bedrock → response back to phone.

---

## Test invocation

If you're running this locally, here's how to verify the current state:

```bash
# All backend Lambdas
cd backend/lambdas/bedrock-router && npm install && npm run typecheck && npm run lint && npm test
cd ../bedrock-vision && npm install && npm run typecheck && npm run lint && npm test
cd ../cost-telemetry-rollup && npm install && npm run typecheck && npm run lint && npm test
cd ../health-check && npm install && npm test

# Inference platform evals
cd ../../../inference-platform && npm install && npm run typecheck && npm run lint && npm test

# Web portal (existing v1, untouched)
cd ../web-portal && npm install && npm test
```

Expected: 466 tests pass across the four v2 packages. Web portal continues to pass its existing v1 tests.

---

## Summary

Backend code is in good shape. The pieces that matter — bedrock-router, bedrock-vision, cost-telemetry-rollup, all four prompts, escalation logic, summarization, rate limiting, parser retry, streaming architecture — are all present, well-tested, and structurally consistent with the v2 spec.

What's missing isn't more backend code; it's everything that lives outside this repo: AWS provisioning, real Postgres validation, Android dev environment, and the inevitable adjustments that come from first contact with real Bedrock and real users.

The natural next session is to do the AWS-side work in parallel with the smaller backend polish items (web portal cost dashboard, idempotency, CloudWatch metrics). Then a separate Android-focused session once you have Android Studio running.

---

*Status snapshot: 2026-05-02 — 25 of 66 plan tasks complete.*
*Next planned increment depends on user direction.*

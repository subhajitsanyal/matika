# Agent: Backend

## Role

You are the **Backend** agent. You own the AWS serverless backend: Lambda functions (Node.js 20), database migrations (Flyway/PostgreSQL 15), API Gateway route configuration, Cognito group management, and Lambda IAM policies. You build the cloud APIs that the mobile app and web portal consume.

You **share** the `bedrock-router/` and `bedrock-vision/` Lambda directories with the `inference-platform` agent. **Strict ownership boundary**:

| Path | Owner |
|---|---|
| `index.js`, `handler.ts`, `state_machine.ts`, telemetry persistence, retry logic, IAM, deployment | `backend` (you) |
| `prompts/*.md`, `output_schema.json`, `escalation/signal_detectors.ts` | `inference-platform` |

Cross-agent changes require coordination via PR review.

## Owned Directories

```
backend/
├── lambdas/
│   ├── bedrock-router/                    # NEW — shared with inference-platform
│   │   ├── index.ts                        # YOU own
│   │   ├── handler.ts                      # YOU own
│   │   ├── state_machine.ts                # YOU own
│   │   ├── telemetry.ts                    # YOU own (writes model_call rows)
│   │   ├── prompts/                        # inference-platform owns
│   │   ├── escalation/                     # inference-platform owns signal_detectors.ts
│   │   ├── output_schema.json              # inference-platform owns
│   │   ├── package.json
│   │   └── __tests__/
│   ├── bedrock-vision/                    # NEW — shared with inference-platform
│   │   ├── index.ts                        # YOU own
│   │   ├── handler.ts                      # YOU own
│   │   ├── prompts/                        # inference-platform owns
│   │   └── package.json
│   ├── health-check/                      # NEW — entirely yours
│   │   ├── index.ts
│   │   └── package.json
│   │
│   ├── construct-fhir-batch/              # Existing (v1) — minor changes
│   ├── store-interaction/                 # Existing — accepts new optional fields
│   ├── evaluate-thresholds-batch/         # Existing
│   ├── check-missed-measurements/         # Existing
│   ├── check-daily-deadline/              # Existing
│   ├── manage-recommendations/            # Existing
│   ├── invite-caregiver/                  # Existing
│   ├── invite-doctor/                     # Existing
│   ├── accept-invite/                     # Existing
│   ├── post-confirmation/                 # Existing
│   ├── create-patient/                    # Existing
│   ├── threshold-crud/                    # Existing
│   ├── alert-crud/                        # Existing
│   ├── reminder-crud/                     # Existing
│   ├── notification-sender/               # Existing
│   ├── patient-summary/                   # Existing
│   ├── care-team/                         # Existing
│   └── device-token/                      # Existing
│
├── database/
│   └── migrations/
│       ├── V001__initial_schema.sql              # existing
│       ├── V002__xxx.sql                         # existing
│       ├── V003__xxx.sql                         # existing
│       ├── V004__conversational_system.sql      # existing (v1)
│       └── V005__bedrock_telemetry.sql          # NEW — model_call, cost_telemetry, alter interaction_session
│
└── shared/                                       # Optional shared utilities

infrastructure/terraform/                          # Shared with devops
├── modules/api_gateway/                           # Add new routes (coordinate with devops)
├── modules/lambda/                                # Add new Lambda definitions
└── modules/iam/                                   # Scoped Bedrock policies
```

**Removed in v2:**
- `lambdas/fetch-session-config/` — folded into `bedrock-router` (config now loaded server-side per turn)

You do NOT touch: `android/`, `web-portal/`, `inference-platform/`, prompt files, Guardrail config.

## Specifications

Refer to `docs/matika_spec_v2.md`:
- Section 3.2 — Lambda inventory
- Section 4 — API contracts (all endpoints you implement)
- Section 5.1 — DDL for V005 migration
- Section 6.4 — Structured output parsing contract (your responsibility)
- Section 7.6 — Health check protocol
- Section 11.4 — IAM scoping
- Section 11.6 — Per-patient rate limits

## Phase Assignments

### P0 — Foundation (Weeks 1–2)
- **[T-V2-020]** `bedrock-router` Lambda skeleton (Node.js 20, Bedrock SDK Lambda Layer). Wire `POST /conversation/turn`. Stub response.
- **[T-V2-021]** `bedrock-vision` Lambda skeleton. Wire `POST /conversation/photo-extract`.
- **[T-V2-022]** `health-check` Lambda — RDS ping + S3 list + Bedrock 1-token ping. Wire `GET /health`.

### P1 — Conversational Core (Weeks 3–6)
- **[T-V2-103]** Implement Bedrock invocation in `bedrock-router`: load prompts (from `inference-platform`), build cache breakpoints, call `InvokeModel`, surface response.
- **[T-V2-104]** Implement structured output parser per `output_schema.json` (owned by `inference-platform`). One-retry-on-failure logic; 503 on second failure.
- **[T-V2-105]** Implement state machine (reads `interaction_session` row at start, writes back at end).
- **[T-V2-106]** Wire `escalation/signal_detectors.ts` (from `inference-platform`) into routing decision.
- **[T-V2-107]** Telemetry: insert `model_call` row per Bedrock call with tokens, latency, cost.
- **[T-V2-108]** Cost-telemetry rollup Lambda (EventBridge daily) → `cost_telemetry` table.
- **[T-V2-110]** Implement `POST /conversation/turn-stream` with SSE (`InvokeModelWithResponseStream`).
- **[T-V2-111]** Streaming decision logic per spec §6.6.

### P2 — Vision + Escalation (Weeks 7–8)
- **[T-V2-210]** `bedrock-vision` business logic: load photo from S3, call Haiku vision, fallback to Sonnet on confidence < 0.80.
- **[T-V2-211]** Vision telemetry → `model_call` with `T2_VISION` / `T3_VISION` tier.
- **[T-V2-220]** Implausible-value escalation flow: plausibility-range check before model invocation; route to Sonnet with focused sub-prompt (sub-prompt owned by `inference-platform`).
- **[T-V2-222]** Wire Guardrails emergency-trigger to caregiver alert (SQS → notification-sender).

### P3 — Caregiver Experience (Weeks 9–11)
- **[T-V2-300]** Sonnet-default routing for `caregiver_config` and `caregiver_onboarding` session types.
- **[T-V2-302]** Protocol persistence — call existing v1 Lambda APIs.
- **[T-V2-310]** Verify v1 invite Lambdas still work end-to-end.

### P4 — Integration & Polish (Weeks 12–14)
- Per-patient rate limit enforcement (soft 100, hard 500 — env-tunable).
- Connectivity-loss handling: idempotency key on `/conversation/turn`; safe to retry mid-stream.
- Audit prompt cache hit rate from `model_call.cached_input_tokens`; surface in admin telemetry.

### P5 — Compliance & Pilot (Weeks 15–16)
- Verify `model_call.guardrail_blocked` is correctly flagged on Guardrail outputs.
- Verify per-patient PHI-touch log is queryable for compliance audits.

## V005 Migration Highlights

```sql
CREATE TABLE model_call (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES interaction_session(id),
    patient_id UUID NOT NULL REFERENCES patient(id),
    tier VARCHAR(16) NOT NULL CHECK (tier IN ('T2','T3','T2_VISION','T3_VISION')),
    model VARCHAR(64) NOT NULL,
    streamed BOOLEAN NOT NULL DEFAULT FALSE,
    guardrail_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    input_tokens INTEGER NOT NULL,
    cached_input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    inference_region VARCHAR(32) NOT NULL,
    escalation_reason VARCHAR(64),
    cost_usd NUMERIC(10,6) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE cost_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patient(id),
    day DATE NOT NULL,
    haiku_calls INTEGER NOT NULL DEFAULT 0,
    sonnet_calls INTEGER NOT NULL DEFAULT 0,
    vision_haiku_calls INTEGER NOT NULL DEFAULT 0,
    vision_sonnet_calls INTEGER NOT NULL DEFAULT 0,
    ocr_local_calls INTEGER NOT NULL DEFAULT 0,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_cached_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (patient_id, day)
);

ALTER TABLE interaction_session
    ADD COLUMN streaming_used BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN escalations_triggered JSONB,
    ADD COLUMN inference_region VARCHAR(32);
```

## API Routes (added in v2)

| Method | Path | Lambda | Auth |
|---|---|---|---|
| POST | `/conversation/turn` | bedrock-router | patient, caregiver |
| POST | `/conversation/turn-stream` (SSE) | bedrock-router | patient, caregiver |
| POST | `/conversation/photo-extract` | bedrock-vision | patient, caregiver |
| GET | `/health` | health-check | any authenticated |
| GET | `/admin/telemetry/cost` | (extension of patient-summary or new) | admin |
| GET | `/admin/telemetry/escalations` | (new admin handler) | admin |

All v1 routes (FHIR, observations, recommendations, parameter-configs, interactions, prompts, etc.) remain unchanged.

## Output Format Contract (with `inference-platform`)

LLM returns JSON inside `<output>...</output>` tags. Parser:
1. Extract JSON via tagged-block regex.
2. Validate against `output_schema.json` (provided by `inference-platform`).
3. On parse failure: retry once with stricter system-prompt note.
4. On second failure: return 503; record `parse_failure: true` in telemetry; flag for `inference-platform` review.

You do NOT modify the prompt or schema yourself. If parsing keeps failing, file an issue against `inference-platform`.

## Key Design Decisions

1. **Stateless turn handler**: Lambda is stateless per invocation. Session state lives in RDS; reads at start, writes at end. Idempotent under retry with idempotency key.
2. **Telemetry on every call**: `model_call` row per Bedrock invocation, including failed calls and Guardrail blocks. Critical for cost + audit.
3. **Cost computed at insert time**: `cost_usd` populated by the Lambda using current pricing; price changes are a code change, not a query change.
4. **FHIR construction unchanged**: `construct-fhir-batch` still receives extracted values from the app and writes to S3. The v2 difference: extracted values come from `bedrock-router`'s structured output rather than from the Mac Mini.
5. **Per-patient rate limits**: Enforced in `bedrock-router` before model invocation. Hard cap returns 429 + alerts caregiver.
6. **No prompt logic in Lambda code**: All prompt content lives in `inference-platform/`-owned files. Lambda loads, interpolates `{{var}}` placeholders, and sends to Bedrock.

## Dependencies

| What I need | From whom | When |
|---|---|---|
| Bedrock access + inference profiles | devops | P0 |
| Guardrail deployed | devops (config from inference-platform) | P0 |
| Provisioned concurrency on `bedrock-router` | devops | P0 |
| Prompt templates | inference-platform | P1 |
| `output_schema.json` | inference-platform | P1 |
| `signal_detectors.ts` | inference-platform | P1 |
| SSM port-forward for migration | devops | P0 |

| What I provide | To whom | When |
|---|---|---|
| `bedrock-router` + `bedrock-vision` + `health-check` Lambdas | android-app, qa-testing | P0/P1 |
| V005 migration | all (model_call queries) | P0 |
| `model_call` + `cost_telemetry` tables | qa-testing, web-portal (admin tab) | P1 |
| Per-patient rate limit | (compliance) | P4 |

## Testing

- Framework: Jest.
- Scope: state machine transitions, structured output parser (with malformed inputs), telemetry recording correctness, rate-limit enforcement, cost calculation, escalation routing decisions (using stub `signal_detectors`).
- Each Lambda has its own `__tests__/` directory.
- For prompt content correctness: defer to `inference-platform/eval/`. You only test that the Lambda *uses* the prompt correctly, not the prompt content.

## Constraints

- Node.js 20 runtime.
- Each Lambda has its own `package.json`.
- Storage in ap-south-1; inference cross-region (per spec §11.3).
- DB credentials from Secrets Manager.
- RDS access only via SSM port-forwarding through bastion.
- IAM scoped to specific Bedrock model + guardrail ARNs (no wildcards).
- Coordinate with `inference-platform` on all `bedrock-router/` and `bedrock-vision/` changes.
- Coordinate with `devops` on all `infrastructure/terraform/modules/` changes.

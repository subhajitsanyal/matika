# Agent: DevOps & Infrastructure

## Role

You are the **DevOps & Infrastructure** agent. You own AWS infrastructure (Terraform), Bedrock provisioning, CI/CD pipelines, monitoring/alerting, and deployment procedures. The v1 Mac Mini provisioning role is **gone in v2** — there is no household hardware to deploy.

## Owned Directories

```
infrastructure/terraform/
├── modules/
│   ├── api_gateway/                   # Shared with backend agent
│   ├── cognito/                       # Shared with backend agent
│   ├── lambda/                        # Shared with backend agent (provisioned concurrency on bedrock-router)
│   ├── s3/                            # FHIR + raw interactions buckets
│   ├── kms/
│   ├── bastion/                       # Existing
│   ├── rds/
│   ├── bedrock/                       # NEW in v2 — see below
│   │   ├── inference_profiles.tf      # Cross-region profile resources / data sources
│   │   ├── guardrail.tf               # Guardrail resource (config supplied by inference-platform)
│   │   └── variables.tf
│   └── monitoring/                    # NEW — CloudWatch alarms, dashboards, cost telemetry
│       ├── alarms.tf
│       ├── dashboards.tf
│       └── cost_dashboards.tf
└── environments/
    ├── dev/main.tf
    └── prod/main.tf

.github/workflows/
├── deploy-lambdas.yml
├── deploy-web-portal.yml
├── run-migrations.yml
├── run-tests.yml
└── verify-bedrock-quotas.yml          # NEW — periodic check that quotas are sufficient
```

You do NOT touch production application code in: `android/app/src/`, `web-portal/src/`, `backend/lambdas/` handler logic, or any `prompts/` directory (`inference-platform`'s).

## Specifications

Refer to `docs/matika_spec_v2.md`:
- Section 7.5 — Resource allocation (Lambda memory, provisioned concurrency, RDS sizing)
- Section 11.4 — IAM scoping for Bedrock
- Section 11.5 — Guardrails configuration (you deploy; `inference-platform` defines content)
- Section 14 — Deployment & Operations (your blueprint: Terraform changes, env vars, observability)

## Phase Assignments

### P0 — Foundation (Weeks 1–2)
- **[T-V2-001]** Verify AWS BAA covers Bedrock cross-region inference (escalate to AWS healthcare team if not).
- **[T-V2-002]** Submit Bedrock model access request for Claude Haiku 4.5 + Sonnet 4.x.
- **[T-V2-003]** Create Bedrock cross-region inference profiles (Haiku + Sonnet). Smoke test.
- **[T-V2-004]** Deploy Bedrock Guardrail (config from `inference-platform`).
- **[T-V2-005]** Submit Bedrock quota increase requests early (1–3 day SLA).
- **[T-V2-010]** Delete `mac-mini/` directory and any related artifacts.
- **[T-V2-022]** Wire `health-check` Lambda + `GET /health` route in API Gateway.
- **[T-V2-023]** Configure provisioned concurrency = 1 on `bedrock-router`.

### P2 — Vision + Escalation (Weeks 7–8)
- Deploy `bedrock-vision` Lambda routing.
- Wire EventBridge rules for v1-unchanged pipelines (`check-daily-deadline`, `check-missed-measurements`).

### P4 — Integration & Polish (Weeks 12–14)
- **[T-V2-420]** CloudWatch metrics + alarms:
  - `BedrockTtfTMs` P95 > SLO for 10 min → SNS
  - `BedrockTotalLatencyMs` P95 > SLO for 10 min → SNS
  - `GuardrailBlockRate` > 5% for 10 min → SNS
  - `EscalationRate` > adaptive baseline → SNS
  - `CostPerPatientPerDay` above adaptive baseline → SNS
  - Lambda error rate, cold-start rate (especially `bedrock-router`)
  - RDS CPU, free storage
  - Cross-region inference failover triggered → SNS (informational)
- **[T-V2-421]** Cost dashboard — daily per-patient Bedrock cost broken down by tier.
- **[T-V2-422]** Latency dashboard — P50/P95/P99 by tier and language.
- **[T-V2-431]** Tune `bedrock-router` provisioned concurrency based on observed cold-start rate.

### P5 — Compliance & Pilot (Weeks 15–16)
- **[T-V2-502]** Verify CloudTrail captures Bedrock invocations including cross-region inference profile activity.
- Pilot ops runbook: Bedrock failover procedure, Guardrail false-positive escalation, cost-spike response.
- S3 lifecycle verification (90d → IA, 365d → Glacier, 7yr → expire on raw audio; FHIR retention configurable).
- KMS rotation verification.
- Per-patient rate limit configuration in `bedrock-router` env vars (initial values: soft 100, hard 500; tune from telemetry).

## Removed in v2

- `mac-mini/deploy/` — entire directory.
- `mac-mini/deploy/provision.sh` — household setup script.
- `mac-mini/deploy/launchd/*.plist` — service definitions.
- `mac-mini/deploy/mdns/` — Bonjour scripts.
- `mac-mini/deploy/monitoring/` — log rotation, cron jobs.
- `/opt/carelog/` directory tree (no Mac Mini means no on-host filesystem layout to manage).
- "Pilot Mac Minis ready" P5 deliverable.

## Bedrock Configuration

| Resource | Identifier (illustrative) | Notes |
|---|---|---|
| Inference profile (Haiku) | `apac.anthropic.claude-haiku-4-5-v1:0` | Cross-region; primary ap-southeast-1, fallback us-east-1 |
| Inference profile (Sonnet) | `apac.anthropic.claude-sonnet-4-x-v1:0` | Same |
| Guardrail | One Matika guardrail; ARN passed to `bedrock-router` via env var | Config owned by `inference-platform` |
| Prompt cache | Enabled (Anthropic models on Bedrock support caching by default) | TTL 5 minutes |

## IAM (managed in `infrastructure/terraform/modules/iam/`)

`bedrock-router` Lambda execution role policy:
```json
{
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
  "Resource": [
    "arn:aws:bedrock:*::inference-profile/apac.anthropic.claude-haiku-4-5-v1:0",
    "arn:aws:bedrock:*::inference-profile/apac.anthropic.claude-sonnet-4-x-v1:0",
    "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-v1:0",
    "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-x-v1:0"
  ]
},
{
  "Effect": "Allow",
  "Action": ["bedrock:ApplyGuardrail"],
  "Resource": "arn:aws:bedrock:ap-south-1:{account}:guardrail/{matika-guardrail-id}"
}
```

No `bedrock:*` wildcards. `bedrock-vision` gets a similar policy scoped to vision-capable models.

## Environment Variables (`bedrock-router` Lambda)

```
BEDROCK_HAIKU_MODEL_ID=apac.anthropic.claude-haiku-4-5-v1:0
BEDROCK_SONNET_MODEL_ID=apac.anthropic.claude-sonnet-4-x-v1:0
BEDROCK_GUARDRAIL_ID={matika-guardrail-id}
BEDROCK_GUARDRAIL_VERSION={version}
INFERENCE_PROFILE_REGION=ap-southeast-1
INFERENCE_PROFILE_FALLBACK_REGION=us-east-1
PROMPT_CACHE_TTL_SECONDS=300
SOFT_RATE_LIMIT_PER_PATIENT=100
HARD_RATE_LIMIT_PER_PATIENT=500
SYSTEM_PROMPT_VERSION=v2.0
```

## Cloud Deployment Pipeline

```
1. Bedrock setup    : terraform apply on bedrock module (one-time per env; idempotent)
2. Infrastructure   : terraform apply (api_gateway + lambda + iam + monitoring + ...)
3. Lambda packaging : for each lambda: npm install --production → zip
4. DB migration     : SSM port-forward → flyway migrate (V005 adds model_call + cost_telemetry)
5. Web portal       : npm install → npm run build → deploy dist/ to S3+CloudFront
```

Rollback: model identifiers are env vars. Swap a model version in the Lambda alias config to roll back. Bedrock inference profile cannot be rolled back; if a regional issue, swap `INFERENCE_PROFILE_REGION` env var.

## Dependencies

| What I need | From whom | When |
|---|---|---|
| Guardrail JSON config | inference-platform | P0 |
| Lambda code packages | backend | P0+ |
| Web portal build artifact | web-portal | P3+ |
| App package + signing keys | (release process) | P5 |

| What I provide | To whom | When |
|---|---|---|
| Bedrock access + inference profiles | backend, inference-platform | P0 |
| `bedrock-router` provisioned concurrency | backend | P0 |
| Guardrail deployed | inference-platform | P0 |
| EventBridge rules deployed | backend | P3 |
| CloudWatch alarms + dashboards | qa-testing (compliance), business stakeholders | P4 |

## Constraints

- Storage in ap-south-1 (DPDP). Inference cross-region (ap-southeast-1 / us-east-1) under AWS BAA.
- Terraform for all AWS infrastructure. No click-ops.
- All S3 buckets: SSE-KMS, TLS enforced, public access blocked.
- RDS access via SSM port-forwarding through bastion only.
- DB credentials from Secrets Manager.
- CloudTrail: multi-region, 7-year immutable retention with Object Lock.
- KMS auto-rotation enabled.
- Bedrock model IDs swapped via env var, not code change — enables zero-downtime model rollback.

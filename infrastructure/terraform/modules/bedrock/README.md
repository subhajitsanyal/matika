# Bedrock Terraform Module (scaffold)

**Status:** Scaffold only — all resources commented out until P0 model access is granted (T-V2-002).

This module provisions:
- Bedrock cross-region inference profiles (Claude Haiku 4.5 + Sonnet 4.x).
- Bedrock Guardrail (config content authored by `inference-platform` agent).

## Activation in P0

1. `T-V2-002` — model access approved.
2. `T-V2-003` — uncomment `inference_profiles.tf`.
3. `T-V2-004` — uncomment `guardrail.tf` with content from `inference-platform`.
4. `terraform plan` and `apply` per environment.

## Ownership

| Path | Owner |
|---|---|
| `*.tf` | `devops` |
| Guardrail content (denied topics, PII filters, custom triggers) | `inference-platform` |

See `AGENTS.md` §3 for the shared-directory protocol.

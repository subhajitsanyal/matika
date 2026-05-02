# Matika v2 — Bedrock module (scaffold)
#
# Owner: devops agent. Configuration content (Guardrail JSON, escalation rules)
# owned by inference-platform agent — see AGENTS.md §3.
#
# Real resources land in P0 per docs/matika_implementation_plan_v2.md
# T-V2-002 (model access), T-V2-003 (inference profiles), T-V2-004 (Guardrails).
#
# All resources kept commented out until model access is granted, so terraform
# validate passes without provisioning.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Matika v2 — Bedrock module
#
# Owner: devops agent. Guardrail content (denied topics, PII filters,
# emergency triggers) authored by inference-platform agent — see AGENTS.md §3.
#
# v2.0 design decision (Q1, decided 2026-05-02): in-region direct invocation
# for Claude Haiku 4.5 + Sonnet 4.6 in ap-south-1. Cross-region inference
# profiles are NOT used — Anthropic models are now native to ap-south-1,
# which keeps DPDP Act data residency clean and removes one IAM hop.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.30"
    }
  }
}

# Bedrock foundation-model ARNs are fixed by AWS. We pin them here for use
# in the IAM policies that scope `bedrock:InvokeModel` to specific models
# rather than `*` (spec §11.4).
locals {
  haiku_model_arn  = "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.haiku_model_id}"
  sonnet_model_arn = "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.sonnet_model_id}"
}

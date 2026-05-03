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

# Bedrock invocation ARNs.
#
# Claude Haiku 4.5 and Sonnet 4.6 are only available via SYSTEM_DEFINED
# inference profiles in this account — direct on-demand invocation of the
# foundation-model ID returns "Invocation of model ID ... with on-demand
# throughput isn't supported" in ap-south-1 (verified 2026-05-02).
#
# Only `global.*` profiles exist for these two models; `apac.*` profiles
# exist for older Claude versions only. Using `global.*` widens the
# routing pool beyond APAC. DPDP implication tracked as follow-up
# (T-V2-???); revisit once AWS adds an APAC profile for Haiku 4.5.
#
# Each invoke needs IAM permission on:
#   - the inference profile ARN (region-specific, in this account), AND
#   - the underlying foundation model ARN (wildcard region — global profiles
#     fan out across multiple regions, each invoking the foundation model
#     ARN under the local region).
data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id

  haiku_inference_profile_arn  = "arn:aws:bedrock:${var.aws_region}:${local.account_id}:inference-profile/${var.haiku_model_id}"
  sonnet_inference_profile_arn = "arn:aws:bedrock:${var.aws_region}:${local.account_id}:inference-profile/${var.sonnet_model_id}"

  # Foundation model IDs that the global inference profiles front. These are
  # fixed by the model identity — strip the `global.` prefix from the inference
  # profile ID. Region wildcarded because global profiles invoke across regions.
  haiku_foundation_model_arn  = "arn:aws:bedrock:*::foundation-model/${replace(var.haiku_model_id, "global.", "")}"
  sonnet_foundation_model_arn = "arn:aws:bedrock:*::foundation-model/${replace(var.sonnet_model_id, "global.", "")}"
}

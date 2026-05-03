output "guardrail_id" {
  description = "ID of the Matika Bedrock Guardrail"
  value       = aws_bedrock_guardrail.matika.guardrail_id
}

output "guardrail_arn" {
  description = "ARN of the Matika Bedrock Guardrail"
  value       = aws_bedrock_guardrail.matika.guardrail_arn
}

output "guardrail_version" {
  description = "Pinned numeric version of the Matika Bedrock Guardrail"
  value       = aws_bedrock_guardrail_version.matika.version
}

output "haiku_model_arn" {
  description = "Inference-profile ARN for Claude Haiku 4.5 (for IAM scoping). Lambda IAM also needs the foundation-model ARN — see haiku_foundation_model_arn."
  value       = local.haiku_inference_profile_arn
}

output "sonnet_model_arn" {
  description = "Inference-profile ARN for Claude Sonnet 4.6 (for IAM scoping). Lambda IAM also needs the foundation-model ARN — see sonnet_foundation_model_arn."
  value       = local.sonnet_inference_profile_arn
}

output "haiku_foundation_model_arn" {
  description = "Wildcard-region foundation-model ARN for the model that the Haiku 4.5 inference profile fronts. Required alongside the inference-profile ARN in IAM."
  value       = local.haiku_foundation_model_arn
}

output "sonnet_foundation_model_arn" {
  description = "Wildcard-region foundation-model ARN for the model that the Sonnet 4.6 inference profile fronts."
  value       = local.sonnet_foundation_model_arn
}

output "haiku_model_id" {
  description = "Bedrock foundation-model ID for Claude Haiku 4.5"
  value       = var.haiku_model_id
}

output "sonnet_model_id" {
  description = "Bedrock foundation-model ID for Claude Sonnet 4.6"
  value       = var.sonnet_model_id
}

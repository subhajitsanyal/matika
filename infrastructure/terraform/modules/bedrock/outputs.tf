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
  description = "Foundation-model ARN for Claude Haiku 4.5 (for IAM scoping)"
  value       = local.haiku_model_arn
}

output "sonnet_model_arn" {
  description = "Foundation-model ARN for Claude Sonnet 4.6 (for IAM scoping)"
  value       = local.sonnet_model_arn
}

output "haiku_model_id" {
  description = "Bedrock foundation-model ID for Claude Haiku 4.5"
  value       = var.haiku_model_id
}

output "sonnet_model_id" {
  description = "Bedrock foundation-model ID for Claude Sonnet 4.6"
  value       = var.sonnet_model_id
}

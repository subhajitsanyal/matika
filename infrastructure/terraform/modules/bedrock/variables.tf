variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region (Bedrock + Lambda)"
  type        = string
  default     = "ap-south-1"
}

variable "haiku_model_id" {
  description = "Bedrock model ID passed to InvokeModel for Claude Haiku 4.5. Use the `global.*` inference profile — direct foundation-model ID isn't supported on-demand for Haiku 4.5."
  type        = string
  default     = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "sonnet_model_id" {
  description = "Bedrock model ID passed to InvokeModel for Claude Sonnet 4.6. Use the `global.*` inference profile."
  type        = string
  default     = "global.anthropic.claude-sonnet-4-6"
}

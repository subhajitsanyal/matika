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
  description = "Bedrock foundation-model ID for Claude Haiku 4.5"
  type        = string
  default     = "anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "sonnet_model_id" {
  description = "Bedrock foundation-model ID for Claude Sonnet 4.6"
  type        = string
  default     = "anthropic.claude-sonnet-4-6"
}

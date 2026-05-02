variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "haiku_inference_profile_id" {
  description = "Bedrock inference profile ID for Claude Haiku 4.5 (cross-region)"
  type        = string
  default     = "apac.anthropic.claude-haiku-4-5-v1:0"
}

variable "sonnet_inference_profile_id" {
  description = "Bedrock inference profile ID for Claude Sonnet 4.x (cross-region)"
  type        = string
  default     = "apac.anthropic.claude-sonnet-4-x-v1:0"
}

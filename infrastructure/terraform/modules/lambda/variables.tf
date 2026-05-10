variable "environment" {
  type = string
}

variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

# VPC
variable "private_subnet_ids" {
  type = list(string)
}

variable "lambda_security_group_id" {
  type = string
}

# RDS / Secrets Manager
variable "db_secret_arn" {
  type = string
}

variable "db_secret_name" {
  type = string
}

variable "rds_kms_key_arn" {
  type = string
}

# Cognito
variable "cognito_user_pool_arn" {
  type = string
}

# S3
variable "documents_bucket_name" {
  type = string
}

variable "documents_bucket_arn" {
  type = string
}

variable "s3_kms_key_arn" {
  type = string
}

# API Gateway
variable "api_execution_arn" {
  type = string
}

# Email
variable "from_email" {
  type    = string
  default = ""
}

# Domain
variable "domain_name" {
  description = "Base domain name for email templates and links"
  type        = string
  default     = "carelog.com"
}

# SQS
variable "alerts_queue_arn" {
  description = "ARN of the SQS alerts queue"
  type        = string
}

variable "alerts_queue_url" {
  description = "URL of the SQS alerts queue"
  type        = string
}

variable "sqs_kms_key_arn" {
  description = "ARN of the KMS key for SQS encryption"
  type        = string
}

# S3 raw interactions bucket
variable "raw_interactions_bucket_name" {
  description = "Name of S3 bucket for raw interaction storage"
  type        = string
}

# Lambda source path
variable "lambdas_source_path" {
  type = string
}

# ============================================================
# V2 — Bedrock-backed Lambdas
# ============================================================

variable "bedrock_haiku_model_arn" {
  description = "Foundation-model ARN for Claude Haiku 4.5 (IAM scoping)"
  type        = string
  default     = ""
}

variable "bedrock_sonnet_model_arn" {
  description = "Foundation-model ARN for Claude Sonnet 4.6 (IAM scoping)"
  type        = string
  default     = ""
}

variable "bedrock_haiku_foundation_model_arn" {
  description = "Wildcard-region foundation-model ARN underlying the Haiku 4.5 inference profile (required alongside the inference-profile ARN in IAM)"
  type        = string
  default     = ""
}

variable "bedrock_sonnet_foundation_model_arn" {
  description = "Wildcard-region foundation-model ARN underlying the Sonnet 4.6 inference profile"
  type        = string
  default     = ""
}

variable "bedrock_guardrail_arn" {
  description = "ARN of the Matika Bedrock Guardrail"
  type        = string
  default     = ""
}

variable "bedrock_guardrail_id" {
  description = "ID of the Matika Bedrock Guardrail (env var)"
  type        = string
  default     = ""
}

variable "bedrock_guardrail_version" {
  description = "Pinned numeric version of the Matika Bedrock Guardrail (env var)"
  type        = string
  default     = ""
}

variable "bedrock_haiku_model_id" {
  description = "Bedrock foundation-model ID for Claude Haiku 4.5 (env var)"
  type        = string
  default     = "anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "bedrock_sonnet_model_id" {
  description = "Bedrock foundation-model ID for Claude Sonnet 4.6 (env var)"
  type        = string
  default     = "anthropic.claude-sonnet-4-6"
}

variable "bedrock_router_provisioned_concurrency" {
  description = "Provisioned-concurrency count for bedrock-router (keeps cold-start out of patient latency)"
  type        = number
  default     = 1
}

variable "soft_rate_limit_per_patient" {
  description = "Soft per-patient daily turn limit (warns; no hard cutoff)"
  type        = number
  default     = 100
}

variable "hard_rate_limit_per_patient" {
  description = "Hard per-patient daily turn limit (rejects further turns)"
  type        = number
  default     = 500
}

# F2 — sweep window for the expire-stale-sessions cron lambda. Sessions
# whose updated_at is older than this many minutes get flipped from
# in_progress to incomplete on the next sweep.
variable "session_idle_minutes" {
  description = "Idle window before the F2 cron sweep marks an in_progress interaction_sessions row as incomplete"
  type        = number
  default     = 30
}

# F17 — SNS Platform Application ARNs. Threaded through to device-token
# and notification-sender as ANDROID_PLATFORM_ARN / IOS_PLATFORM_ARN env
# vars. Default empty so envs without provisioned Platform Apps (dev
# today, blocked on FCM service-account JSON) still terraform-apply
# cleanly; both lambdas treat empty as "no SNS transport, store/skip
# accordingly". Wire to module.sns.android_platform_application_arn /
# ios_platform_application_arn once the SNS module is instantiated.
variable "android_platform_arn" {
  description = "SNS Platform Application ARN for Android FCM. Empty when unprovisioned; lambdas degrade to NULL endpoint_arn / no_transport_or_no_device_token."
  type        = string
  default     = ""
}

variable "ios_platform_arn" {
  description = "SNS Platform Application ARN for iOS APNs. Empty when unprovisioned (same semantics as android_platform_arn)."
  type        = string
  default     = ""
}

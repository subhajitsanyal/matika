# CareLog Infrastructure - Variables
#
# This file defines all input variables for the CareLog infrastructure.

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "aws_region" {
  description = "AWS region for primary deployment"
  type        = string
  default     = "ap-south-1"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24", "10.0.13.0/24"]
}

# Domain
variable "domain_name" {
  description = "Base domain name for the application (used in Cognito callbacks, CORS, email templates)"
  type        = string
  default     = "carelog.com"
}

# RDS variables (T-009)
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "db_name" {
  description = "Name of the database"
  type        = string
  default     = "carelog"
}

variable "db_username" {
  description = "Master username for the database"
  type        = string
  default     = "carelog_admin"
  sensitive   = true
}

variable "rds_multi_az" {
  description = "Enable Multi-AZ for the RDS primary. True for prod (HA + automatic failover), false for dev (cost)."
  type        = bool
  default     = false
}

variable "rds_deletion_protection" {
  description = "Enable deletion protection on the RDS instance. True for prod."
  type        = bool
  default     = false
}

# S3 variables (T-007)
variable "s3_bucket_prefix" {
  description = "Prefix for S3 bucket names"
  type        = string
  default     = "carelog"
}

# Feature flags
variable "enable_healthlake" {
  description = "Enable AWS HealthLake (may take time to provision)"
  type        = bool
  default     = false
}

variable "enable_bastion" {
  description = "Enable bastion EC2 instance for SSM port-forwarding to RDS"
  type        = bool
  default     = false
}

# Monitoring
variable "alert_email" {
  description = "Email address for operator alert notifications (CloudWatch alarms)"
  type        = string
  default     = ""
}

# SES Email (optional — defaults to Cognito built-in email with 50/day limit)
variable "ses_email_arn" {
  description = "ARN of SES verified email identity for Cognito (empty = use Cognito default)"
  type        = string
  default     = ""
}

variable "ses_from_email" {
  description = "SES verified sender email address for Cognito"
  type        = string
  default     = ""
}

# ============================================================
# V2 — Bedrock-backed Lambdas
# ============================================================

variable "bedrock_haiku_model_id" {
  description = "Bedrock model ID for Claude Haiku 4.5. Defaults to the `global.*` inference profile — direct foundation-model on-demand isn't supported for Haiku 4.5."
  type        = string
  default     = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "bedrock_sonnet_model_id" {
  description = "Bedrock model ID for Claude Sonnet 4.6. Defaults to the `global.*` inference profile."
  type        = string
  default     = "global.anthropic.claude-sonnet-4-6"
}

variable "bedrock_router_provisioned_concurrency" {
  description = "Provisioned-concurrency count for matika-<env>-bedrock-router. Default 0 — bump to ≥1 after a Lambda concurrent-executions quota increase has been granted (AWS default account quota is only 10)."
  type        = number
  default     = 0
}

variable "soft_rate_limit_per_patient" {
  description = "Soft per-patient daily turn limit"
  type        = number
  default     = 100
}

variable "hard_rate_limit_per_patient" {
  description = "Hard per-patient daily turn limit"
  type        = number
  default     = 500
}

# F17 — push transport. Empty string means "transport not configured"; the
# notification-sender + device-token lambdas log a warning and skip SNS
# publish on send / SNS endpoint registration on token-write. Provisioned
# in dev 2026-05-11 via `aws sns create-platform-application` (see
# carelog-dev/fcm-service-account in Secrets Manager for the credential).
variable "android_platform_arn" {
  description = "SNS Platform Application ARN for Android FCM token-based credentials. Empty string disables Android push."
  type        = string
  default     = ""
}

variable "ios_platform_arn" {
  description = "SNS Platform Application ARN for iOS APNs. Empty string disables iOS push (current default — APNs work is out of scope for v2.0 Android-focus)."
  type        = string
  default     = ""
}

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

# Cognito variables (T-004)
variable "cognito_user_pool_name" {
  description = "Name of the Cognito user pool"
  type        = string
  default     = "carelog-users"
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

variable "enable_waf" {
  description = "Enable AWS WAF for API Gateway"
  type        = bool
  default     = true
}

variable "enable_bastion" {
  description = "Enable bastion EC2 instance for SSM port-forwarding to RDS"
  type        = bool
  default     = false
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

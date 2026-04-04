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

# Lambda source path
variable "lambdas_source_path" {
  type = string
}

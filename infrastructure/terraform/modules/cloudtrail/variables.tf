variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "carelog"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "documents_bucket_name" {
  description = "S3 bucket name for patient documents (for data event logging)"
  type        = string
}

variable "sns_alert_topic_arn" {
  description = "SNS topic ARN for security alerts"
  type        = string
}

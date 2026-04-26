# CareLog EventBridge Module - Variables

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
}

variable "check_daily_deadline_lambda_arn" {
  description = "ARN of the check-daily-deadline Lambda function"
  type        = string
}

variable "check_daily_deadline_lambda_name" {
  description = "Name of the check-daily-deadline Lambda function (for permission resource)"
  type        = string
}

variable "check_missed_measurements_lambda_arn" {
  description = "ARN of the check-missed-measurements Lambda function"
  type        = string
}

variable "check_missed_measurements_lambda_name" {
  description = "Name of the check-missed-measurements Lambda function (for permission resource)"
  type        = string
}

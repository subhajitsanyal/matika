# CareLog SQS Module - Variables

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "documents_bucket_id" {
  description = "ID of the documents S3 bucket for event notifications"
  type        = string
  default     = ""
}

variable "documents_bucket_arn" {
  description = "ARN of the documents S3 bucket for event notifications"
  type        = string
  default     = ""
}

# CareLog SQS Module - Variables

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "enable_s3_notifications" {
  description = "Whether to enable S3 bucket notifications for document processing"
  type        = bool
  default     = true
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

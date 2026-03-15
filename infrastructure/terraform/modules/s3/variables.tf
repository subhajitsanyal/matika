# CareLog S3 Module - Variables

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "bucket_prefix" {
  description = "Prefix for S3 bucket names"
  type        = string
  default     = "carelog"
}

variable "cors_origins" {
  description = "Allowed CORS origins for presigned URL uploads"
  type        = list(string)
  default     = ["*"]
}

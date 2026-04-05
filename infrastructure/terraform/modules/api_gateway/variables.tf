# CareLog API Gateway Module - Variables

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "cognito_user_pool_arn" {
  description = "ARN of the Cognito user pool for authorization"
  type        = string
}

variable "cors_origin" {
  description = "Allowed CORS origin"
  type        = string
  default     = "*"
}

variable "throttle_burst_limit" {
  description = "API throttling burst limit"
  type        = number
  default     = 100
}

variable "throttle_rate_limit" {
  description = "API throttling rate limit (requests per second)"
  type        = number
  default     = 50
}

variable "quota_limit" {
  description = "Daily API quota limit"
  type        = number
  default     = 10000
}

# Lambda invoke ARNs
variable "create_patient_invoke_arn" {
  type    = string
  default = ""
}

variable "sync_observation_invoke_arn" {
  type    = string
  default = ""
}

variable "bulk_sync_invoke_arn" {
  type    = string
  default = ""
}

variable "presigned_url_invoke_arn" {
  type    = string
  default = ""
}

variable "invite_attendant_invoke_arn" {
  type    = string
  default = ""
}

variable "invite_doctor_invoke_arn" {
  type    = string
  default = ""
}

variable "accept_invite_invoke_arn" {
  type    = string
  default = ""
}

variable "care_team_invoke_arn" {
  type    = string
  default = ""
}

variable "patient_summary_invoke_arn" {
  type    = string
  default = ""
}

variable "get_observations_invoke_arn" {
  type    = string
  default = ""
}

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

variable "fetch_session_config_invoke_arn" {
  type    = string
  default = ""
}

variable "store_interaction_invoke_arn" {
  type    = string
  default = ""
}

variable "construct_fhir_batch_invoke_arn" {
  type    = string
  default = ""
}

variable "manage_recommendations_invoke_arn" {
  type    = string
  default = ""
}

variable "manage_parameter_configs_invoke_arn" {
  type    = string
  default = ""
}

variable "manage_interactions_invoke_arn" {
  type    = string
  default = ""
}

variable "manage_prompts_invoke_arn" {
  type    = string
  default = ""
}

# ============================================================
# V2 — Bedrock-backed Lambdas
# ============================================================

variable "bedrock_router_invoke_arn" {
  description = "Invoke ARN for matika-<env>-bedrock-router (POST /conversation/turn, /conversation/turn-stream)"
  type        = string
  default     = ""
}

variable "bedrock_vision_invoke_arn" {
  description = "Invoke ARN for matika-<env>-bedrock-vision (POST /conversation/photo-extract)"
  type        = string
  default     = ""
}

variable "health_check_invoke_arn" {
  description = "Invoke ARN for matika-<env>-health-check (GET /health)"
  type        = string
  default     = ""
}

variable "photo_presign_invoke_arn" {
  description = "Invoke ARN for matika-<env>-photo-presign (POST /conversation/photo-presign)"
  type        = string
  default     = ""
}

# F2 — explicit-close endpoint
variable "end_session_invoke_arn" {
  description = "Invoke ARN for matika-<env>-end-session (POST /sessions/{sessionId}/end)"
  type        = string
  default     = ""
}

# F17 — device-token registration endpoint
variable "device_token_invoke_arn" {
  description = "Invoke ARN for matika-<env>-device-token (POST/DELETE /device-tokens)"
  type        = string
  default     = ""
}

# DPDP right-to-erasure — delete-patient cascade.
variable "delete_patient_invoke_arn" {
  description = "Invoke ARN for carelog-<env>-delete-patient (DELETE /patients/{patientId}). Wired live since 2026-05-12; lambda function not yet in terraform state (cognito-drift class — pending reconciliation)."
  type        = string
  default     = ""
}

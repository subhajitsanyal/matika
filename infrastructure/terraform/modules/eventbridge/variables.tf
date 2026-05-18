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

# ============================================================
# V2 — Bedrock cost-telemetry daily rollup
# ============================================================

variable "cost_telemetry_rollup_lambda_arn" {
  description = "ARN of matika-<env>-cost-telemetry-rollup Lambda (EventBridge target)"
  type        = string
}

variable "cost_telemetry_rollup_lambda_name" {
  description = "Function name of matika-<env>-cost-telemetry-rollup Lambda (for permission resource)"
  type        = string
}

# ============================================================
# F2 — session sweep
# ============================================================

variable "expire_stale_sessions_lambda_arn" {
  description = "ARN of matika-<env>-expire-stale-sessions Lambda (EventBridge target for hourly F2 sweep)"
  type        = string
}

variable "expire_stale_sessions_lambda_name" {
  description = "Function name of matika-<env>-expire-stale-sessions Lambda (for permission resource)"
  type        = string
}

# ============================================================
# Phase 2 telemetry — vital coverage rollup (§4.7, first of the
# rollup-lambda set; hourly cron, idempotent re-runs)
# ============================================================

variable "vital_coverage_rollup_lambda_arn" {
  description = "ARN of carelog-<env>-vital-coverage-rollup Lambda (EventBridge target for hourly Phase 2 telemetry rollup)"
  type        = string
}

variable "vital_coverage_rollup_lambda_name" {
  description = "Function name of carelog-<env>-vital-coverage-rollup Lambda (for permission resource)"
  type        = string
}

# Stream A5 — three more Phase 2 telemetry rollups (§4.7). Same hourly
# cadence, same idempotent ON CONFLICT upsert pattern.
variable "conversation_session_rollup_lambda_arn"  { type = string }
variable "conversation_session_rollup_lambda_name" { type = string }
variable "alert_flow_rollup_lambda_arn"            { type = string }
variable "alert_flow_rollup_lambda_name"           { type = string }
variable "patient_engagement_rollup_lambda_arn"    { type = string }
variable "patient_engagement_rollup_lambda_name"   { type = string }

# ============================================================
# F47 — Cognito nightly snapshot (daily cron 02:00 UTC, DR/RPO closure)
# ============================================================

variable "cognito_snapshot_lambda_arn" {
  description = "ARN of matika-<env>-cognito-snapshot Lambda (EventBridge target for nightly snapshot)"
  type        = string
}

variable "cognito_snapshot_lambda_name" {
  description = "Function name of matika-<env>-cognito-snapshot Lambda (for permission resource)"
  type        = string
}

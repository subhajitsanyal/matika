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

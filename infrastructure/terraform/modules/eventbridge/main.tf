# CareLog EventBridge Module
#
# Deploys scheduled EventBridge rules that trigger Lambda functions
# for proactive health monitoring checks.

# ============================================================
# Rule 1: check-daily-deadline (every 15 minutes)
# ============================================================

resource "aws_cloudwatch_event_rule" "check_daily_deadline" {
  name                = "carelog-check-daily-deadline-${var.environment}"
  description         = "Checks for patients whose daily measurement deadline has passed"
  schedule_expression = "rate(15 minutes)"
}

resource "aws_cloudwatch_event_target" "check_daily_deadline" {
  rule = aws_cloudwatch_event_rule.check_daily_deadline.name
  arn  = var.check_daily_deadline_lambda_arn
}

resource "aws_lambda_permission" "check_daily_deadline_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.check_daily_deadline_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.check_daily_deadline.arn
}

# ============================================================
# Rule 2: check-missed-measurements (every hour)
# ============================================================

resource "aws_cloudwatch_event_rule" "check_missed_measurements" {
  name                = "carelog-check-missed-measurements-${var.environment}"
  description         = "Scans for overdue measurements based on configured frequencies"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "check_missed_measurements" {
  rule = aws_cloudwatch_event_rule.check_missed_measurements.name
  arn  = var.check_missed_measurements_lambda_arn
}

resource "aws_lambda_permission" "check_missed_measurements_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.check_missed_measurements_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.check_missed_measurements.arn
}

# ============================================================
# Rule 3: expire-stale-sessions (F2 — every hour)
#
# Closes interaction_sessions rows that have been sitting in
# status='in_progress' for longer than SESSION_IDLE_MINUTES (default
# 30). Catches app crashes, force-stops, network drops, and OS-killed
# processes — paths the LLM-driven terminus and explicit-close
# endpoints can't reach. Hourly cadence is fine because the lambda's
# own staleness check is bounded by SESSION_IDLE_MINUTES, not by
# how often it runs.
# ============================================================

resource "aws_cloudwatch_event_rule" "expire_stale_sessions" {
  name                = "matika-expire-stale-sessions-${var.environment}"
  description         = "F2 — flips long-idle interaction_sessions rows from in_progress to incomplete"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "expire_stale_sessions" {
  rule = aws_cloudwatch_event_rule.expire_stale_sessions.name
  arn  = var.expire_stale_sessions_lambda_arn
}

resource "aws_lambda_permission" "expire_stale_sessions_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.expire_stale_sessions_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.expire_stale_sessions.arn
}

# ============================================================
# Rule 4: vital-coverage-rollup (Phase 2 telemetry, §4.7)
#
# Hourly recomputation of vital_coverage_daily for today + yesterday
# (in each patient's tz) across every active parameter_config.
# Idempotent re-runs are by design — yesterday's actual_count can
# change retroactively when observations sync late, and today's row
# updates as the day progresses. See
# backend/lambdas/vital-coverage-rollup/index.js.
# ============================================================

resource "aws_cloudwatch_event_rule" "vital_coverage_rollup" {
  name                = "carelog-vital-coverage-rollup-${var.environment}"
  description         = "Phase 2 telemetry — hourly upsert into vital_coverage_daily"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "vital_coverage_rollup" {
  rule = aws_cloudwatch_event_rule.vital_coverage_rollup.name
  arn  = var.vital_coverage_rollup_lambda_arn
}

resource "aws_lambda_permission" "vital_coverage_rollup_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.vital_coverage_rollup_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.vital_coverage_rollup.arn
}

# ============================================================
# Rules 5/6/7: Stream A5 — Phase 2 telemetry rollups #2-4 (§4.7)
#
# Same hourly cadence as vital_coverage_rollup. Each idempotent on
# re-run; recomputes today + yesterday on every fire so late-arriving
# data lands in the rollup tables without backfill.
# ============================================================

resource "aws_cloudwatch_event_rule" "conversation_session_rollup" {
  name                = "carelog-conversation-session-rollup-${var.environment}"
  description         = "Phase 2 telemetry — hourly upsert into conversation_session_daily"
  schedule_expression = "rate(1 hour)"
}
resource "aws_cloudwatch_event_target" "conversation_session_rollup" {
  rule = aws_cloudwatch_event_rule.conversation_session_rollup.name
  arn  = var.conversation_session_rollup_lambda_arn
}
resource "aws_lambda_permission" "conversation_session_rollup_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.conversation_session_rollup_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.conversation_session_rollup.arn
}

resource "aws_cloudwatch_event_rule" "alert_flow_rollup" {
  name                = "carelog-alert-flow-rollup-${var.environment}"
  description         = "Phase 2 telemetry — hourly upsert into alert_flow_daily"
  schedule_expression = "rate(1 hour)"
}
resource "aws_cloudwatch_event_target" "alert_flow_rollup" {
  rule = aws_cloudwatch_event_rule.alert_flow_rollup.name
  arn  = var.alert_flow_rollup_lambda_arn
}
resource "aws_lambda_permission" "alert_flow_rollup_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.alert_flow_rollup_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.alert_flow_rollup.arn
}

resource "aws_cloudwatch_event_rule" "patient_engagement_rollup" {
  name                = "carelog-patient-engagement-rollup-${var.environment}"
  description         = "Phase 2 telemetry — hourly upsert into patient_engagement_daily"
  schedule_expression = "rate(1 hour)"
}
resource "aws_cloudwatch_event_target" "patient_engagement_rollup" {
  rule = aws_cloudwatch_event_rule.patient_engagement_rollup.name
  arn  = var.patient_engagement_rollup_lambda_arn
}
resource "aws_lambda_permission" "patient_engagement_rollup_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.patient_engagement_rollup_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.patient_engagement_rollup.arn
}

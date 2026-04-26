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

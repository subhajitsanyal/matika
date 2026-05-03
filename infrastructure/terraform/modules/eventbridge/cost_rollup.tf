# Matika v2 — daily cost-telemetry rollup
#
# Fires once per day at 01:00 UTC (06:30 IST) — late enough that the previous
# UTC day is fully closed but early enough that morning ops queries see
# yesterday's totals. Aggregates per-turn rows from `model_call` into
# `cost_telemetry_daily`.
#
# Spec: docs/matika_spec_v2.md §13.4.

resource "aws_cloudwatch_event_rule" "cost_telemetry_rollup" {
  name                = "matika-${var.environment}-cost-rollup-daily"
  description         = "Daily rollup of model_call rows into cost_telemetry_daily (Matika v2)"
  schedule_expression = "cron(0 1 * * ? *)"
}

resource "aws_cloudwatch_event_target" "cost_telemetry_rollup" {
  rule = aws_cloudwatch_event_rule.cost_telemetry_rollup.name
  arn  = var.cost_telemetry_rollup_lambda_arn
}

resource "aws_lambda_permission" "cost_telemetry_rollup_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.cost_telemetry_rollup_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.cost_telemetry_rollup.arn
}

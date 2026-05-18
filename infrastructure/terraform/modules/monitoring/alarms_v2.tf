# V2 (Bedrock-backed) alarm overlay.
#
# The generic per-function lambda_error_rate alarm in main.tf already
# covers every v2 Lambda (they're members of var.lambda_function_names).
# This file adds the v2-specific signals that aren't generic:
#   1. Latency: bedrock-router and bedrock-vision are user-facing voice
#      hops. p99 latency rising past the spec budget is the earliest
#      sign of regression — much faster than waiting for error-rate to
#      tip over.
#   2. Throttles: hitting the Lambda concurrent-execution quota
#      manifests as throttles, not errors. Worth its own alarm so the
#      operator can request a quota increase before users notice.
#   3. /health 5xx: when /health returns 503 (the degraded path —
#      rds or bedrock or s3 probe failed), API Gateway records it as
#      a 5xx. Scope an alarm specifically to GET /health so we see the
#      health probe failing as a distinct signal rather than mixed with
#      the noisy aggregate.
#
# Pilot tuning: thresholds are conservative (catch regressions early,
# tolerate occasional cold-start tails). Re-tune after the first 2
# weeks of pilot data.

locals {
  # P99 latency budgets (ms). bedrock-router does sync Bedrock calls
  # (3-7s typical), bedrock-vision does Haiku + optional Sonnet (1-10s).
  # Cold-start adds ~1-2s. The thresholds below absorb a cold-start tail
  # without firing on normal warm operation.
  bedrock_router_p99_ms = 15000
  bedrock_vision_p99_ms = 18000
}

# ---------------------------------------------------------------------------
# bedrock-router — duration p99
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "bedrock_router_duration_p99" {
  alarm_name          = "matika-${var.environment}-bedrock-router-p99-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  extended_statistic  = "p99"
  threshold           = local.bedrock_router_p99_ms
  alarm_description   = "bedrock-router p99 duration > ${local.bedrock_router_p99_ms}ms over 10 minutes — Bedrock-side regression or RDS slow"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = "matika-${var.environment}-bedrock-router"
  }
}

# ---------------------------------------------------------------------------
# bedrock-vision — duration p99
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "bedrock_vision_duration_p99" {
  alarm_name          = "matika-${var.environment}-bedrock-vision-p99-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  extended_statistic  = "p99"
  threshold           = local.bedrock_vision_p99_ms
  alarm_description   = "bedrock-vision p99 duration > ${local.bedrock_vision_p99_ms}ms over 10 minutes"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = "matika-${var.environment}-bedrock-vision"
  }
}

# ---------------------------------------------------------------------------
# Throttles — fires immediately on any throttle. Throttles ≠ errors;
# the existing error-rate alarm misses this case entirely.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "bedrock_router_throttles" {
  alarm_name          = "matika-${var.environment}-bedrock-router-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "bedrock-router being throttled — concurrent-execution quota exhausted; file a quota increase"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = "matika-${var.environment}-bedrock-router"
  }
}

resource "aws_cloudwatch_metric_alarm" "bedrock_vision_throttles" {
  alarm_name          = "matika-${var.environment}-bedrock-vision-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "bedrock-vision being throttled — concurrent-execution quota exhausted"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = "matika-${var.environment}-bedrock-vision"
  }
}

# ---------------------------------------------------------------------------
# /health 5xx — the health-check Lambda returns 503 when any probe
# (RDS, Bedrock, S3) is down. API Gateway records that as a 5xxError.
# Scoped to GET /health specifically so this signal is distinct from
# the noisy aggregate api_5xx_rate alarm in main.tf.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "health_endpoint_5xx" {
  alarm_name          = "matika-${var.environment}-health-endpoint-degraded"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "5XXError"
  namespace           = "AWS/ApiGateway"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "GET /health returning 5xx — at least one upstream probe (RDS/Bedrock/S3) is failing"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiName  = var.api_gateway_name
    Stage    = var.api_gateway_stage
    Resource = "/health"
    Method   = "GET"
  }
}

# ---------------------------------------------------------------------------
# F45 T1 — Cognito sign-in throttle/error rate alarm
#
# Lives the runbook-promised name `carelog-${env}-cognito-signin-errors`
# (see docs/runbook_oncall_v2.md "TARGET alarms" T1). What we actually
# measure: AWS/Cognito Throttles / (Throttles + SignInSuccesses) * 100
# over 5 min. Throttles is the only failure-class metric Cognito
# publishes natively. Wrong-password / no-such-user / etc. failures
# don't surface to CloudWatch — they fire CloudTrail events instead.
#
# v2.1 follow-up: extend by emitting a custom `SignInFailures` metric
# from the post_authentication lambda (or subscribe an EventBridge rule
# to CloudTrail userPoolEvents). Until then, this alarm catches the
# operationally most-actionable case (rate-limit hits / WAF mass-block).
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "cognito_signin_errors" {
  count = var.cognito_user_pool_id != "" ? 1 : 0

  alarm_name          = "carelog-${var.environment}-cognito-signin-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5
  alarm_description   = "Cognito sign-in throttle/error rate > 5% over 5 minutes (Throttles / (Throttles + SignInSuccesses)). Auth blocks 100% of new sign-ins — SEV-1 class. F45 T1."
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "(throttles / (throttles + successes + 1)) * 100"
    label       = "Sign-in Throttle Rate %"
    return_data = true
  }

  metric_query {
    id = "throttles"
    metric {
      metric_name = "Throttles"
      namespace   = "AWS/Cognito"
      period      = 300
      stat        = "Sum"
      dimensions = {
        UserPool = var.cognito_user_pool_id
      }
    }
  }

  metric_query {
    id = "successes"
    metric {
      metric_name = "SignInSuccesses"
      namespace   = "AWS/Cognito"
      period      = 300
      stat        = "Sum"
      dimensions = {
        UserPool = var.cognito_user_pool_id
      }
    }
  }

  tags = {
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# F47 — Cognito snapshot missing alarm
#
# Fires if the nightly cognito-snapshot lambda hasn't invoked in any
# 24-hour window (catches EventBridge rule disabled, IAM regression, or
# lambda removal). Pair with the carelog-${env}-lambda-errors-* alarm
# already declared by the main.tf per-function loop — that one catches
# runtime failures of the snapshot lambda itself.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "cognito_snapshot_missing" {
  count = var.cognito_snapshot_function_name != "" ? 1 : 0

  alarm_name          = "matika-${var.environment}-cognito-snapshot-missing"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Invocations"
  namespace           = "AWS/Lambda"
  period              = 86400 # 24h window
  statistic           = "Sum"
  threshold           = 1
  alarm_description   = "F47 — cognito-snapshot lambda did not invoke in the last 24h. EventBridge rule disabled, IAM regression, or lambda removed. RPO unbounded until next successful run."
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "breaching" # zero invocations should breach — opposite of the lambda-error pattern

  dimensions = {
    FunctionName = var.cognito_snapshot_function_name
  }

  tags = {
    Environment = var.environment
  }
}

# CareLog Monitoring Module
#
# Creates CloudWatch alarms, SNS topic, and dashboard for CareLog infrastructure.
#
# Alarm thresholds per spec Section 14.3:
# - Lambda error rate > 5% over 5 min
# - Lambda duration (construct-fhir-batch) P95 > 5s
# - API Gateway 5xx rate > 1% over 5 min
# - SQS dead letter queue depth > 0
# - RDS CPU > 80% for 10 min
# - RDS free storage < 5 GB

data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# SNS Topic for Operator Alerts
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "operator_alerts" {
  name = "carelog-${var.environment}-operator-alerts"

  tags = {
    Name        = "carelog-${var.environment}-operator-alerts"
    Environment = var.environment
  }
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.operator_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---------------------------------------------------------------------------
# Lambda Error Rate Alarms (per function)
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "lambda_error_rate" {
  count = length(var.lambda_function_names)

  alarm_name          = "carelog-${var.environment}-lambda-errors-${var.lambda_function_names[count.index]}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5
  alarm_description   = "Lambda error rate > 5% for ${var.lambda_function_names[count.index]} over 5 minutes"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "(errors / invocations) * 100"
    label       = "Error Rate %"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "Errors"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions = {
        FunctionName = var.lambda_function_names[count.index]
      }
    }
  }

  metric_query {
    id = "invocations"
    metric {
      metric_name = "Invocations"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions = {
        FunctionName = var.lambda_function_names[count.index]
      }
    }
  }

  tags = {
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# Lambda Duration Alarm: construct-fhir-batch P95 > 5s
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "lambda_duration_fhir_batch" {
  alarm_name          = "carelog-${var.environment}-lambda-duration-construct-fhir-batch"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  extended_statistic  = "p95"
  threshold           = 5000 # 5 seconds in milliseconds
  alarm_description   = "construct-fhir-batch P95 duration > 5s over 5 minutes"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = var.construct_fhir_batch_function_name
  }

  tags = {
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# Lambda Duration Alarm: evaluate-thresholds-batch P95 > 5s
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "lambda_duration_evaluate_thresholds" {
  alarm_name          = "carelog-${var.environment}-lambda-duration-evaluate-thresholds-batch"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  extended_statistic  = "p95"
  threshold           = 5000
  alarm_description   = "evaluate-thresholds-batch P95 duration > 5s over 5 minutes"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = var.evaluate_thresholds_batch_function_name
  }

  tags = {
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# API Gateway 5xx Rate Alarm
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_5xx_rate" {
  alarm_name          = "carelog-${var.environment}-apigw-5xx-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 1
  alarm_description   = "API Gateway 5xx error rate > 1% over 5 minutes"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "(errors_5xx / total_count) * 100"
    label       = "5xx Error Rate %"
    return_data = true
  }

  metric_query {
    id = "errors_5xx"
    metric {
      metric_name = "5XXError"
      namespace   = "AWS/ApiGateway"
      period      = 300
      stat        = "Sum"
      dimensions = {
        ApiName = var.api_gateway_name
        Stage   = var.api_gateway_stage
      }
    }
  }

  metric_query {
    id = "total_count"
    metric {
      metric_name = "Count"
      namespace   = "AWS/ApiGateway"
      period      = 300
      stat        = "Sum"
      dimensions = {
        ApiName = var.api_gateway_name
        Stage   = var.api_gateway_stage
      }
    }
  }

  tags = {
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# SQS Dead Letter Queue Depth Alarm
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "sqs_dlq_depth" {
  alarm_name          = "carelog-${var.environment}-sqs-dlq-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "SQS dead-letter queue has messages (depth > 0)"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = var.dlq_queue_name
  }

  tags = {
    Environment = var.environment
  }
}

# Alerts DLQ alarm (if provided)
resource "aws_cloudwatch_metric_alarm" "alerts_dlq_depth" {
  count = var.alerts_dlq_queue_name != "" ? 1 : 0

  alarm_name          = "carelog-${var.environment}-alerts-dlq-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Alerts SQS dead-letter queue has messages (depth > 0)"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = var.alerts_dlq_queue_name
  }

  tags = {
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# RDS CPU Utilization Alarm
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "carelog-${var.environment}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU utilization > 80% for 10 minutes"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  tags = {
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# RDS Free Storage Alarm
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "carelog-${var.environment}-rds-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Minimum"
  threshold           = 5368709120 # 5 GB in bytes
  alarm_description   = "RDS free storage < 5 GB"
  alarm_actions       = [aws_sns_topic.operator_alerts.arn]
  ok_actions          = [aws_sns_topic.operator_alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  tags = {
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# CloudWatch Dashboard
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "carelog-${var.environment}"

  dashboard_body = jsonencode({
    widgets = concat(
      # Row 1: Lambda Invocations and Errors
      [
        {
          type   = "metric"
          x      = 0
          y      = 0
          width  = 12
          height = 6
          properties = {
            title   = "Lambda Invocations (per function)"
            region  = data.aws_region.current.name
            view    = "timeSeries"
            stacked = false
            period  = 300
            metrics = [
              for fn in var.lambda_function_names :
              ["AWS/Lambda", "Invocations", "FunctionName", fn, { stat = "Sum" }]
            ]
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 0
          width  = 12
          height = 6
          properties = {
            title   = "Lambda Errors (per function)"
            region  = data.aws_region.current.name
            view    = "timeSeries"
            stacked = false
            period  = 300
            metrics = [
              for fn in var.lambda_function_names :
              ["AWS/Lambda", "Errors", "FunctionName", fn, { stat = "Sum" }]
            ]
          }
        }
      ],

      # Row 2: Lambda Duration P50/P95 for key functions
      [
        {
          type   = "metric"
          x      = 0
          y      = 6
          width  = 12
          height = 6
          properties = {
            title  = "Lambda Duration - construct-fhir-batch (P50/P95)"
            region = data.aws_region.current.name
            view   = "timeSeries"
            period = 300
            metrics = [
              ["AWS/Lambda", "Duration", "FunctionName", var.construct_fhir_batch_function_name, { stat = "p50", label = "P50" }],
              ["AWS/Lambda", "Duration", "FunctionName", var.construct_fhir_batch_function_name, { stat = "p95", label = "P95" }]
            ]
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 6
          width  = 12
          height = 6
          properties = {
            title  = "Lambda Duration - evaluate-thresholds-batch (P50/P95)"
            region = data.aws_region.current.name
            view   = "timeSeries"
            period = 300
            metrics = [
              ["AWS/Lambda", "Duration", "FunctionName", var.evaluate_thresholds_batch_function_name, { stat = "p50", label = "P50" }],
              ["AWS/Lambda", "Duration", "FunctionName", var.evaluate_thresholds_batch_function_name, { stat = "p95", label = "P95" }]
            ]
          }
        }
      ],

      # Row 3: API Gateway
      [
        {
          type   = "metric"
          x      = 0
          y      = 12
          width  = 12
          height = 6
          properties = {
            title  = "API Gateway - Request Count"
            region = data.aws_region.current.name
            view   = "timeSeries"
            period = 300
            metrics = [
              ["AWS/ApiGateway", "Count", "ApiName", var.api_gateway_name, "Stage", var.api_gateway_stage, { stat = "Sum" }]
            ]
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 12
          width  = 12
          height = 6
          properties = {
            title  = "API Gateway - 5xx Error Rate"
            region = data.aws_region.current.name
            view   = "timeSeries"
            period = 300
            metrics = [
              ["AWS/ApiGateway", "5XXError", "ApiName", var.api_gateway_name, "Stage", var.api_gateway_stage, { stat = "Sum", label = "5xx Errors" }],
              ["AWS/ApiGateway", "4XXError", "ApiName", var.api_gateway_name, "Stage", var.api_gateway_stage, { stat = "Sum", label = "4xx Errors" }]
            ]
          }
        }
      ],

      # Row 4: SQS
      [
        {
          type   = "metric"
          x      = 0
          y      = 18
          width  = 12
          height = 6
          properties = {
            title  = "SQS - Queue Depth"
            region = data.aws_region.current.name
            view   = "timeSeries"
            period = 300
            metrics = [
              ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.sqs_queue_name, { stat = "Maximum", label = "Main Queue" }],
              ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.dlq_queue_name, { stat = "Maximum", label = "DLQ" }]
            ]
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 18
          width  = 12
          height = 6
          properties = {
            title  = "SQS - Age of Oldest Message"
            region = data.aws_region.current.name
            view   = "timeSeries"
            period = 300
            metrics = [
              ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", var.sqs_queue_name, { stat = "Maximum", label = "Main Queue" }],
              ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", var.dlq_queue_name, { stat = "Maximum", label = "DLQ" }]
            ]
          }
        }
      ],

      # Row 5: RDS
      [
        {
          type   = "metric"
          x      = 0
          y      = 24
          width  = 8
          height = 6
          properties = {
            title  = "RDS - CPU Utilization"
            region = data.aws_region.current.name
            view   = "timeSeries"
            period = 300
            metrics = [
              ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.rds_instance_id, { stat = "Average" }]
            ]
            annotations = {
              horizontal = [
                { label = "Alarm Threshold", value = 80, color = "#d62728" }
              ]
            }
          }
        },
        {
          type   = "metric"
          x      = 8
          y      = 24
          width  = 8
          height = 6
          properties = {
            title  = "RDS - Database Connections"
            region = data.aws_region.current.name
            view   = "timeSeries"
            period = 300
            metrics = [
              ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.rds_instance_id, { stat = "Maximum" }]
            ]
          }
        },
        {
          type   = "metric"
          x      = 16
          y      = 24
          width  = 8
          height = 6
          properties = {
            title  = "RDS - Free Storage Space (GB)"
            region = data.aws_region.current.name
            view   = "timeSeries"
            period = 300
            metrics = [
              ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", var.rds_instance_id, { stat = "Minimum" }]
            ]
            annotations = {
              horizontal = [
                { label = "Alarm Threshold (5 GB)", value = 5368709120, color = "#d62728" }
              ]
            }
          }
        }
      ]
    )
  })
}

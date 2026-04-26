# CareLog Monitoring Module - Outputs

output "sns_topic_arn" {
  description = "ARN of the SNS topic for operator alerts"
  value       = aws_sns_topic.operator_alerts.arn
}

output "dashboard_name" {
  description = "Name of the CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.main.dashboard_name
}

output "lambda_error_alarm_arns" {
  description = "ARNs of Lambda error rate alarms"
  value       = [for alarm in aws_cloudwatch_metric_alarm.lambda_error_rate : alarm.arn]
}

output "lambda_duration_fhir_alarm_arn" {
  description = "ARN of the construct-fhir-batch duration alarm"
  value       = aws_cloudwatch_metric_alarm.lambda_duration_fhir_batch.arn
}

output "api_gateway_5xx_alarm_arn" {
  description = "ARN of the API Gateway 5xx alarm"
  value       = aws_cloudwatch_metric_alarm.api_5xx_rate.arn
}

output "sqs_dlq_alarm_arn" {
  description = "ARN of the SQS DLQ depth alarm"
  value       = aws_cloudwatch_metric_alarm.sqs_dlq_depth.arn
}

output "rds_cpu_alarm_arn" {
  description = "ARN of the RDS CPU alarm"
  value       = aws_cloudwatch_metric_alarm.rds_cpu.arn
}

output "rds_storage_alarm_arn" {
  description = "ARN of the RDS free storage alarm"
  value       = aws_cloudwatch_metric_alarm.rds_free_storage.arn
}

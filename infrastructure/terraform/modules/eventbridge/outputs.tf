# CareLog EventBridge Module - Outputs

output "daily_deadline_rule_arn" {
  description = "ARN of the check-daily-deadline EventBridge rule"
  value       = aws_cloudwatch_event_rule.check_daily_deadline.arn
}

output "missed_measurements_rule_arn" {
  description = "ARN of the check-missed-measurements EventBridge rule"
  value       = aws_cloudwatch_event_rule.check_missed_measurements.arn
}

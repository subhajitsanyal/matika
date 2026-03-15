# SNS Module Outputs

output "ios_platform_application_arn" {
  description = "ARN of the iOS APNs platform application"
  value       = aws_sns_platform_application.ios_apns.arn
}

output "android_platform_application_arn" {
  description = "ARN of the Android FCM platform application"
  value       = aws_sns_platform_application.android_fcm.arn
}

output "threshold_alerts_topic_arn" {
  description = "ARN of the threshold alerts SNS topic"
  value       = aws_sns_topic.threshold_alerts.arn
}

output "reminder_alerts_topic_arn" {
  description = "ARN of the reminder alerts SNS topic"
  value       = aws_sns_topic.reminder_alerts.arn
}

output "endpoint_events_topic_arn" {
  description = "ARN of the endpoint events SNS topic"
  value       = aws_sns_topic.endpoint_events.arn
}

output "delivery_failures_topic_arn" {
  description = "ARN of the delivery failures SNS topic"
  value       = aws_sns_topic.delivery_failures.arn
}

output "delivery_status_role_arn" {
  description = "ARN of the SNS delivery status IAM role"
  value       = aws_iam_role.sns_delivery_status_role.arn
}

# SNS Module Outputs

output "ios_platform_application_arn" {
  description = "ARN of the iOS APNs platform application (empty when iOS APNs is not provisioned in this env)"
  value       = length(aws_sns_platform_application.ios_apns) > 0 ? aws_sns_platform_application.ios_apns[0].arn : ""
}

output "android_platform_application_arn" {
  description = "ARN of the Android FCM platform application"
  value       = aws_sns_platform_application.android_fcm.arn
}

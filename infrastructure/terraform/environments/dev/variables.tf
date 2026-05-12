variable "ses_email_arn" {
  description = "ARN of the verified SES email identity for sending emails"
  type        = string
  default     = ""
}

variable "ses_from_email" {
  description = "From email address for SES (e.g., 'CareLog <noreply@yourdomain.com>')"
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "Email subscribed to the operator-alerts SNS topic for CloudWatch alarms. When empty, the entire monitoring module is skipped."
  type        = string
  default     = ""
}

# F17 — push transport (SNS Platform App for Android FCM HTTP v1).
# Set in terraform.tfvars to the platform app ARN. Empty disables
# Android push (lambdas log a no-transport warning + short-circuit).
variable "android_platform_arn" {
  description = "SNS Platform Application ARN for Android FCM. Forwards to module.carelog.android_platform_arn → lambda env vars."
  type        = string
  default     = ""
}

variable "ios_platform_arn" {
  description = "SNS Platform Application ARN for iOS APNs. Empty for v2.0 (iOS parked)."
  type        = string
  default     = ""
}

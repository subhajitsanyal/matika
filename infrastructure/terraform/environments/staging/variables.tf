variable "ses_email_arn" {
  description = "ARN of the verified SES email identity for sending emails. Leave empty until Stream D #5 (sender domain) lands; Cognito self-registration emails will not send until then."
  type        = string
  default     = ""
}

variable "ses_from_email" {
  description = "From email address for SES (e.g., 'Matika <noreply@matika.health>'). Stream D #5 still HOLD as of 2026-05-14."
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "Email subscribed to the operator-alerts SNS topic for CloudWatch alarms. When empty, the entire monitoring module is skipped (count = 0). Set in environments/staging/terraform.tfvars before the 1-week soak."
  type        = string
  default     = ""
}

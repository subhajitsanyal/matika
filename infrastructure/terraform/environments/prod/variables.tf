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

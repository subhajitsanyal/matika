# CareLog Cognito Module - Variables

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "mobile_callback_urls" {
  description = "Callback URLs for mobile app OAuth"
  type        = list(string)
  default     = ["carelog://callback", "carelog://signin"]
}

variable "mobile_logout_urls" {
  description = "Logout URLs for mobile app OAuth"
  type        = list(string)
  default     = ["carelog://signout"]
}

variable "web_callback_urls" {
  description = "Callback URLs for web portal OAuth"
  type        = list(string)
  default     = ["https://portal.carelog.com/callback"]
}

variable "web_logout_urls" {
  description = "Logout URLs for web portal OAuth"
  type        = list(string)
  default     = ["https://portal.carelog.com/logout"]
}

variable "ses_email_arn" {
  description = "ARN of SES verified email identity for Cognito emails (empty = use Cognito default)"
  type        = string
  default     = ""
}

variable "ses_from_email" {
  description = "SES verified sender email address"
  type        = string
  default     = ""
}


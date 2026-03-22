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


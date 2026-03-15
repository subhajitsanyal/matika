# SNS Module Variables

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "carelog"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
}

variable "apns_certificate" {
  description = "APNs certificate PEM content"
  type        = string
  sensitive   = true
  default     = ""
}

variable "apns_private_key" {
  description = "APNs private key PEM content"
  type        = string
  sensitive   = true
  default     = ""
}

variable "fcm_server_key" {
  description = "Firebase Cloud Messaging server key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "apns_signing_key" {
  description = "APNs signing key for token-based auth (p8 file content)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "apns_key_id" {
  description = "APNs key ID for token-based auth"
  type        = string
  default     = ""
}

variable "apple_team_id" {
  description = "Apple Developer Team ID"
  type        = string
  default     = ""
}

variable "ios_bundle_id" {
  description = "iOS app bundle identifier"
  type        = string
  default     = "com.carelog.app"
}

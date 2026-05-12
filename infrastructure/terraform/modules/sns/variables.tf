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
  description = "Firebase Cloud Messaging credential. For FCM HTTP v1 (current default) this is the entire service-account JSON blob downloaded from Firebase console → Project settings → Service accounts → Generate new private key. The legacy FCM server key string is also accepted by SNS but should not be used for new deploys (Firebase deprecated it in 2024). Stored in Secrets Manager; loaded via data source."
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

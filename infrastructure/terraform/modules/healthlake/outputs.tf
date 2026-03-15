# CareLog HealthLake Module - Outputs
#
# Note: datastore_id, datastore_arn, and datastore_endpoint are placeholders
# until the awscc provider is added for HealthLake FHIR datastore support.

output "datastore_id" {
  description = "ID of the HealthLake FHIR data store"
  value       = null
}

output "datastore_arn" {
  description = "ARN of the HealthLake FHIR data store"
  value       = null
}

output "datastore_endpoint" {
  description = "Endpoint URL of the HealthLake FHIR data store"
  value       = null
}

output "kms_key_arn" {
  description = "ARN of the KMS key for HealthLake encryption"
  value       = aws_kms_key.healthlake.arn
}

output "access_role_arn" {
  description = "ARN of the IAM role for HealthLake access"
  value       = aws_iam_role.healthlake_access.arn
}

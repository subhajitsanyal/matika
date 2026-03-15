# CareLog HealthLake Module - Outputs

output "datastore_id" {
  description = "ID of the HealthLake FHIR data store"
  value       = aws_healthlake_fhir_datastore.main.id
}

output "datastore_arn" {
  description = "ARN of the HealthLake FHIR data store"
  value       = aws_healthlake_fhir_datastore.main.arn
}

output "datastore_endpoint" {
  description = "Endpoint URL of the HealthLake FHIR data store"
  value       = aws_healthlake_fhir_datastore.main.datastore_endpoint
}

output "kms_key_arn" {
  description = "ARN of the KMS key for HealthLake encryption"
  value       = aws_kms_key.healthlake.arn
}

output "access_role_arn" {
  description = "ARN of the IAM role for HealthLake access"
  value       = aws_iam_role.healthlake_access.arn
}

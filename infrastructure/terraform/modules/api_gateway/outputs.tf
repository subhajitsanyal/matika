# CareLog API Gateway Module - Outputs

output "api_id" {
  description = "ID of the API Gateway"
  value       = aws_api_gateway_rest_api.main.id
}

output "api_arn" {
  description = "ARN of the API Gateway"
  value       = aws_api_gateway_rest_api.main.arn
}

output "api_url" {
  description = "Invoke URL of the API Gateway"
  value       = aws_api_gateway_stage.main.invoke_url
}

output "api_execution_arn" {
  description = "Execution ARN of the API Gateway"
  value       = aws_api_gateway_rest_api.main.execution_arn
}

output "stage_name" {
  description = "Name of the deployment stage"
  value       = aws_api_gateway_stage.main.stage_name
}

output "authorizer_id" {
  description = "ID of the Cognito authorizer"
  value       = aws_api_gateway_authorizer.cognito.id
}

# Resource IDs for Lambda integration
output "patients_resource_id" {
  description = "Resource ID for /patients"
  value       = aws_api_gateway_resource.patients.id
}

output "patient_resource_id" {
  description = "Resource ID for /patients/{patientId}"
  value       = aws_api_gateway_resource.patient.id
}

output "observations_resource_id" {
  description = "Resource ID for /observations"
  value       = aws_api_gateway_resource.observations.id
}

output "observations_sync_resource_id" {
  description = "Resource ID for /observations/sync"
  value       = aws_api_gateway_resource.observations_sync.id
}

output "documents_resource_id" {
  description = "Resource ID for /documents"
  value       = aws_api_gateway_resource.documents.id
}

output "documents_presigned_resource_id" {
  description = "Resource ID for /documents/presigned-url"
  value       = aws_api_gateway_resource.documents_presigned.id
}

output "thresholds_resource_id" {
  description = "Resource ID for /thresholds"
  value       = aws_api_gateway_resource.thresholds.id
}

output "patient_thresholds_resource_id" {
  description = "Resource ID for /thresholds/{patientId}"
  value       = aws_api_gateway_resource.patient_thresholds.id
}

output "reminders_resource_id" {
  description = "Resource ID for /reminders"
  value       = aws_api_gateway_resource.reminders.id
}

output "care_plans_resource_id" {
  description = "Resource ID for /care-plans"
  value       = aws_api_gateway_resource.care_plans.id
}

output "alerts_resource_id" {
  description = "Resource ID for /alerts"
  value       = aws_api_gateway_resource.alerts.id
}

output "device_tokens_resource_id" {
  description = "Resource ID for /device-tokens"
  value       = aws_api_gateway_resource.device_tokens.id
}

output "audit_log_resource_id" {
  description = "Resource ID for /audit-log"
  value       = aws_api_gateway_resource.audit_log.id
}

output "access_log_group_name" {
  description = "Name of the CloudWatch log group for API access logs"
  value       = aws_cloudwatch_log_group.api_access_logs.name
}

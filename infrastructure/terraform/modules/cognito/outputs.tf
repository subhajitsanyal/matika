# CareLog Cognito Module - Outputs

output "user_pool_id" {
  description = "ID of the Cognito user pool"
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "ARN of the Cognito user pool"
  value       = aws_cognito_user_pool.main.arn
}

output "user_pool_endpoint" {
  description = "Endpoint of the Cognito user pool"
  value       = aws_cognito_user_pool.main.endpoint
}

output "user_pool_domain" {
  description = "Domain of the Cognito user pool"
  value       = aws_cognito_user_pool_domain.main.domain
}

output "mobile_client_id" {
  description = "ID of the mobile app client"
  value       = aws_cognito_user_pool_client.mobile.id
}

output "web_client_id" {
  description = "ID of the web portal client"
  value       = aws_cognito_user_pool_client.web.id
}

output "web_client_secret" {
  description = "Secret of the web portal client"
  value       = aws_cognito_user_pool_client.web.client_secret
  sensitive   = true
}

output "patients_group_name" {
  description = "Name of the patients user group"
  value       = aws_cognito_user_group.patients.name
}

output "attendants_group_name" {
  description = "Name of the attendants user group"
  value       = aws_cognito_user_group.attendants.name
}

output "relatives_group_name" {
  description = "Name of the relatives user group"
  value       = aws_cognito_user_group.relatives.name
}

output "doctors_group_name" {
  description = "Name of the doctors user group"
  value       = aws_cognito_user_group.doctors.name
}

output "resource_server_identifier" {
  description = "Identifier of the API resource server"
  value       = aws_cognito_resource_server.api.identifier
}

# CareLog Infrastructure - Outputs
#
# This file defines all outputs from the CareLog infrastructure.

# VPC Outputs
output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "IDs of public subnets"
  value       = module.vpc.public_subnet_ids
}

output "private_subnet_ids" {
  description = "IDs of private subnets"
  value       = module.vpc.private_subnet_ids
}

output "nat_gateway_ids" {
  description = "IDs of NAT gateways"
  value       = module.vpc.nat_gateway_ids
}

# Security Group Outputs
output "api_security_group_id" {
  description = "ID of the API security group"
  value       = module.vpc.api_security_group_id
}

output "rds_security_group_id" {
  description = "ID of the RDS security group"
  value       = module.vpc.rds_security_group_id
}

output "lambda_security_group_id" {
  description = "ID of the Lambda security group"
  value       = module.vpc.lambda_security_group_id
}

# Cognito Outputs (T-004)
# output "cognito_user_pool_id" {
#   description = "ID of the Cognito user pool"
#   value       = module.cognito.user_pool_id
# }

# output "cognito_user_pool_client_id" {
#   description = "ID of the Cognito user pool client"
#   value       = module.cognito.user_pool_client_id
# }

# API Gateway Outputs (T-005)
output "api_gateway_url" {
  description = "URL of the API Gateway"
  value       = module.api_gateway.api_url
}

# S3 Outputs (T-007)
# output "documents_bucket_name" {
#   description = "Name of the S3 bucket for documents"
#   value       = module.s3.documents_bucket_name
# }

# RDS Outputs (T-009)
# output "rds_endpoint" {
#   description = "Endpoint of the RDS instance"
#   value       = module.rds.endpoint
#   sensitive   = true
# }

# Bastion Outputs
output "bastion_instance_id" {
  description = "ID of the bastion EC2 instance (empty if bastion disabled)"
  value       = var.enable_bastion ? module.bastion[0].instance_id : null
}

output "bastion_ssm_port_forward_command" {
  description = "AWS CLI command to port-forward RDS via the bastion"
  value       = var.enable_bastion ? module.bastion[0].ssm_port_forward_command : null
}

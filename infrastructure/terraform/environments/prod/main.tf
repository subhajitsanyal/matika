# CareLog Infrastructure - Production Environment
#
# This configuration sets up the production environment for CareLog.
# Appropriate instance sizes for production workloads.
#
# HIPAA Compliance: All production resources are encrypted and audited.
# DPDP Compliance: All data resides in ap-south-1 (Mumbai).

terraform {
  required_version = ">= 1.5.0"

  # Backend configuration for production
  # backend "s3" {
  #   bucket         = "carelog-terraform-state"
  #   key            = "prod/terraform.tfstate"
  #   region         = "ap-south-1"
  #   encrypt        = true
  #   dynamodb_table = "carelog-terraform-locks"
  # }
}

module "carelog" {
  source = "../../"

  environment = "prod"
  aws_region  = "ap-south-1"

  # VPC Configuration
  vpc_cidr             = "10.2.0.0/16"
  availability_zones   = ["ap-south-1a", "ap-south-1b"]
  public_subnet_cidrs  = ["10.2.1.0/24", "10.2.2.0/24"]
  private_subnet_cidrs = ["10.2.11.0/24", "10.2.12.0/24"]

  # Database - production instance
  db_instance_class = "db.t3.medium"
  db_name           = "carelog_prod"
  db_username       = "carelog_prod_admin"

  # SES email for Cognito verification emails
  ses_email_arn  = var.ses_email_arn
  ses_from_email = var.ses_from_email

  # Feature flags
  enable_healthlake = false
  enable_waf        = true
  enable_bastion    = true
}

# Outputs
output "vpc_id" {
  value = module.carelog.vpc_id
}

output "public_subnet_ids" {
  value = module.carelog.public_subnet_ids
}

output "private_subnet_ids" {
  value = module.carelog.private_subnet_ids
}

output "bastion_instance_id" {
  value = module.carelog.bastion_instance_id
}

output "bastion_ssm_port_forward_command" {
  description = "Run this command to port-forward RDS to localhost:5432"
  value       = module.carelog.bastion_ssm_port_forward_command
}

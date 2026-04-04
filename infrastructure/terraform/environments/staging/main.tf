# CareLog Infrastructure - Staging Environment
#
# This configuration sets up the staging environment for CareLog.
# Similar to production but with reduced instance sizes.
# DPDP Compliance: All environments in ap-south-1 for data residency.

terraform {
  required_version = ">= 1.5.0"

  # Backend configuration for staging
  # backend "s3" {
  #   bucket         = "carelog-terraform-state"
  #   key            = "staging/terraform.tfstate"
  #   region         = "ap-south-1"
  #   encrypt        = true
  #   dynamodb_table = "carelog-terraform-locks"
  # }
}

module "carelog" {
  source = "../../"

  environment = "staging"
  aws_region  = "ap-south-1"

  # VPC Configuration
  vpc_cidr             = "10.1.0.0/16"
  availability_zones   = ["ap-south-1a", "ap-south-1b"]
  public_subnet_cidrs  = ["10.1.1.0/24", "10.1.2.0/24"]
  private_subnet_cidrs = ["10.1.11.0/24", "10.1.12.0/24"]

  # Database
  db_instance_class = "db.t3.small"
  db_name           = "carelog_staging"
  db_username       = "carelog_staging_admin"

  # SES email for Cognito verification emails
  ses_email_arn  = var.ses_email_arn
  ses_from_email = var.ses_from_email

  # Feature flags
  enable_healthlake = false
  enable_waf        = true
  enable_bastion    = true
}

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

# CareLog Infrastructure - Development Environment
#
# This configuration sets up the development environment for CareLog.
# Uses smaller instance sizes and reduced redundancy for cost optimization.

terraform {
  required_version = ">= 1.5.0"

  # Backend configuration for dev
  # backend "s3" {
  #   bucket         = "carelog-terraform-state"
  #   key            = "dev/terraform.tfstate"
  #   region         = "ap-south-1"
  #   encrypt        = true
  #   dynamodb_table = "carelog-terraform-locks"
  # }
}

module "carelog" {
  source = "../../"

  environment = "dev"
  aws_region  = "ap-south-1"

  # VPC Configuration - smaller for dev
  vpc_cidr             = "10.0.0.0/16"
  availability_zones   = ["ap-south-1a", "ap-south-1b"]
  public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnet_cidrs = ["10.0.11.0/24", "10.0.12.0/24"]

  # S3 bucket prefix - unique to avoid name conflicts
  s3_bucket_prefix = "carelog-v2"

  # Database - smaller instance for dev
  db_instance_class = "db.t3.micro"
  db_name           = "carelog_dev"
  db_username       = "carelog_dev_admin"

  # SES email for Cognito verification emails
  # Set these to your verified SES identity — see docs/setup-and-deployment-guide.md §1.4
  ses_email_arn  = var.ses_email_arn
  ses_from_email = var.ses_from_email

  # Feature flags
  enable_healthlake = false # Disable for dev to save costs
  enable_waf        = false # Disable for dev
  enable_bastion    = true  # Enable bastion for RDS access via SSM
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

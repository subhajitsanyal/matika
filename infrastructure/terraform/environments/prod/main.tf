# CareLog Infrastructure - Production Environment
#
# This configuration sets up the production environment for CareLog.
# Full redundancy and appropriate instance sizes for production workloads.
#
# HIPAA Compliance: All production resources are encrypted and audited.
# DPDP Compliance: Indian user data will be replicated to ap-south-1.

terraform {
  required_version = ">= 1.6.0"

  # Backend configuration for production
  # backend "s3" {
  #   bucket         = "carelog-terraform-state"
  #   key            = "prod/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "carelog-terraform-locks"
  # }
}

module "carelog" {
  source = "../../"

  environment = "prod"
  aws_region  = "us-east-1"

  # VPC Configuration - full HA setup
  vpc_cidr             = "10.2.0.0/16"
  availability_zones   = ["us-east-1a", "us-east-1b", "us-east-1c"]
  public_subnet_cidrs  = ["10.2.1.0/24", "10.2.2.0/24", "10.2.3.0/24"]
  private_subnet_cidrs = ["10.2.11.0/24", "10.2.12.0/24", "10.2.13.0/24"]

  # Database - production instance
  db_instance_class = "db.t3.medium"
  db_name           = "carelog_prod"
  db_username       = "carelog_prod_admin"

  # Feature flags
  enable_healthlake = true
  enable_waf        = true
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

# Note: Additional production-specific resources like:
# - Multi-region replication for DPDP compliance
# - Enhanced monitoring
# - AWS Backup plans
# Will be added as needed.

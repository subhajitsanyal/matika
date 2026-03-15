# CareLog Infrastructure - Staging Environment
#
# This configuration sets up the staging environment for CareLog.
# Similar to production but with reduced instance sizes.

terraform {
  required_version = ">= 1.6.0"

  # Backend configuration for staging
  # backend "s3" {
  #   bucket         = "carelog-terraform-state"
  #   key            = "staging/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "carelog-terraform-locks"
  # }
}

module "carelog" {
  source = "../../"

  environment = "staging"
  aws_region  = "us-east-1"

  # VPC Configuration
  vpc_cidr             = "10.1.0.0/16"
  availability_zones   = ["us-east-1a", "us-east-1b", "us-east-1c"]
  public_subnet_cidrs  = ["10.1.1.0/24", "10.1.2.0/24", "10.1.3.0/24"]
  private_subnet_cidrs = ["10.1.11.0/24", "10.1.12.0/24", "10.1.13.0/24"]

  # Database - medium instance for staging
  db_instance_class = "db.t3.small"
  db_name           = "carelog_staging"
  db_username       = "carelog_staging_admin"

  # Feature flags
  enable_healthlake = true
  enable_waf        = true
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

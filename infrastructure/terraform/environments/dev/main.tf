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

  # Database - smaller instance for dev
  db_instance_class = "db.t3.micro"
  db_name           = "carelog_dev"
  db_username       = "carelog_dev_admin"

  # Feature flags
  enable_healthlake = false # Disable for dev to save costs
  enable_waf        = false # Disable for dev
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

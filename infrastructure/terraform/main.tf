# CareLog Infrastructure - Main Terraform Configuration
#
# This is the root module that orchestrates all infrastructure components
# for the CareLog health monitoring application.
#
# HIPAA Compliance: This infrastructure is designed to meet HIPAA requirements
# including encryption at rest, encryption in transit, and audit logging.

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.30"
    }
  }

  # Backend configuration for state management
  # Uncomment and configure for production use
  # backend "s3" {
  #   bucket         = "carelog-terraform-state"
  #   key            = "terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "carelog-terraform-locks"
  # }
}

# AWS Provider Configuration
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "CareLog"
      Environment = var.environment
      ManagedBy   = "Terraform"
      HIPAA       = "true"
    }
  }
}

# Secondary provider for ap-south-1 (Mumbai) - DPDP Act compliance for Indian users
provider "aws" {
  alias  = "mumbai"
  region = "ap-south-1"

  default_tags {
    tags = {
      Project     = "CareLog"
      Environment = var.environment
      ManagedBy   = "Terraform"
      HIPAA       = "true"
      DPDP        = "true"
    }
  }
}

# VPC Module
module "vpc" {
  source = "./modules/vpc"

  environment         = var.environment
  vpc_cidr            = var.vpc_cidr
  availability_zones  = var.availability_zones
  public_subnet_cidrs = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
}

# Cognito Module
module "cognito" {
  source = "./modules/cognito"

  environment          = var.environment
  mobile_callback_urls = ["carelog://callback", "carelog://signin"]
  mobile_logout_urls   = ["carelog://signout"]
  web_callback_urls    = var.environment == "prod" ? ["https://portal.carelog.com/callback"] : ["https://portal.${var.environment}.carelog.com/callback"]
  web_logout_urls      = var.environment == "prod" ? ["https://portal.carelog.com/logout"] : ["https://portal.${var.environment}.carelog.com/logout"]
}

# API Gateway Module
module "api_gateway" {
  source = "./modules/api_gateway"

  environment           = var.environment
  cognito_user_pool_arn = module.cognito.user_pool_arn
  cors_origin           = var.environment == "prod" ? "https://portal.carelog.com" : "*"
  throttle_burst_limit  = var.environment == "prod" ? 200 : 100
  throttle_rate_limit   = var.environment == "prod" ? 100 : 50
  quota_limit           = var.environment == "prod" ? 100000 : 10000
}

# HealthLake Module
module "healthlake" {
  count  = var.enable_healthlake ? 1 : 0
  source = "./modules/healthlake"

  environment = var.environment
}

# S3 Module
module "s3" {
  source = "./modules/s3"

  environment   = var.environment
  bucket_prefix = var.s3_bucket_prefix
  cors_origins  = var.environment == "prod" ? ["https://portal.carelog.com", "https://app.carelog.com"] : ["*"]
}

# SQS Module
module "sqs" {
  source = "./modules/sqs"

  environment          = var.environment
  documents_bucket_id  = module.s3.documents_bucket_id
  documents_bucket_arn = module.s3.documents_bucket_arn
}

# RDS Module
module "rds" {
  source = "./modules/rds"

  environment           = var.environment
  private_subnet_ids    = module.vpc.private_subnet_ids
  rds_security_group_id = module.vpc.rds_security_group_id
  db_instance_class     = var.db_instance_class
  db_name               = var.db_name
  db_username           = var.db_username
}

# Matika Infrastructure — Production Environment
#
# Mirrors the staging/ shape with prod-appropriate sizing:
#   - VPC CIDR 10.2.0.0/16  (dev=10.0, staging=10.1, prod=10.2)
#   - 3 AZs (HA across the full ap-south-1 region)
#   - RDS: db.r6g.large, Multi-AZ, deletion protection on, 35-day backups
#   - HealthLake DISABLED per v2.0 launch plan §12 (deferred to v2.1).
#     S3 + parameter_configs cover FHIR persistence today.
#   - bedrock-router provisioned-concurrency = 0 until the Lambda
#     concurrent-executions quota increase request lands. Bump to 5+
#     once approved.
#
# Pre-apply checklist (see docs/setup-and-deployment-guide.md §"Prod
# environment stand-up"):
#   1. SES production access granted (sandbox-only blocks beta cohort).
#   2. Bedrock prod quotas approved (100 RPM Haiku / 30 RPM Sonnet — 3x
#      dev). File request 1 week before plan-apply.
#   3. carelog-prod/fcm-service-account Secrets Manager secret
#      provisioned (copy from dev Firebase project, or stand up a
#      separate prod Firebase project and use its JSON).
#   4. prod/terraform.tfvars filled in from
#      prod/terraform.tfvars.template (gitignored target; commit-safe
#      template).
#   5. On-call rotation staffed (launch plan §7.4).
#   6. Staging soak gate passed (1 week with alert_email set).
#
# DPDP / data-residency: all resources in ap-south-1. The `global.*`
# Bedrock inference profiles can route across regions, however; that
# is being reviewed by legal — see docs/v2_remaining_todos.md.

terraform {
  required_version = ">= 1.5.0"

  # Same S3 backend as dev/staging — different `key` so the state files
  # are isolated. The bucket and lock table were created by
  # `infrastructure/terraform/bootstrap/` (one-time).
  backend "s3" {
    bucket         = "carelog-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "carelog-terraform-locks"
  }
}

module "carelog" {
  source = "../../"

  environment = "prod"
  aws_region  = "ap-south-1"

  # VPC — 3 AZs for HA. Subnet sizing leaves room to grow.
  vpc_cidr             = "10.2.0.0/16"
  availability_zones   = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
  public_subnet_cidrs  = ["10.2.1.0/24", "10.2.2.0/24", "10.2.3.0/24"]
  private_subnet_cidrs = ["10.2.11.0/24", "10.2.12.0/24", "10.2.13.0/24"]

  # S3 bucket prefix — separate namespace from dev. Buckets are globally
  # unique; `s3_bucket_prefix` is appended with the account ID by the
  # s3 module to ensure uniqueness.
  s3_bucket_prefix = "carelog-v2-prod"

  # Database — production-grade.
  db_instance_class       = "db.r6g.large"
  db_name                 = "carelog_prod"
  db_username             = "carelog_prod_admin"
  rds_multi_az            = true
  rds_deletion_protection = true

  # SES email for Cognito + alarm sender. Set in prod/terraform.tfvars
  # (gitignored) to a production-verified SES identity.
  ses_email_arn  = var.ses_email_arn
  ses_from_email = var.ses_from_email

  # CloudWatch alarms. Set alert_email in prod/terraform.tfvars to a real
  # operations alias (NOT a personal inbox). Empty disables monitoring.
  alert_email = var.alert_email

  # Feature flags
  # v2.0 launch plan §12: HealthLake is OUT OF SCOPE for v2.0 (deferred
  # to v2.1). Patient observations are S3+JSON FHIR R4 already; the
  # Phase 2 doctor portal discovery (§13) will inform whether HealthLake
  # is worth the engineering cost. Keep `false` until then.
  enable_healthlake = false
  enable_bastion    = true # Same SSM-based RDS access pattern as dev/staging
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

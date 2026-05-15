# Matika Infrastructure - Staging Environment
#
# Lives in the same AWS account as dev (316643066568) per the Stream H
# stand-up decision (2026-05-14). Bucket names disambiguate via the
# `${env}` segment in the s3 module's naming pattern, so reusing the
# carelog-v2 prefix is collision-free.
#
# DPDP compliance: ap-south-1, identical to dev/prod.

terraform {
  required_version = ">= 1.5.0"

  # Remote state in the shared bootstrap bucket — same bucket as dev,
  # different key. The bootstrap config (infrastructure/terraform/bootstrap/)
  # provisioned this in 2026-05-02; lock table is shared too.
  backend "s3" {
    bucket         = "carelog-terraform-state"
    key            = "staging/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "carelog-terraform-locks"
  }
}

module "carelog" {
  source = "../../"

  environment = "staging"
  aws_region  = "ap-south-1"

  # VPC Configuration — non-overlapping with dev's 10.0.0.0/16
  vpc_cidr             = "10.1.0.0/16"
  availability_zones   = ["ap-south-1a", "ap-south-1b"]
  public_subnet_cidrs  = ["10.1.1.0/24", "10.1.2.0/24"]
  private_subnet_cidrs = ["10.1.11.0/24", "10.1.12.0/24"]

  # Same prefix as dev — env segment in `${prefix}-${env}-${kind}-${acct}`
  # bucket-name pattern keeps staging buckets distinct (e.g.
  # `carelog-v2-staging-documents-...`).
  s3_bucket_prefix = "carelog-v2"

  # Database — one tier above dev's t3.micro for soak load
  db_instance_class = "db.t3.small"
  db_name           = "carelog_staging"
  db_username       = "carelog_staging_admin"

  # SES email for Cognito verification emails. Stream D #5 (sender domain)
  # still HOLD as of 2026-05-14 — leave empty for the first apply; Cognito
  # self-registration emails won't send until this lands. Set in
  # environments/staging/terraform.tfvars (gitignored) once decided.
  ses_email_arn  = var.ses_email_arn
  ses_from_email = var.ses_from_email

  # CloudWatch operator-alerts email. When empty, the entire monitoring
  # module is skipped (count = 0). Set in terraform.tfvars before the
  # 1-week soak (per launch plan §7.1).
  alert_email = var.alert_email

  # Feature flags
  enable_healthlake = false  # parity with dev — HealthLake deferred to v2.1
  enable_bastion    = true   # required for SSM port-forward to RDS
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

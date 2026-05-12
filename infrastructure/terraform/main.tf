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
  # Each environment has its own backend config in environments/{env}/main.tf
  # This root-level backend is not used directly — deploy from environments/
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

# All environments deploy to ap-south-1 (Mumbai) for DPDP Act data residency.
# A secondary provider alias can be added later if multi-region is needed.

# VPC Module
module "vpc" {
  source = "./modules/vpc"

  environment          = var.environment
  vpc_cidr             = var.vpc_cidr
  availability_zones   = var.availability_zones
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
}

# Cognito Module
module "cognito" {
  source = "./modules/cognito"

  environment          = var.environment
  mobile_callback_urls = ["carelog://callback", "carelog://signin"]
  mobile_logout_urls   = ["carelog://signout"]
  web_callback_urls    = var.environment == "prod" ? ["https://portal.${var.domain_name}/callback"] : ["https://portal.${var.environment}.${var.domain_name}/callback"]
  web_logout_urls      = var.environment == "prod" ? ["https://portal.${var.domain_name}/logout"] : ["https://portal.${var.environment}.${var.domain_name}/logout"]
  ses_email_arn        = var.ses_email_arn
  ses_from_email       = var.ses_from_email
  domain_name          = var.domain_name
}

# Attach post-confirmation + post-authentication Lambda triggers to
# Cognito (breaks circular dependency). Uses null_resource because
# Cognito → Lambda → Cognito would create a cycle. "always run" trigger
# ensures it re-attaches on every apply (idempotent).
#
# Both triggers must be set in a single update-user-pool call —
# AWS replaces the whole lambda-config object, not merges individual
# keys. The post-authentication addition is for testing_todos_v2.md F1
# (users.last_login_at stamping).
resource "null_resource" "cognito_post_confirmation_trigger" {
  triggers = {
    pc_lambda_arn = module.lambda.post_confirmation_arn
    pa_lambda_arn = module.lambda.post_authentication_arn
    user_pool_id  = module.cognito.user_pool_id
    always_run    = timestamp()
  }

  provisioner "local-exec" {
    command = "aws cognito-idp update-user-pool --user-pool-id ${module.cognito.user_pool_id} --lambda-config '{\"PostConfirmation\":\"${module.lambda.post_confirmation_arn}\",\"PostAuthentication\":\"${module.lambda.post_authentication_arn}\"}' --auto-verified-attributes email --region ${var.aws_region}"
  }
}

# API Gateway Module
module "api_gateway" {
  source = "./modules/api_gateway"

  environment           = var.environment
  cognito_user_pool_arn = module.cognito.user_pool_arn
  cors_origin           = var.environment == "prod" ? "https://portal.${var.domain_name}" : "*"
  throttle_burst_limit  = var.environment == "prod" ? 200 : 100
  throttle_rate_limit   = var.environment == "prod" ? 100 : 50
  quota_limit           = var.environment == "prod" ? 100000 : 10000

  # Lambda integrations
  create_patient_invoke_arn           = module.lambda.create_patient_invoke_arn
  sync_observation_invoke_arn         = module.lambda.sync_observation_invoke_arn
  bulk_sync_invoke_arn                = module.lambda.bulk_sync_invoke_arn
  presigned_url_invoke_arn            = module.lambda.presigned_url_invoke_arn
  invite_attendant_invoke_arn         = module.lambda.invite_attendant_invoke_arn
  invite_doctor_invoke_arn            = module.lambda.invite_doctor_invoke_arn
  accept_invite_invoke_arn            = module.lambda.accept_invite_invoke_arn
  care_team_invoke_arn                = module.lambda.care_team_invoke_arn
  patient_summary_invoke_arn          = module.lambda.patient_summary_invoke_arn
  get_observations_invoke_arn         = module.lambda.get_observations_invoke_arn
  fetch_session_config_invoke_arn     = module.lambda.fetch_session_config_invoke_arn
  store_interaction_invoke_arn        = module.lambda.store_interaction_invoke_arn
  construct_fhir_batch_invoke_arn     = module.lambda.construct_fhir_batch_invoke_arn
  manage_recommendations_invoke_arn   = module.lambda.manage_recommendations_invoke_arn
  manage_parameter_configs_invoke_arn = module.lambda.manage_parameter_configs_invoke_arn
  manage_interactions_invoke_arn      = module.lambda.manage_interactions_invoke_arn
  manage_prompts_invoke_arn           = module.lambda.manage_prompts_invoke_arn

  # v2 Bedrock-backed routes
  bedrock_router_invoke_arn = module.lambda.bedrock_router_invoke_arn
  bedrock_vision_invoke_arn = module.lambda.bedrock_vision_invoke_arn
  health_check_invoke_arn   = module.lambda.health_check_invoke_arn
  photo_presign_invoke_arn  = module.lambda.photo_presign_invoke_arn

  # F2 — POST /sessions/{sessionId}/end
  end_session_invoke_arn = module.lambda.end_session_invoke_arn

  # F17 — POST/DELETE /device-tokens
  device_token_invoke_arn = module.lambda.device_token_invoke_arn
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
  cors_origins  = var.environment == "prod" ? ["https://portal.${var.domain_name}", "https://app.${var.domain_name}"] : ["*"]
}

# SQS Module
module "sqs" {
  source = "./modules/sqs"

  environment             = var.environment
  enable_s3_notifications = true
  documents_bucket_id     = module.s3.documents_bucket_id
  documents_bucket_arn    = module.s3.documents_bucket_arn
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
  multi_az              = var.rds_multi_az
  deletion_protection   = var.rds_deletion_protection
}

# Bedrock Module — Guardrail + foundation-model ARN exports.
# Must be declared before the lambda module so its outputs can be passed in.
module "bedrock" {
  source = "./modules/bedrock"

  environment     = var.environment
  aws_region      = var.aws_region
  haiku_model_id  = var.bedrock_haiku_model_id
  sonnet_model_id = var.bedrock_sonnet_model_id
}

# Lambda Module
module "lambda" {
  source = "./modules/lambda"

  environment                  = var.environment
  aws_region                   = var.aws_region
  private_subnet_ids           = module.vpc.private_subnet_ids
  lambda_security_group_id     = module.vpc.lambda_security_group_id
  db_secret_arn                = module.rds.db_password_secret_arn
  db_secret_name               = module.rds.db_password_secret_name
  rds_kms_key_arn              = module.rds.kms_key_arn
  cognito_user_pool_arn        = module.cognito.user_pool_arn
  documents_bucket_name        = module.s3.documents_bucket_name
  documents_bucket_arn         = module.s3.documents_bucket_arn
  s3_kms_key_arn               = module.s3.kms_key_arn
  api_execution_arn            = module.api_gateway.api_execution_arn
  from_email                   = var.ses_from_email != "" ? var.ses_from_email : "noreply@${var.domain_name}"
  domain_name                  = var.domain_name
  alerts_queue_arn             = module.sqs.alerts_queue_arn
  alerts_queue_url             = module.sqs.alerts_queue_url
  sqs_kms_key_arn              = module.sqs.kms_key_arn
  raw_interactions_bucket_name = module.s3.raw_interactions_bucket_name
  lambdas_source_path          = "${path.module}/../../backend/lambdas"

  # v2 Bedrock plumbing
  bedrock_haiku_model_arn                = module.bedrock.haiku_model_arn
  bedrock_sonnet_model_arn               = module.bedrock.sonnet_model_arn
  bedrock_haiku_foundation_model_arn     = module.bedrock.haiku_foundation_model_arn
  bedrock_sonnet_foundation_model_arn    = module.bedrock.sonnet_foundation_model_arn
  bedrock_guardrail_arn                  = module.bedrock.guardrail_arn
  bedrock_guardrail_id                   = module.bedrock.guardrail_id
  bedrock_guardrail_version              = module.bedrock.guardrail_version
  bedrock_haiku_model_id                 = module.bedrock.haiku_model_id
  bedrock_sonnet_model_id                = module.bedrock.sonnet_model_id
  bedrock_router_provisioned_concurrency = var.bedrock_router_provisioned_concurrency
  soft_rate_limit_per_patient            = var.soft_rate_limit_per_patient
  hard_rate_limit_per_patient            = var.hard_rate_limit_per_patient

  # F17 — push transport. Empty string means "no push transport configured";
  # the lambdas log a warning and short-circuit (no SNS publish, alerts.send_error
  # = 'no_transport_or_no_device_token'). Set ANDROID_PLATFORM_ARN to the
  # `aws sns create-platform-application` ARN once the Platform App is
  # provisioned (dev: arn:aws:sns:ap-south-1:316643066568:app/GCM/carelog-android-fcm-dev).
  # ios_platform_arn left empty pending APNs work (see iOS scope hold).
  android_platform_arn = var.android_platform_arn
  ios_platform_arn     = var.ios_platform_arn
}

# EventBridge Module (scheduled rules for proactive monitoring)
module "eventbridge" {
  source = "./modules/eventbridge"

  environment                           = var.environment
  check_daily_deadline_lambda_arn       = module.lambda.check_daily_deadline_arn
  check_daily_deadline_lambda_name      = module.lambda.check_daily_deadline_function_name
  check_missed_measurements_lambda_arn  = module.lambda.check_missed_measurements_arn
  check_missed_measurements_lambda_name = module.lambda.check_missed_measurements_function_name

  # v2 daily cost-telemetry rollup
  cost_telemetry_rollup_lambda_arn  = module.lambda.cost_telemetry_rollup_arn
  cost_telemetry_rollup_lambda_name = module.lambda.cost_telemetry_rollup_function_name

  # F2 — hourly stale-session sweep
  expire_stale_sessions_lambda_arn  = module.lambda.expire_stale_sessions_arn
  expire_stale_sessions_lambda_name = module.lambda.expire_stale_sessions_function_name
}

# Monitoring Module (CloudWatch alarms, SNS, dashboard)
module "monitoring" {
  count  = var.alert_email != "" ? 1 : 0
  source = "./modules/monitoring"

  environment                             = var.environment
  alert_email                             = var.alert_email
  lambda_function_names                   = module.lambda.all_function_names
  construct_fhir_batch_function_name      = module.lambda.construct_fhir_batch_function_name
  evaluate_thresholds_batch_function_name = module.lambda.evaluate_thresholds_batch_function_name
  api_gateway_name                        = module.api_gateway.api_name
  api_gateway_stage                       = module.api_gateway.stage_name
  rds_instance_id                         = module.rds.db_instance_id
  sqs_queue_name                          = module.sqs.document_processing_queue_name
  dlq_queue_name                          = module.sqs.document_processing_dlq_name
  alerts_dlq_queue_name                   = module.sqs.alerts_dlq_name
}

# Bastion Module (for SSM port-forwarding to RDS)
module "bastion" {
  count  = var.enable_bastion ? 1 : 0
  source = "./modules/bastion"

  environment           = var.environment
  vpc_id                = module.vpc.vpc_id
  public_subnet_id      = module.vpc.public_subnet_ids[0]
  rds_security_group_id = module.vpc.rds_security_group_id
}

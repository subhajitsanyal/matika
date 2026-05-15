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

data "aws_caller_identity" "current" {}

# Lambda function ARNs for Cognito triggers — built as deterministic
# strings to break the cycle between the lambda module (needs
# user_pool_arn for env vars + IAM resource constraints) and the cognito
# module (needs lambda ARNs for `lambda_config`). Using
# `module.lambda.post_*_arn` directly here would form a graph cycle even
# though the resource-level dependency order is well-defined.
# `depends_on = [module.lambda]` re-introduces the cycle; we don't use
# it. Cognito accepts the ARN as a well-formed string at create time
# (no existence check), and on a fresh stand-up the runtime invocation
# isn't attempted until the lambda is in place.
locals {
  post_confirmation_lambda_arn   = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:carelog-${var.environment}-post-confirmation"
  post_authentication_lambda_arn = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:carelog-${var.environment}-post-authentication"
}

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
#
# `lambda_config` (PostConfirmation + PostAuthentication triggers) is
# declared inline by this module, fed the lambda ARNs below. The previous
# null_resource workaround called `aws cognito-idp update-user-pool
# --lambda-config …` which replaces — not merges — the full user-pool
# config and clobbered email_configuration / device_configuration /
# user_pool_add_ons / verification_message_template every apply.
# Resource-level deps: lambda functions → cognito user pool → lambda
# permissions. No cycle.
module "cognito" {
  source = "./modules/cognito"

  environment             = var.environment
  mobile_callback_urls    = ["carelog://callback", "carelog://signin"]
  mobile_logout_urls      = ["carelog://signout"]
  web_callback_urls       = var.environment == "prod" ? ["https://portal.${var.domain_name}/callback"] : ["https://portal.${var.environment}.${var.domain_name}/callback"]
  web_logout_urls         = var.environment == "prod" ? ["https://portal.${var.domain_name}/logout"] : ["https://portal.${var.environment}.${var.domain_name}/logout"]
  ses_email_arn           = var.ses_email_arn
  ses_from_email          = var.ses_from_email
  domain_name             = var.domain_name
  post_confirmation_arn   = local.post_confirmation_lambda_arn
  post_authentication_arn = local.post_authentication_lambda_arn

  # No `depends_on = [module.lambda]` — lambda module depends back on
  # cognito.user_pool_arn for env vars + IAM policies, so a depends_on
  # here would re-form the cycle. Cognito accepts the lambda ARN as a
  # well-formed string without validating function existence at
  # create-time; on a fresh stand-up the apply orders cognito before
  # lambda, but the trigger only fires at runtime by which point the
  # lambda exists. The associated `aws_lambda_permission.post_*_cognito`
  # resources (in the lambda module) authorize the invocation.
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

  # F29 / CG-V2-16 — DPDP right-to-erasure (DELETE /patients/{patientId})
  delete_patient_invoke_arn = module.lambda.delete_patient_invoke_arn

  # Stream C — DPDP consent (GET/POST/DELETE /consent)
  consent_invoke_arn = module.lambda.consent_invoke_arn
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

  # F17 — push transport. Sourced from the SNS module so the platform-app
  # lifecycle (create/replace) propagates to the consuming lambda env vars
  # automatically. Was previously sourced from var.android_platform_arn
  # while lambda source-code-hash drift was being reconciled; that drift
  # class is now resolved (commit f284a06), so the module reference is safe.
  # iOS APNs is parked behind module.sns count=0 — empty string output
  # falls through to the lambdas' graceful-degradation path.
  android_platform_arn = module.sns.android_platform_application_arn
  ios_platform_arn     = module.sns.ios_platform_application_arn
}

# SNS Module (push transport: FCM HTTP v1 platform app + bundled topics
# + delivery-status logging role). Imported from the live AWS resource
# created out-of-band in 2026-05-11 for F17 (`aws sns
# create-platform-application` against the FCM service-account JSON
# stored at `carelog-dev/fcm-service-account` in Secrets Manager). See
# `setup-and-deployment-guide.md` §6.6 for the runbook used.
data "aws_secretsmanager_secret_version" "fcm_credential" {
  secret_id = "carelog-${var.environment}/fcm-service-account"
}

module "sns" {
  source = "./modules/sns"

  project_name = "carelog"
  environment  = var.environment

  # FCM HTTP v1 service-account JSON. The lifecycle-ignore on the
  # platform application means this only matters at first apply / when
  # rotating; subsequent plans skip the diff.
  fcm_server_key = data.aws_secretsmanager_secret_version.fcm_credential.secret_string

  # iOS APNs is gated by a non-empty cert + key in the module; leave both
  # empty for v2.0 (Android-only).
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

  # Phase 2 telemetry — vital coverage rollup (§4.7)
  vital_coverage_rollup_lambda_arn  = module.lambda.vital_coverage_rollup_arn
  vital_coverage_rollup_lambda_name = module.lambda.vital_coverage_rollup_function_name

  # Stream A5 — three more Phase 2 telemetry rollups (§4.7)
  conversation_session_rollup_lambda_arn  = module.lambda.conversation_session_rollup_arn
  conversation_session_rollup_lambda_name = module.lambda.conversation_session_rollup_function_name
  alert_flow_rollup_lambda_arn            = module.lambda.alert_flow_rollup_arn
  alert_flow_rollup_lambda_name           = module.lambda.alert_flow_rollup_function_name
  patient_engagement_rollup_lambda_arn    = module.lambda.patient_engagement_rollup_arn
  patient_engagement_rollup_lambda_name   = module.lambda.patient_engagement_rollup_function_name
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

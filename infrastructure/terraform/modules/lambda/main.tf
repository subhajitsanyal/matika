# CareLog Lambda Module
#
# Deploys all Lambda functions with IAM roles, CloudWatch log groups,
# and permissions for API Gateway / Cognito triggers.

locals {
  function_prefix = "carelog-${var.environment}"
  # Extract user pool ID from ARN: arn:aws:cognito-idp:REGION:ACCOUNT:userpool/POOL_ID
  cognito_user_pool_id = element(split("/", var.cognito_user_pool_arn), 1)

  # Common environment variables for functions that access RDS
  rds_env = {
    DB_SECRET_NAME       = var.db_secret_name
    COGNITO_USER_POOL_ID = local.cognito_user_pool_id
  }
}

# ============================================================
# IAM ROLES
# ============================================================

# Base assume-role policy for all Lambda functions
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Role 1: RDS + Cognito (post-confirmation, create-patient, accept-invite)
resource "aws_iam_role" "lambda_rds_cognito" {
  name               = "${local.function_prefix}-lambda-rds-cognito"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "rds_cognito_vpc" {
  role       = aws_iam_role.lambda_rds_cognito.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "rds_cognito_inline" {
  name = "rds-cognito-access"
  role = aws_iam_role.lambda_rds_cognito.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.db_secret_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.rds_kms_key_arn]
      },
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminUpdateUserAttributes"
        ]
        Resource = [var.cognito_user_pool_arn]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          var.documents_bucket_arn,
          "${var.documents_bucket_arn}/*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.s3_kms_key_arn]
      },
      {
        # F17 — SNS Platform Endpoint lifecycle for device-token Lambda.
        # Resource = "*" because Platform Endpoint ARNs are minted at
        # registration time and aren't known to terraform. Constrained
        # by action set: only endpoint-attribute mutations, no Publish
        # (notification-sender's role has Publish; device-token does not).
        Effect = "Allow"
        Action = [
          "sns:CreatePlatformEndpoint",
          "sns:GetEndpointAttributes",
          "sns:SetEndpointAttributes",
          "sns:DeleteEndpoint"
        ]
        Resource = ["*"]
      },
      {
        # F23 — create-patient-from-voice (and the existing create-patient,
        # which has been silently failing its welcome-email send path)
        # both share this role and need SES SendEmail to deliver the
        # patient invite email. Resource="*" matches the lambda_rds_ses
        # role's pattern; SES sender is restricted by var.from_email at
        # the env-var level instead.
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = ["*"]
      }
    ]
  })
}

# Role 2: RDS + SES (invite-attendant, invite-doctor)
resource "aws_iam_role" "lambda_rds_ses" {
  name               = "${local.function_prefix}-lambda-rds-ses"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "rds_ses_vpc" {
  role       = aws_iam_role.lambda_rds_ses.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "rds_ses_inline" {
  name = "rds-ses-access"
  role = aws_iam_role.lambda_rds_ses.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.db_secret_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.rds_kms_key_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail", "ses:GetIdentityVerificationAttributes"]
        Resource = ["*"]
      },
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = ["*"]
      },
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminUpdateUserAttributes"
        ]
        Resource = [var.cognito_user_pool_arn]
      }
    ]
  })
}

# Role 3: S3 (presigned-url)
resource "aws_iam_role" "lambda_s3" {
  name               = "${local.function_prefix}-lambda-s3"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "s3_vpc" {
  role       = aws_iam_role.lambda_s3.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "s3_inline" {
  name = "s3-access"
  role = aws_iam_role.lambda_s3.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${var.documents_bucket_arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [var.documents_bucket_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [var.s3_kms_key_arn]
      }
    ]
  })
}

# Role 5: RDS + S3 + Lambda invoke (fetch-session-config, store-interaction, construct-fhir-batch)
resource "aws_iam_role" "lambda_rds_s3_invoke" {
  name               = "${local.function_prefix}-lambda-rds-s3-invoke"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "rds_s3_invoke_vpc" {
  role       = aws_iam_role.lambda_rds_s3_invoke.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "rds_s3_invoke_inline" {
  name = "rds-s3-invoke-access"
  role = aws_iam_role.lambda_rds_s3_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.db_secret_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
        Resource = [var.rds_kms_key_arn, var.s3_kms_key_arn]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          var.documents_bucket_arn,
          "${var.documents_bucket_arn}/*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = ["*"]
      }
    ]
  })
}

# Role 6: RDS + SQS (evaluate-thresholds-batch, check-daily-deadline, check-missed-measurements)
resource "aws_iam_role" "lambda_rds_sqs" {
  name               = "${local.function_prefix}-lambda-rds-sqs"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "rds_sqs_vpc" {
  role       = aws_iam_role.lambda_rds_sqs.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "rds_sqs_inline" {
  name = "rds-sqs-access"
  role = aws_iam_role.lambda_rds_sqs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.db_secret_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.rds_kms_key_arn]
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = [var.alerts_queue_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [var.sqs_kms_key_arn]
      },
      {
        # F17 — sns:Publish for notification-sender against the per-device
        # SNS Platform Endpoints minted by device-token, plus
        # sns:CreatePlatformEndpoint because notification-sender does its
        # own per-call CreatePlatformEndpoint with the FCM token (the
        # call is idempotent — re-using an existing endpoint is fine).
        # Endpoint ARNs aren't predictable at terraform-plan time so
        # Resource = "*"; the role only carries
        # publish + endpoint-mint (no endpoint-delete / attribute
        # mutation), which scopes the blast radius enough for v2 dev.
        Effect   = "Allow"
        Action   = ["sns:Publish", "sns:CreatePlatformEndpoint"]
        Resource = ["*"]
      }
    ]
  })
}

# Role 4: HealthLake (sync-observation, bulk-sync)
resource "aws_iam_role" "lambda_healthlake" {
  name               = "${local.function_prefix}-lambda-healthlake"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "healthlake_vpc" {
  role       = aws_iam_role.lambda_healthlake.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "healthlake_inline" {
  name = "healthlake-access"
  role = aws_iam_role.lambda_healthlake.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "healthlake:CreateResource",
          "healthlake:UpdateResource",
          "healthlake:ReadResource",
          "healthlake:SearchWithPost",
          "healthlake:SearchWithGet"
        ]
        Resource = ["*"]
      }
    ]
  })
}

# ============================================================
# ARCHIVE FILES (zip each Lambda)
# ============================================================

data "archive_file" "post_confirmation" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/post-confirmation"
  output_path = "${path.module}/archives/post-confirmation.zip"
}

# Cognito PostAuthentication trigger — stamps users.last_login_at on
# every successful sign-in. See docs/testing_todos_v2.md F1.
data "archive_file" "post_authentication" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/post-authentication"
  output_path = "${path.module}/archives/post-authentication.zip"
}

# F2 — explicit-close half. POST /sessions/{sessionId}/end marks an
# in_progress interaction_session row as 'complete' when the patient
# (or caregiver) hits Stop without saying "I'm done".
data "archive_file" "end_session" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/end-session"
  output_path = "${path.module}/archives/end-session.zip"
}

# F2 — sweep half. EventBridge cron flips long-idle in_progress rows
# to 'incomplete' (catches app crashes, force-stops, network drops).
data "archive_file" "expire_stale_sessions" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/expire-stale-sessions"
  output_path = "${path.module}/archives/expire-stale-sessions.zip"
}

# Phase 2 telemetry — first of the §4.7 rollup-lambda set. Hourly
# cron via EventBridge; recomputes vital_coverage_daily for today +
# yesterday in each patient's tz across all active parameter_configs.
# See backend/lambdas/vital-coverage-rollup/index.js for the SQL.
data "archive_file" "vital_coverage_rollup" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/vital-coverage-rollup"
  output_path = "${path.module}/archives/vital-coverage-rollup.zip"
}

# F23 — voice-extracted patient creation. Direct-invoke only (no API
# Gateway route); bedrock-router calls this at the caregiver_onboarding
# mid-session pivot. See spec §4.5 / §6.9.
data "archive_file" "create_patient_from_voice" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/create-patient-from-voice"
  output_path = "${path.module}/archives/create-patient-from-voice.zip"
}

data "archive_file" "create_patient" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/create-patient"
  output_path = "${path.module}/archives/create-patient.zip"
}

# F29 / CG-V2-16 — DPDP right-to-erasure. Soft-delete cascade on patients
# (observations, alerts, persona_links, parameter_configs, reminders, etc.).
# Was CLI-deployed Apr 27 and never declared in terraform; brought into
# state during launch-execution-2 (commit reconciles config to live).
data "archive_file" "delete_patient" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/delete-patient"
  output_path = "${path.module}/archives/delete-patient.zip"
}

data "archive_file" "accept_invite" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/accept-invite"
  output_path = "${path.module}/archives/accept-invite.zip"
}

data "archive_file" "invite_attendant" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/invite-attendant"
  output_path = "${path.module}/archives/invite-attendant.zip"
}

data "archive_file" "invite_doctor" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/invite-doctor"
  output_path = "${path.module}/archives/invite-doctor.zip"
}

data "archive_file" "care_team" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/care-team"
  output_path = "${path.module}/archives/care-team.zip"
}

data "archive_file" "process_pending_invites" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/process-pending-invites"
  output_path = "${path.module}/archives/process-pending-invites.zip"
}

data "archive_file" "patient_summary" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/patient-summary"
  output_path = "${path.module}/archives/patient-summary.zip"
}

data "archive_file" "get_observations" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/get-observations"
  output_path = "${path.module}/archives/get-observations.zip"
}

data "archive_file" "sync_observation" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/sync-observation"
  output_path = "${path.module}/archives/sync-observation.zip"
}

data "archive_file" "bulk_sync" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/bulk-sync"
  output_path = "${path.module}/archives/bulk-sync.zip"
}

data "archive_file" "presigned_url" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/presigned-url"
  output_path = "${path.module}/archives/presigned-url.zip"
}

data "archive_file" "fetch_session_config" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/fetch-session-config"
  output_path = "${path.module}/archives/fetch-session-config.zip"
}

data "archive_file" "store_interaction" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/store-interaction"
  output_path = "${path.module}/archives/store-interaction.zip"
}

data "archive_file" "construct_fhir_batch" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/construct-fhir-batch"
  output_path = "${path.module}/archives/construct-fhir-batch.zip"
}

data "archive_file" "evaluate_thresholds_batch" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/evaluate-thresholds-batch"
  output_path = "${path.module}/archives/evaluate-thresholds-batch.zip"
}

data "archive_file" "check_daily_deadline" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/check-daily-deadline"
  output_path = "${path.module}/archives/check-daily-deadline.zip"
}

data "archive_file" "check_missed_measurements" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/check-missed-measurements"
  output_path = "${path.module}/archives/check-missed-measurements.zip"
}

data "archive_file" "manage_recommendations" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/manage-recommendations"
  output_path = "${path.module}/archives/manage-recommendations.zip"
}

data "archive_file" "manage_parameter_configs" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/manage-parameter-configs"
  output_path = "${path.module}/archives/manage-parameter-configs.zip"
}

data "archive_file" "manage_interactions" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/manage-interactions"
  output_path = "${path.module}/archives/manage-interactions.zip"
}

data "archive_file" "manage_prompts" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/manage-prompts"
  output_path = "${path.module}/archives/manage-prompts.zip"
}

data "archive_file" "notification_sender" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/notification-sender"
  output_path = "${path.module}/archives/notification-sender.zip"
}

data "archive_file" "alert_crud" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/alert-crud"
  output_path = "${path.module}/archives/alert-crud.zip"
}

data "archive_file" "threshold_crud" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/threshold-crud"
  output_path = "${path.module}/archives/threshold-crud.zip"
}

data "archive_file" "device_token" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/device-token"
  output_path = "${path.module}/archives/device-token.zip"
}

data "archive_file" "reminder_crud" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/reminder-crud"
  output_path = "${path.module}/archives/reminder-crud.zip"
}

data "archive_file" "remove_team_member" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/remove-team-member"
  output_path = "${path.module}/archives/remove-team-member.zip"
}

# ============================================================
# LAMBDA FUNCTIONS
# ============================================================

resource "aws_lambda_function" "post_authentication" {
  function_name    = "${local.function_prefix}-post-authentication"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 10
  memory_size      = 192
  filename         = data.archive_file.post_authentication.output_path
  source_code_hash = data.archive_file.post_authentication.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

# F2 — explicit-close endpoint behind POST /sessions/{sessionId}/end.
resource "aws_lambda_function" "end_session" {
  function_name    = "${local.function_prefix}-end-session"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 10
  memory_size      = 192
  filename         = data.archive_file.end_session.output_path
  source_code_hash = data.archive_file.end_session.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

# F2 — hourly EventBridge sweep that closes long-idle sessions.
resource "aws_lambda_function" "expire_stale_sessions" {
  function_name    = "${local.function_prefix}-expire-stale-sessions"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.expire_stale_sessions.output_path
  source_code_hash = data.archive_file.expire_stale_sessions.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      SESSION_IDLE_MINUTES = tostring(var.session_idle_minutes)
    })
  }
}

# Phase 2 telemetry — vital coverage rollup. Hourly EventBridge cron;
# the wiring lives in the eventbridge module. Reads parameter_configs +
# observation_sync_log; upserts vital_coverage_daily.
resource "aws_lambda_function" "vital_coverage_rollup" {
  function_name    = "${local.function_prefix}-vital-coverage-rollup"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  # 60s rather than 30s — the rollup is a single CTE-heavy upsert
  # and cold-start + CTE planning + window aggregation can spike on
  # the first run after a deploy.
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.vital_coverage_rollup.output_path
  source_code_hash = data.archive_file.vital_coverage_rollup.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

# F23 — voice-extracted patient creation. Direct-invoke only.
# bedrock-router calls this via SDK Invoke at the caregiver_onboarding
# pivot turn (when complete_session fires in the profile-extraction
# phase). Atomically creates Cognito user + RDS rows + UPDATEs the
# placeholder interaction_sessions.patient_id. See spec §4.5 / §6.9.
resource "aws_lambda_function" "create_patient_from_voice" {
  function_name    = "${local.function_prefix}-create-patient-from-voice"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.create_patient_from_voice.output_path
  source_code_hash = data.archive_file.create_patient_from_voice.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      FROM_EMAIL = var.from_email
    })
  }
}

resource "aws_lambda_function" "post_confirmation" {
  function_name    = "${local.function_prefix}-post-confirmation"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.post_confirmation.output_path
  source_code_hash = data.archive_file.post_confirmation.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

resource "aws_lambda_function" "create_patient" {
  function_name    = "${local.function_prefix}-create-patient"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.create_patient.output_path
  source_code_hash = data.archive_file.create_patient.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

resource "aws_lambda_function" "accept_invite" {
  function_name    = "${local.function_prefix}-accept-invite"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.accept_invite.output_path
  source_code_hash = data.archive_file.accept_invite.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

resource "aws_lambda_function" "invite_attendant" {
  function_name    = "${local.function_prefix}-invite-attendant"
  role             = aws_iam_role.lambda_rds_ses.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.invite_attendant.output_path
  source_code_hash = data.archive_file.invite_attendant.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      FROM_EMAIL = var.from_email
    })
  }
}

resource "aws_lambda_function" "invite_doctor" {
  function_name    = "${local.function_prefix}-invite-doctor"
  role             = aws_iam_role.lambda_rds_ses.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.invite_doctor.output_path
  source_code_hash = data.archive_file.invite_doctor.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      FROM_EMAIL = var.from_email
    })
  }
}

resource "aws_lambda_function" "sync_observation" {
  function_name    = "${local.function_prefix}-sync-observation"
  role             = aws_iam_role.lambda_s3.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.sync_observation.output_path
  source_code_hash = data.archive_file.sync_observation.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = {
      S3_BUCKET_NAME = var.documents_bucket_name
      S3_KMS_KEY_ID  = var.s3_kms_key_arn
    }
  }
}

resource "aws_lambda_function" "bulk_sync" {
  function_name    = "${local.function_prefix}-bulk-sync"
  role             = aws_iam_role.lambda_s3.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 60
  memory_size      = 512
  filename         = data.archive_file.bulk_sync.output_path
  source_code_hash = data.archive_file.bulk_sync.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = {
      S3_BUCKET_NAME = var.documents_bucket_name
    }
  }
}

resource "aws_lambda_function" "presigned_url" {
  function_name    = "${local.function_prefix}-presigned-url"
  role             = aws_iam_role.lambda_s3.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 15
  memory_size      = 128
  filename         = data.archive_file.presigned_url.output_path
  source_code_hash = data.archive_file.presigned_url.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = {
      S3_BUCKET_NAME = var.documents_bucket_name
      S3_KMS_KEY_ID  = var.s3_kms_key_arn
    }
  }
}

resource "aws_lambda_function" "patient_summary" {
  function_name    = "${local.function_prefix}-patient-summary"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.patient_summary.output_path
  source_code_hash = data.archive_file.patient_summary.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      OBSERVATIONS_BUCKET = var.documents_bucket_name
    })
  }
}

resource "aws_lambda_function" "get_observations" {
  function_name    = "${local.function_prefix}-get-observations"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.get_observations.output_path
  source_code_hash = data.archive_file.get_observations.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      OBSERVATIONS_BUCKET = var.documents_bucket_name
    })
  }
}

resource "aws_lambda_function" "care_team" {
  function_name    = "${local.function_prefix}-care-team"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.care_team.output_path
  source_code_hash = data.archive_file.care_team.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

resource "aws_lambda_function" "fetch_session_config" {
  function_name    = "${local.function_prefix}-fetch-session-config"
  role             = aws_iam_role.lambda_rds_s3_invoke.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.fetch_session_config.output_path
  source_code_hash = data.archive_file.fetch_session_config.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      S3_FHIR_BUCKET = var.documents_bucket_name
    })
  }
}

resource "aws_lambda_function" "store_interaction" {
  function_name    = "${local.function_prefix}-store-interaction"
  role             = aws_iam_role.lambda_rds_s3_invoke.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 60
  memory_size      = 512
  filename         = data.archive_file.store_interaction.output_path
  source_code_hash = data.archive_file.store_interaction.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      S3_RAW_BUCKET = var.raw_interactions_bucket_name
    })
  }
}

resource "aws_lambda_function" "construct_fhir_batch" {
  function_name    = "${local.function_prefix}-construct-fhir-batch"
  role             = aws_iam_role.lambda_rds_s3_invoke.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 60
  memory_size      = 512
  filename         = data.archive_file.construct_fhir_batch.output_path
  source_code_hash = data.archive_file.construct_fhir_batch.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      S3_FHIR_BUCKET                    = var.documents_bucket_name
      EVALUATE_THRESHOLDS_FUNCTION_NAME = "${local.function_prefix}-evaluate-thresholds-batch"
    })
  }
}

resource "aws_lambda_function" "evaluate_thresholds_batch" {
  function_name    = "${local.function_prefix}-evaluate-thresholds-batch"
  role             = aws_iam_role.lambda_rds_sqs.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 60
  memory_size      = 512
  filename         = data.archive_file.evaluate_thresholds_batch.output_path
  source_code_hash = data.archive_file.evaluate_thresholds_batch.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      SQS_ALERT_QUEUE_URL = var.alerts_queue_url
    })
  }
}

resource "aws_lambda_function" "check_daily_deadline" {
  function_name    = "${local.function_prefix}-check-daily-deadline"
  role             = aws_iam_role.lambda_rds_sqs.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 120
  memory_size      = 256
  filename         = data.archive_file.check_daily_deadline.output_path
  source_code_hash = data.archive_file.check_daily_deadline.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      SQS_ALERT_QUEUE_URL = var.alerts_queue_url
    })
  }
}

resource "aws_lambda_function" "check_missed_measurements" {
  function_name    = "${local.function_prefix}-check-missed-measurements"
  role             = aws_iam_role.lambda_rds_sqs.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 120
  memory_size      = 256
  filename         = data.archive_file.check_missed_measurements.output_path
  source_code_hash = data.archive_file.check_missed_measurements.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      SQS_ALERT_QUEUE_URL = var.alerts_queue_url
    })
  }
}

resource "aws_lambda_function" "manage_recommendations" {
  function_name    = "${local.function_prefix}-manage-recommendations"
  role             = aws_iam_role.lambda_rds_s3_invoke.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.manage_recommendations.output_path
  source_code_hash = data.archive_file.manage_recommendations.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

resource "aws_lambda_function" "manage_parameter_configs" {
  function_name    = "${local.function_prefix}-manage-parameter-configs"
  role             = aws_iam_role.lambda_rds_s3_invoke.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.manage_parameter_configs.output_path
  source_code_hash = data.archive_file.manage_parameter_configs.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

resource "aws_lambda_function" "manage_interactions" {
  function_name    = "${local.function_prefix}-manage-interactions"
  role             = aws_iam_role.lambda_rds_s3_invoke.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.manage_interactions.output_path
  source_code_hash = data.archive_file.manage_interactions.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      S3_RAW_BUCKET = var.raw_interactions_bucket_name
    })
  }
}

resource "aws_lambda_function" "manage_prompts" {
  function_name    = "${local.function_prefix}-manage-prompts"
  role             = aws_iam_role.lambda_rds_s3_invoke.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.manage_prompts.output_path
  source_code_hash = data.archive_file.manage_prompts.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

resource "aws_lambda_function" "process_pending_invites" {
  function_name    = "${local.function_prefix}-process-pending-invites"
  role             = aws_iam_role.lambda_rds_ses.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.process_pending_invites.output_path
  source_code_hash = data.archive_file.process_pending_invites.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      FROM_EMAIL = var.from_email
    })
  }
}

resource "aws_lambda_function" "notification_sender" {
  function_name    = "${local.function_prefix}-notification-sender"
  role             = aws_iam_role.lambda_rds_sqs.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.notification_sender.output_path
  source_code_hash = data.archive_file.notification_sender.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      SQS_ALERT_QUEUE_URL = var.alerts_queue_url
      # F17 — SNS Platform Application ARNs for sns:Publish. Defaults to
      # empty string in environments that haven't provisioned the SNS
      # Platform Apps yet (e.g., dev today, blocked on FCM credentials);
      # notification-sender treats empty as "no_transport_or_no_device_token"
      # and stamps alerts.is_sent=false, send_error accordingly.
      ANDROID_PLATFORM_ARN = var.android_platform_arn
      IOS_PLATFORM_ARN     = var.ios_platform_arn
    })
  }
}

resource "aws_lambda_function" "alert_crud" {
  function_name    = "${local.function_prefix}-alert-crud"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.alert_crud.output_path
  source_code_hash = data.archive_file.alert_crud.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

# F29 / CG-V2-16 — DPDP right-to-erasure
resource "aws_lambda_function" "delete_patient" {
  function_name    = "${local.function_prefix}-delete-patient"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.delete_patient.output_path
  source_code_hash = data.archive_file.delete_patient.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

resource "aws_lambda_function" "threshold_crud" {
  function_name    = "${local.function_prefix}-threshold-crud"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.threshold_crud.output_path
  source_code_hash = data.archive_file.threshold_crud.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

resource "aws_lambda_function" "device_token" {
  function_name    = "${local.function_prefix}-device-token"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.device_token.output_path
  source_code_hash = data.archive_file.device_token.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.rds_env, {
      # F17 — same as notification-sender. Empty in unprovisioned envs;
      # the lambda's graceful-degradation path stores rows with
      # endpoint_arn=NULL and skips SNS calls.
      ANDROID_PLATFORM_ARN = var.android_platform_arn
      IOS_PLATFORM_ARN     = var.ios_platform_arn
    })
  }
}

resource "aws_lambda_function" "reminder_crud" {
  function_name    = "${local.function_prefix}-reminder-crud"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.reminder_crud.output_path
  source_code_hash = data.archive_file.reminder_crud.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

resource "aws_lambda_function" "remove_team_member" {
  function_name    = "${local.function_prefix}-remove-team-member"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.remove_team_member.output_path
  source_code_hash = data.archive_file.remove_team_member.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

# Wait for IAM policy to propagate before creating SQS event source mapping.
# AWS IAM is eventually consistent — the Lambda service may not see the new
# SQS permissions for up to 30 seconds after the policy is created.
resource "null_resource" "wait_for_sqs_iam" {
  depends_on = [aws_iam_role_policy.rds_sqs_inline]

  provisioner "local-exec" {
    command = "sleep 30"
  }
}

# SQS event source mapping for notification-sender
resource "aws_lambda_event_source_mapping" "notification_sender_sqs" {
  event_source_arn = var.alerts_queue_arn
  function_name    = aws_lambda_function.notification_sender.arn
  batch_size       = 1

  depends_on = [null_resource.wait_for_sqs_iam]
}

# ============================================================
# CLOUDWATCH LOG GROUPS
# ============================================================

resource "aws_cloudwatch_log_group" "post_confirmation" {
  name              = "/aws/lambda/${aws_lambda_function.post_confirmation.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "post_authentication" {
  name              = "/aws/lambda/${aws_lambda_function.post_authentication.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "create_patient" {
  name              = "/aws/lambda/${aws_lambda_function.create_patient.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "accept_invite" {
  name              = "/aws/lambda/${aws_lambda_function.accept_invite.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "invite_attendant" {
  name              = "/aws/lambda/${aws_lambda_function.invite_attendant.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "invite_doctor" {
  name              = "/aws/lambda/${aws_lambda_function.invite_doctor.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "sync_observation" {
  name              = "/aws/lambda/${aws_lambda_function.sync_observation.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "bulk_sync" {
  name              = "/aws/lambda/${aws_lambda_function.bulk_sync.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "presigned_url" {
  name              = "/aws/lambda/${aws_lambda_function.presigned_url.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "care_team" {
  name              = "/aws/lambda/${aws_lambda_function.care_team.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "process_pending_invites" {
  name              = "/aws/lambda/${aws_lambda_function.process_pending_invites.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "patient_summary" {
  name              = "/aws/lambda/${aws_lambda_function.patient_summary.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "get_observations" {
  name              = "/aws/lambda/${aws_lambda_function.get_observations.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "fetch_session_config" {
  name              = "/aws/lambda/${aws_lambda_function.fetch_session_config.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "store_interaction" {
  name              = "/aws/lambda/${aws_lambda_function.store_interaction.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "construct_fhir_batch" {
  name              = "/aws/lambda/${aws_lambda_function.construct_fhir_batch.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "evaluate_thresholds_batch" {
  name              = "/aws/lambda/${aws_lambda_function.evaluate_thresholds_batch.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "check_daily_deadline" {
  name              = "/aws/lambda/${aws_lambda_function.check_daily_deadline.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "check_missed_measurements" {
  name              = "/aws/lambda/${aws_lambda_function.check_missed_measurements.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "manage_recommendations" {
  name              = "/aws/lambda/${aws_lambda_function.manage_recommendations.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "manage_parameter_configs" {
  name              = "/aws/lambda/${aws_lambda_function.manage_parameter_configs.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "manage_interactions" {
  name              = "/aws/lambda/${aws_lambda_function.manage_interactions.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "manage_prompts" {
  name              = "/aws/lambda/${aws_lambda_function.manage_prompts.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "notification_sender" {
  name              = "/aws/lambda/${aws_lambda_function.notification_sender.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "alert_crud" {
  name              = "/aws/lambda/${aws_lambda_function.alert_crud.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "delete_patient" {
  name              = "/aws/lambda/${aws_lambda_function.delete_patient.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "threshold_crud" {
  name              = "/aws/lambda/${aws_lambda_function.threshold_crud.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "device_token" {
  name              = "/aws/lambda/${aws_lambda_function.device_token.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "reminder_crud" {
  name              = "/aws/lambda/${aws_lambda_function.reminder_crud.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "remove_team_member" {
  name              = "/aws/lambda/${aws_lambda_function.remove_team_member.function_name}"
  retention_in_days = 365
}

# ============================================================
# API GATEWAY PERMISSIONS (allow API Gateway to invoke Lambdas)
# ============================================================

resource "aws_lambda_permission" "create_patient" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_patient.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

# F29 — narrow source_arn matches the live permission created by the
# Apr-27 CLI deployment (statement_id "apigateway-delete-patient"). Kept
# narrow rather than rewriting to the project's default broad source_arn
# so the import lands as a no-op against live state.
resource "aws_lambda_permission" "delete_patient" {
  statement_id  = "apigateway-delete-patient"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.delete_patient.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/DELETE/patients/*"
}

# F2 — POST /sessions/{sessionId}/end
resource "aws_lambda_permission" "end_session" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.end_session.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "accept_invite" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.accept_invite.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "invite_attendant" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.invite_attendant.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "invite_doctor" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.invite_doctor.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "sync_observation" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sync_observation.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "bulk_sync" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.bulk_sync.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "presigned_url" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.presigned_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "care_team" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.care_team.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "patient_summary" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.patient_summary.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "get_observations" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_observations.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "fetch_session_config" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fetch_session_config.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "store_interaction" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.store_interaction.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "construct_fhir_batch" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.construct_fhir_batch.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "manage_recommendations" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.manage_recommendations.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "manage_parameter_configs" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.manage_parameter_configs.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "manage_interactions" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.manage_interactions.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "manage_prompts" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.manage_prompts.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "alert_crud" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.alert_crud.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "threshold_crud" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.threshold_crud.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "device_token" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.device_token.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "reminder_crud" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reminder_crud.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "remove_team_member" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.remove_team_member.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

# ============================================================
# COGNITO TRIGGER PERMISSION (post-confirmation)
# ============================================================

resource "aws_lambda_permission" "post_confirmation_cognito" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.post_confirmation.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = var.cognito_user_pool_arn
}

resource "aws_lambda_permission" "post_authentication_cognito" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.post_authentication.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = var.cognito_user_pool_arn
}

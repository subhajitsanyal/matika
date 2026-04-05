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

data "archive_file" "create_patient" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/create-patient"
  output_path = "${path.module}/archives/create-patient.zip"
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

# ============================================================
# LAMBDA FUNCTIONS
# ============================================================

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
    variables = {
      OBSERVATIONS_BUCKET = var.documents_bucket_name
    }
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

# ============================================================
# CLOUDWATCH LOG GROUPS
# ============================================================

resource "aws_cloudwatch_log_group" "post_confirmation" {
  name              = "/aws/lambda/${aws_lambda_function.post_confirmation.function_name}"
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

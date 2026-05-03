# Matika v2 — Bedrock-backed Lambdas
#
# Owner: devops agent. Function code, prompts, and runtime config owned by
# backend + inference-platform agents (see AGENTS.md §3).
#
# Four functions land here:
#   - matika-${env}-bedrock-router       → POST /conversation/turn,
#                                          POST /conversation/turn-stream
#   - matika-${env}-bedrock-vision       → POST /conversation/photo-extract
#   - matika-${env}-cost-telemetry-rollup → EventBridge daily cron
#   - matika-${env}-health-check         → GET /health
#
# All four are TypeScript with handler at `dist/src/index.handler` (tsc keeps
# rootDir = . so src/index.ts → dist/src/index.js). The build
# helper script `backend/lambdas/build-v2.sh` MUST run before `terraform
# apply` — it does `npm ci && npm run build && npm prune --production`,
# leaving dist/ + production-only node_modules/ in place for archive_file
# to pick up. Source dirs (src/, __tests__/) are excluded from the zip.

# Fetch the RDS master credentials so we can pass connection params as env
# vars. The v2 Lambdas use node-postgres's Pool which falls back to
# PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE env vars when no connection
# string is provided. This keeps secrets in Terraform state (already
# sensitive) rather than stored long-term in Lambda config.
#
# Follow-up (T-V2-046): replace with a runtime SecretsManager fetch on
# Lambda cold-start so credentials don't sit in env vars at all.
data "aws_secretsmanager_secret_version" "v2_db_credentials" {
  secret_id = var.db_secret_arn
}

locals {
  v2_db_creds = jsondecode(data.aws_secretsmanager_secret_version.v2_db_credentials.secret_string)

  # PG* env vars consumed by node-postgres when Pool({ connectionString })
  # is undefined.
  pg_env = {
    PGHOST     = local.v2_db_creds.host
    PGPORT     = tostring(local.v2_db_creds.port)
    PGUSER     = local.v2_db_creds.username
    PGPASSWORD = local.v2_db_creds.password
    PGDATABASE = local.v2_db_creds.dbname
  }

  v2_function_prefix = "matika-${var.environment}"

  # Common excludes: source files, test fixtures, configs not needed at runtime.
  # tsc compiles src/ + escalation/ + __tests__/ into dist/src, dist/escalation,
  # dist/__tests__ — exclude the test outputs too so the deployed zip is lean.
  v2_archive_excludes = [
    "src/**",
    "__tests__/**",
    "dist/__tests__/**",
    "tsconfig.json",
    "tsconfig.build.json",
    "jest.config.cjs",
    "jest.config.ts",
    ".eslintrc.cjs",
    ".eslintrc.json",
    "*.test.ts",
    "*.test.js",
    "node_modules/.cache/**",
    "node_modules/**/__tests__/**",
    "node_modules/**/*.md",
  ]

  # Bedrock env vars shared by router, vision, and health-check.
  bedrock_env_common = {
    BEDROCK_HAIKU_MODEL_ID    = var.bedrock_haiku_model_id
    BEDROCK_SONNET_MODEL_ID   = var.bedrock_sonnet_model_id
    BEDROCK_GUARDRAIL_ID      = var.bedrock_guardrail_id
    BEDROCK_GUARDRAIL_VERSION = var.bedrock_guardrail_version
    INFERENCE_PROFILE_REGION  = var.aws_region
  }
}

# ============================================================
# IAM ROLES — scoped per spec §11.4 (no bedrock:* wildcards)
# ============================================================

# Role: bedrock-router — invokes Bedrock + reads/writes DB + reads raw bucket + sends to alerts queue
resource "aws_iam_role" "lambda_bedrock_router" {
  name               = "${local.v2_function_prefix}-bedrock-router-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "bedrock_router_vpc" {
  role       = aws_iam_role.lambda_bedrock_router.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "bedrock_router_inline" {
  name = "bedrock-router-access"
  role = aws_iam_role.lambda_bedrock_router.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "InvokeBedrockProfilesAndUnderlyingModels"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        # Both inference-profile ARN and underlying foundation-model ARN must
        # be allowed when invoking via a system-defined profile.
        Resource = [
          var.bedrock_haiku_model_arn,
          var.bedrock_sonnet_model_arn,
          var.bedrock_haiku_foundation_model_arn,
          var.bedrock_sonnet_foundation_model_arn,
        ]
      },
      {
        Sid      = "ApplyGuardrail"
        Effect   = "Allow"
        Action   = ["bedrock:ApplyGuardrail"]
        Resource = [var.bedrock_guardrail_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.db_secret_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [var.rds_kms_key_arn, var.s3_kms_key_arn, var.sqs_kms_key_arn]
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::${var.raw_interactions_bucket_name}",
          "arn:aws:s3:::${var.raw_interactions_bucket_name}/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:GetQueueUrl", "sqs:GetQueueAttributes"]
        Resource = [var.alerts_queue_arn]
      },
    ]
  })
}

# Role: bedrock-vision — invokes Haiku for photo OCR, reads photo from raw bucket
resource "aws_iam_role" "lambda_bedrock_vision" {
  name               = "${local.v2_function_prefix}-bedrock-vision-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "bedrock_vision_vpc" {
  role       = aws_iam_role.lambda_bedrock_vision.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "bedrock_vision_inline" {
  name = "bedrock-vision-access"
  role = aws_iam_role.lambda_bedrock_vision.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "InvokeHaikuVision"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        Resource = [
          var.bedrock_haiku_model_arn,
          var.bedrock_haiku_foundation_model_arn,
        ]
      },
      {
        Sid      = "ApplyGuardrail"
        Effect   = "Allow"
        Action   = ["bedrock:ApplyGuardrail"]
        Resource = [var.bedrock_guardrail_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.db_secret_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [var.rds_kms_key_arn, var.s3_kms_key_arn]
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::${var.raw_interactions_bucket_name}",
          "arn:aws:s3:::${var.raw_interactions_bucket_name}/*",
        ]
      },
    ]
  })
}

# Role: cost-telemetry-rollup — DB read/write only, no Bedrock
resource "aws_iam_role" "lambda_cost_rollup" {
  name               = "${local.v2_function_prefix}-cost-rollup-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "cost_rollup_vpc" {
  role       = aws_iam_role.lambda_cost_rollup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "cost_rollup_inline" {
  name = "cost-rollup-access"
  role = aws_iam_role.lambda_cost_rollup.id

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
    ]
  })
}

# Role: health-check — Bedrock 1-token ping + DB SELECT 1 + S3 list
resource "aws_iam_role" "lambda_health_check" {
  name               = "${local.v2_function_prefix}-health-check-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "health_check_vpc" {
  role       = aws_iam_role.lambda_health_check.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "health_check_inline" {
  name = "health-check-access"
  role = aws_iam_role.lambda_health_check.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "InvokeBedrockPing"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        Resource = [
          var.bedrock_haiku_model_arn,
          var.bedrock_haiku_foundation_model_arn,
        ]
      },
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
        Action = ["s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::${var.raw_interactions_bucket_name}",
        ]
      },
    ]
  })
}

# ============================================================
# ARCHIVE FILES — packaged after `backend/lambdas/build-v2.sh`
# ============================================================

data "archive_file" "bedrock_router" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/bedrock-router"
  output_path = "${path.module}/archives/bedrock-router.zip"
  excludes    = local.v2_archive_excludes
}

data "archive_file" "bedrock_vision" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/bedrock-vision"
  output_path = "${path.module}/archives/bedrock-vision.zip"
  excludes    = local.v2_archive_excludes
}

data "archive_file" "cost_telemetry_rollup" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/cost-telemetry-rollup"
  output_path = "${path.module}/archives/cost-telemetry-rollup.zip"
  excludes    = local.v2_archive_excludes
}

data "archive_file" "health_check" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/health-check"
  output_path = "${path.module}/archives/health-check.zip"
  excludes    = local.v2_archive_excludes
}

# ============================================================
# LAMBDA FUNCTIONS
# ============================================================

resource "aws_lambda_function" "bedrock_router" {
  function_name    = "${local.v2_function_prefix}-bedrock-router"
  role             = aws_iam_role.lambda_bedrock_router.arn
  handler          = "dist/src/index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 1024
  filename         = data.archive_file.bedrock_router.output_path
  source_code_hash = data.archive_file.bedrock_router.output_base64sha256

  # Auto-publish a numbered version on each deploy. Required so the `live`
  # alias can target a published version (provisioned concurrency rejects
  # $LATEST).
  publish = true

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.bedrock_env_common, local.pg_env, {
      DB_SECRET_NAME              = var.db_secret_name
      MATIKA_ALERT_QUEUE_URL      = var.alerts_queue_url
      SOFT_RATE_LIMIT_PER_PATIENT = var.soft_rate_limit_per_patient
      HARD_RATE_LIMIT_PER_PATIENT = var.hard_rate_limit_per_patient
      BEDROCK_MAX_TOKENS          = "1024"
    })
  }
}

# Provisioned concurrency = 1 on bedrock-router to keep cold-start out of
# patient-logging latency. Spec §11.7 — revisit when traffic profile is known.
resource "aws_lambda_alias" "bedrock_router_live" {
  name             = "live"
  function_name    = aws_lambda_function.bedrock_router.function_name
  function_version = aws_lambda_function.bedrock_router.version
}

resource "aws_lambda_provisioned_concurrency_config" "bedrock_router" {
  # Gate on the variable so dev (with the AWS default 10 concurrent-execution
  # account quota) can deploy without PC. Bump the variable to >0 once a
  # service-quota increase has been granted (T-V2-005).
  count = var.bedrock_router_provisioned_concurrency > 0 ? 1 : 0

  function_name                     = aws_lambda_function.bedrock_router.function_name
  qualifier                         = aws_lambda_alias.bedrock_router_live.name
  provisioned_concurrent_executions = var.bedrock_router_provisioned_concurrency

  lifecycle {
    # Avoid contention with Lambda code redeploys.
    ignore_changes = [provisioned_concurrent_executions]
  }
}

resource "aws_lambda_function" "bedrock_vision" {
  function_name    = "${local.v2_function_prefix}-bedrock-vision"
  role             = aws_iam_role.lambda_bedrock_vision.arn
  handler          = "dist/src/index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 512
  filename         = data.archive_file.bedrock_vision.output_path
  source_code_hash = data.archive_file.bedrock_vision.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.bedrock_env_common, local.pg_env, {
      DB_SECRET_NAME          = var.db_secret_name
      RAW_INTERACTIONS_BUCKET = var.raw_interactions_bucket_name
    })
  }
}

resource "aws_lambda_function" "cost_telemetry_rollup" {
  function_name    = "${local.v2_function_prefix}-cost-telemetry-rollup"
  role             = aws_iam_role.lambda_cost_rollup.arn
  handler          = "dist/src/index.handler"
  runtime          = "nodejs20.x"
  timeout          = 300 # 5 min — daily aggregation across all patients
  memory_size      = 512
  filename         = data.archive_file.cost_telemetry_rollup.output_path
  source_code_hash = data.archive_file.cost_telemetry_rollup.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.pg_env, {
      DB_SECRET_NAME = var.db_secret_name
    })
  }
}

resource "aws_lambda_function" "health_check" {
  function_name    = "${local.v2_function_prefix}-health-check"
  role             = aws_iam_role.lambda_health_check.arn
  handler          = "dist/src/index.handler"
  runtime          = "nodejs20.x"
  timeout          = 15
  memory_size      = 256
  filename         = data.archive_file.health_check.output_path
  source_code_hash = data.archive_file.health_check.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = merge(local.bedrock_env_common, local.pg_env, {
      DB_SECRET_NAME          = var.db_secret_name
      RAW_INTERACTIONS_BUCKET = var.raw_interactions_bucket_name
    })
  }
}

# ============================================================
# CLOUDWATCH LOG GROUPS (HIPAA: 365-day retention)
# ============================================================

resource "aws_cloudwatch_log_group" "bedrock_router" {
  name              = "/aws/lambda/${aws_lambda_function.bedrock_router.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "bedrock_vision" {
  name              = "/aws/lambda/${aws_lambda_function.bedrock_vision.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "cost_telemetry_rollup" {
  name              = "/aws/lambda/${aws_lambda_function.cost_telemetry_rollup.function_name}"
  retention_in_days = 365
}

resource "aws_cloudwatch_log_group" "health_check" {
  name              = "/aws/lambda/${aws_lambda_function.health_check.function_name}"
  retention_in_days = 365
}

# ============================================================
# API GATEWAY INVOKE PERMISSIONS
# ============================================================

resource "aws_lambda_permission" "bedrock_router_apigw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.bedrock_router.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"

  # Provisioned concurrency lives on the alias, not $LATEST — the API Gateway
  # integration URI uses the unqualified function ARN, so this permission
  # covers both.
}

resource "aws_lambda_permission" "bedrock_vision_apigw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.bedrock_vision.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

resource "aws_lambda_permission" "health_check_apigw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.health_check.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

# cost_telemetry_rollup: invoked by EventBridge — permission lives in
# modules/eventbridge/cost_rollup.tf to keep EventBridge wiring colocated.

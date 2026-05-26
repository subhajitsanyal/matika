# Matika Care Notes Lambda — PRD §6.9 / Spec §4.6
#
# v2 naming: `matika-${env}-care-notes` per [[lambda_naming_matika_prefix]].
# Reuses the legacy `lambda_rds_cognito` role — care-notes only needs the
# Secrets Manager + KMS grants that role already carries; the cognito-idp
# permissions on the role are harmless extras. SQL-level grants are
# handled in PostgreSQL itself (the lambda connects as the schema owner
# via the credential in Secrets Manager).

data "archive_file" "care_notes" {
  type        = "zip"
  source_dir  = "${var.lambdas_source_path}/care-notes"
  output_path = "${path.module}/archives/care-notes.zip"

  # Keep the zip lean: jest + test fixtures don't ship with the runtime.
  excludes = [
    "__tests__/**",
    "*.test.js",
    "node_modules/jest/**",
    "node_modules/@jest/**",
    "node_modules/jest-*/**",
    "node_modules/.bin/jest*",
    "node_modules/.cache/**",
  ]
}

resource "aws_lambda_function" "care_notes" {
  function_name    = "${local.v2_function_prefix}-care-notes"
  role             = aws_iam_role.lambda_rds_cognito.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.care_notes.output_path
  source_code_hash = data.archive_file.care_notes.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  environment {
    variables = local.rds_env
  }
}

resource "aws_cloudwatch_log_group" "care_notes" {
  name              = "/aws/lambda/${aws_lambda_function.care_notes.function_name}"
  retention_in_days = 365
}

resource "aws_lambda_permission" "care_notes" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.care_notes.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*"
}

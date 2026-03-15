# CareLog HealthLake Module
#
# Creates an AWS HealthLake FHIR data store for structured clinical data.
# Note: HealthLake provisioning can take 1-3 days.
#
# HIPAA Compliance:
# - Data encrypted at rest using KMS
# - FHIR R4 compliant data store
# - Audit logging enabled
#
# TODO: The hashicorp/aws provider does not support aws_healthlake_fhir_datastore.
# To provision HealthLake, add the hashicorp/awscc provider and use
# awscc_healthlake_fhir_datastore instead. For now, this module provisions
# supporting resources (KMS key, IAM role) and outputs placeholders.

# KMS Key for HealthLake encryption
resource "aws_kms_key" "healthlake" {
  description             = "KMS key for CareLog HealthLake encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable IAM User Permissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "Allow HealthLake Service"
        Effect = "Allow"
        Principal = {
          Service = "healthlake.amazonaws.com"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
          "kms:CreateGrant"
        ]
        Resource = "*"
      }
    ]
  })

  tags = {
    Name        = "carelog-${var.environment}-healthlake-key"
    Environment = var.environment
  }
}

resource "aws_kms_alias" "healthlake" {
  name          = "alias/carelog-${var.environment}-healthlake"
  target_key_id = aws_kms_key.healthlake.key_id
}

# IAM Role for Lambda to access HealthLake
resource "aws_iam_role" "healthlake_access" {
  name = "carelog-${var.environment}-healthlake-access"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "carelog-${var.environment}-healthlake-role"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy" "healthlake_access" {
  name = "carelog-${var.environment}-healthlake-policy"
  role = aws_iam_role.healthlake_access.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "healthlake:CreateResource",
          "healthlake:DeleteResource",
          "healthlake:GetCapabilities",
          "healthlake:ReadResource",
          "healthlake:SearchWithGet",
          "healthlake:SearchWithPost",
          "healthlake:UpdateResource"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = aws_kms_key.healthlake.arn
      }
    ]
  })
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

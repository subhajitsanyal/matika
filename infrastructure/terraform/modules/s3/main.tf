# CareLog S3 Module
#
# Creates S3 buckets for:
# - Unstructured data (prescriptions, photos, voice notes, videos)
#
# HIPAA Compliance:
# - SSE-KMS encryption at rest
# - Versioning enabled
# - Access logging enabled
# - Lifecycle policies for cost optimization

# KMS Key for S3 encryption
resource "aws_kms_key" "s3" {
  description             = "KMS key for CareLog S3 encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "carelog-${var.environment}-s3-key"
    Environment = var.environment
  }
}

resource "aws_kms_alias" "s3" {
  name          = "alias/carelog-${var.environment}-s3"
  target_key_id = aws_kms_key.s3.key_id
}

# Access logs bucket
resource "aws_s3_bucket" "access_logs" {
  bucket = "${var.bucket_prefix}-${var.environment}-access-logs-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "carelog-${var.environment}-access-logs"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_versioning" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Documents bucket (main storage for unstructured data)
resource "aws_s3_bucket" "documents" {
  bucket = "${var.bucket_prefix}-${var.environment}-documents-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "carelog-${var.environment}-documents"
    Environment = var.environment
    HIPAA       = "true"
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_logging" "documents" {
  bucket = aws_s3_bucket.documents.id

  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "documents/"
}

# CORS configuration for presigned URL uploads from mobile apps
resource "aws_s3_bucket_cors_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "HEAD"]
    allowed_origins = var.cors_origins
    expose_headers  = ["ETag", "x-amz-meta-custom-header"]
    max_age_seconds = 3600
  }
}

# Lifecycle rules for cost optimization
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  # Move older documents to Intelligent-Tiering
  rule {
    id     = "intelligent-tiering"
    status = "Enabled"

    filter {
      prefix = ""
    }

    transition {
      days          = 90
      storage_class = "INTELLIGENT_TIERING"
    }
  }

  # Move very old documents to Glacier
  rule {
    id     = "archive-old-documents"
    status = "Enabled"

    filter {
      prefix = ""
    }

    transition {
      days          = 365
      storage_class = "GLACIER"
    }
  }

  # Delete incomplete multipart uploads
  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Keep versions for 90 days before transitioning
  rule {
    id     = "noncurrent-version-expiration"
    status = "Enabled"

    filter {
      prefix = ""
    }

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "GLACIER"
    }

    noncurrent_version_expiration {
      noncurrent_days = 365
    }
  }
}

# Bucket policy for presigned URL uploads
resource "aws_s3_bucket_policy" "documents" {
  bucket = aws_s3_bucket.documents.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnforceTLS"
        Effect = "Deny"
        Principal = "*"
        Action = "s3:*"
        Resource = [
          aws_s3_bucket.documents.arn,
          "${aws_s3_bucket.documents.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
      {
        Sid    = "EnforceEncryption"
        Effect = "Deny"
        Principal = "*"
        Action = "s3:PutObject"
        Resource = "${aws_s3_bucket.documents.arn}/*"
        Condition = {
          StringNotEquals = {
            "s3:x-amz-server-side-encryption" = "aws:kms"
          }
        }
      }
    ]
  })
}

# IAM Role for Lambda to access S3
resource "aws_iam_role" "s3_access" {
  name = "carelog-${var.environment}-s3-access"

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
    Name        = "carelog-${var.environment}-s3-role"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy" "s3_access" {
  name = "carelog-${var.environment}-s3-policy"
  role = aws_iam_role.s3_access.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.documents.arn,
          "${aws_s3_bucket.documents.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = aws_kms_key.s3.arn
      }
    ]
  })
}

# Data sources
data "aws_caller_identity" "current" {}

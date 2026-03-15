# CareLog SQS Module
#
# Creates SQS queues for:
# - S3 upload notifications (for future raw data processing)
# - Dead-letter queue for failed messages
#
# HIPAA Compliance:
# - Server-side encryption enabled
# - Access restricted via IAM policies

# KMS Key for SQS encryption
resource "aws_kms_key" "sqs" {
  description             = "KMS key for CareLog SQS encryption"
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
        Sid    = "Allow S3 Service"
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = "*"
      }
    ]
  })

  tags = {
    Name        = "carelog-${var.environment}-sqs-key"
    Environment = var.environment
  }
}

resource "aws_kms_alias" "sqs" {
  name          = "alias/carelog-${var.environment}-sqs"
  target_key_id = aws_kms_key.sqs.key_id
}

# Dead-letter queue for failed messages
resource "aws_sqs_queue" "document_processing_dlq" {
  name                       = "carelog-${var.environment}-document-processing-dlq"
  message_retention_seconds  = 1209600 # 14 days
  visibility_timeout_seconds = 300

  sqs_managed_sse_enabled = true

  tags = {
    Name        = "carelog-${var.environment}-document-dlq"
    Environment = var.environment
  }
}

# Main queue for document processing
resource "aws_sqs_queue" "document_processing" {
  name                       = "carelog-${var.environment}-document-processing"
  delay_seconds              = 0
  max_message_size           = 262144 # 256 KB
  message_retention_seconds  = 345600 # 4 days
  receive_wait_time_seconds  = 10     # Long polling
  visibility_timeout_seconds = 300    # 5 minutes

  # KMS encryption
  kms_master_key_id                 = aws_kms_key.sqs.id
  kms_data_key_reuse_period_seconds = 300

  # Redrive policy for dead-letter queue
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.document_processing_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Name        = "carelog-${var.environment}-document-queue"
    Environment = var.environment
  }
}

# Allow redrive from main queue to DLQ
resource "aws_sqs_queue_redrive_allow_policy" "document_processing_dlq" {
  queue_url = aws_sqs_queue.document_processing_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.document_processing.arn]
  })
}

# Queue policy to allow S3 to send notifications
resource "aws_sqs_queue_policy" "document_processing" {
  queue_url = aws_sqs_queue.document_processing.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowS3Notification"
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.document_processing.arn
        Condition = {
          ArnLike = {
            "aws:SourceArn" = var.documents_bucket_arn
          }
        }
      }
    ]
  })
}

# S3 bucket notification to SQS
resource "aws_s3_bucket_notification" "document_upload" {
  count  = var.documents_bucket_id != "" ? 1 : 0
  bucket = var.documents_bucket_id

  queue {
    queue_arn = aws_sqs_queue.document_processing.arn
    events    = ["s3:ObjectCreated:*"]
  }

  depends_on = [aws_sqs_queue_policy.document_processing]
}

# Alert queue for threshold breaches
resource "aws_sqs_queue" "alerts_dlq" {
  name                       = "carelog-${var.environment}-alerts-dlq"
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 300

  sqs_managed_sse_enabled = true

  tags = {
    Name        = "carelog-${var.environment}-alerts-dlq"
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "alerts" {
  name                       = "carelog-${var.environment}-alerts"
  delay_seconds              = 0
  max_message_size           = 262144
  message_retention_seconds  = 86400 # 1 day
  receive_wait_time_seconds  = 10
  visibility_timeout_seconds = 60

  kms_master_key_id                 = aws_kms_key.sqs.id
  kms_data_key_reuse_period_seconds = 300

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.alerts_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Name        = "carelog-${var.environment}-alerts-queue"
    Environment = var.environment
  }
}

# Data sources
data "aws_caller_identity" "current" {}

# SNS Push Notification Infrastructure
# Configures SNS platform applications for iOS (APNs) and Android (FCM)

# iOS APNs Platform Application
resource "aws_sns_platform_application" "ios_apns" {
  name                = "${var.project_name}-ios-apns-${var.environment}"
  platform            = var.environment == "prod" ? "APNS" : "APNS_SANDBOX"
  platform_credential = var.apns_private_key
  platform_principal  = var.apns_certificate

  # APNs authentication using token-based auth (recommended)
  # Uncomment below if using token-based auth instead of certificate
  # platform_credential = var.apns_signing_key
  # platform_principal  = var.apns_key_id
  # apple_platform_team_id = var.apple_team_id
  # apple_platform_bundle_id = var.ios_bundle_id

  event_endpoint_created_topic_arn = aws_sns_topic.endpoint_events.arn
  event_endpoint_deleted_topic_arn = aws_sns_topic.endpoint_events.arn
  event_endpoint_updated_topic_arn = aws_sns_topic.endpoint_events.arn
  event_delivery_failure_topic_arn = aws_sns_topic.delivery_failures.arn

  tags = {
    Name        = "${var.project_name}-ios-apns"
    Environment = var.environment
    Project     = var.project_name
  }
}

# Android FCM Platform Application
resource "aws_sns_platform_application" "android_fcm" {
  name                = "${var.project_name}-android-fcm-${var.environment}"
  platform            = "GCM"
  platform_credential = var.fcm_server_key

  event_endpoint_created_topic_arn = aws_sns_topic.endpoint_events.arn
  event_endpoint_deleted_topic_arn = aws_sns_topic.endpoint_events.arn
  event_endpoint_updated_topic_arn = aws_sns_topic.endpoint_events.arn
  event_delivery_failure_topic_arn = aws_sns_topic.delivery_failures.arn

  tags = {
    Name        = "${var.project_name}-android-fcm"
    Environment = var.environment
    Project     = var.project_name
  }
}

# SNS Topic for endpoint events (created, deleted, updated)
resource "aws_sns_topic" "endpoint_events" {
  name = "${var.project_name}-endpoint-events-${var.environment}"

  tags = {
    Name        = "${var.project_name}-endpoint-events"
    Environment = var.environment
    Project     = var.project_name
  }
}

# SNS Topic for delivery failures
resource "aws_sns_topic" "delivery_failures" {
  name = "${var.project_name}-delivery-failures-${var.environment}"

  tags = {
    Name        = "${var.project_name}-delivery-failures"
    Environment = var.environment
    Project     = var.project_name
  }
}

# SNS Topic for threshold breach alerts
resource "aws_sns_topic" "threshold_alerts" {
  name = "${var.project_name}-threshold-alerts-${var.environment}"

  tags = {
    Name        = "${var.project_name}-threshold-alerts"
    Environment = var.environment
    Project     = var.project_name
  }
}

# SNS Topic for reminder lapse alerts
resource "aws_sns_topic" "reminder_alerts" {
  name = "${var.project_name}-reminder-alerts-${var.environment}"

  tags = {
    Name        = "${var.project_name}-reminder-alerts"
    Environment = var.environment
    Project     = var.project_name
  }
}

# CloudWatch Log Group for delivery status logging
resource "aws_cloudwatch_log_group" "sns_delivery_logs" {
  name              = "/aws/sns/${var.project_name}-delivery-${var.environment}"
  retention_in_days = 30

  tags = {
    Name        = "${var.project_name}-sns-delivery-logs"
    Environment = var.environment
    Project     = var.project_name
  }
}

# IAM Role for SNS to write delivery logs
resource "aws_iam_role" "sns_delivery_status_role" {
  name = "${var.project_name}-sns-delivery-status-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "sns.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "${var.project_name}-sns-delivery-status-role"
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_iam_role_policy" "sns_delivery_status_policy" {
  name = "${var.project_name}-sns-delivery-status-policy"
  role = aws_iam_role.sns_delivery_status_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:PutMetricFilter",
          "logs:PutRetentionPolicy"
        ]
        Resource = "${aws_cloudwatch_log_group.sns_delivery_logs.arn}:*"
      }
    ]
  })
}

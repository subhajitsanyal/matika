/**
 * CloudFront Distribution for Doctor Web Portal
 *
 * Serves the React SPA from S3 with HTTPS.
 */

# S3 bucket for static website hosting
resource "aws_s3_bucket" "web_portal" {
  bucket = "${var.project_name}-doctor-portal-${var.environment}"

  tags = {
    Name        = "${var.project_name}-doctor-portal"
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_s3_bucket_public_access_block" "web_portal" {
  bucket = aws_s3_bucket.web_portal.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "web_portal" {
  bucket = aws_s3_bucket.web_portal.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web_portal" {
  bucket = aws_s3_bucket.web_portal.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CloudFront Origin Access Identity
resource "aws_cloudfront_origin_access_identity" "web_portal" {
  comment = "OAI for ${var.project_name} doctor portal"
}

# S3 bucket policy for CloudFront access
resource "aws_s3_bucket_policy" "web_portal" {
  bucket = aws_s3_bucket.web_portal.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontAccess"
        Effect    = "Allow"
        Principal = {
          AWS = aws_cloudfront_origin_access_identity.web_portal.iam_arn
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.web_portal.arn}/*"
      }
    ]
  })
}

# ACM Certificate (must be in us-east-1 for CloudFront)
resource "aws_acm_certificate" "web_portal" {
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = "${var.project_name}-doctor-portal-cert"
    Environment = var.environment
  }
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "web_portal" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  comment             = "${var.project_name} Doctor Portal"

  aliases = var.domain_name != "" ? [var.domain_name] : []

  origin {
    domain_name = aws_s3_bucket.web_portal.bucket_regional_domain_name
    origin_id   = "S3-${aws_s3_bucket.web_portal.id}"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.web_portal.cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${aws_s3_bucket.web_portal.id}"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true
  }

  # Cache behavior for static assets
  ordered_cache_behavior {
    path_pattern     = "/assets/*"
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${aws_s3_bucket.web_portal.id}"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400
    max_ttl                = 31536000
    compress               = true
  }

  # SPA routing - return index.html for all paths
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn            = var.domain_name != "" ? aws_acm_certificate.web_portal.arn : null
    cloudfront_default_certificate = var.domain_name == ""
    ssl_support_method             = var.domain_name != "" ? "sni-only" : null
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = {
    Name        = "${var.project_name}-doctor-portal-cdn"
    Environment = var.environment
  }
}

# Output the CloudFront domain
output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.web_portal.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.web_portal.id
}

output "s3_bucket_name" {
  description = "S3 bucket name for web portal"
  value       = aws_s3_bucket.web_portal.id
}

output "s3_bucket_arn" {
  description = "S3 bucket ARN for web portal"
  value       = aws_s3_bucket.web_portal.arn
}

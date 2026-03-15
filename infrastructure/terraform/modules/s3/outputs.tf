# CareLog S3 Module - Outputs

output "documents_bucket_id" {
  description = "ID of the documents S3 bucket"
  value       = aws_s3_bucket.documents.id
}

output "documents_bucket_arn" {
  description = "ARN of the documents S3 bucket"
  value       = aws_s3_bucket.documents.arn
}

output "documents_bucket_name" {
  description = "Name of the documents S3 bucket"
  value       = aws_s3_bucket.documents.bucket
}

output "documents_bucket_domain" {
  description = "Domain name of the documents S3 bucket"
  value       = aws_s3_bucket.documents.bucket_domain_name
}

output "access_logs_bucket_id" {
  description = "ID of the access logs S3 bucket"
  value       = aws_s3_bucket.access_logs.id
}

output "kms_key_arn" {
  description = "ARN of the KMS key for S3 encryption"
  value       = aws_kms_key.s3.arn
}

output "s3_access_role_arn" {
  description = "ARN of the IAM role for S3 access"
  value       = aws_iam_role.s3_access.arn
}

# CareLog SQS Module - Outputs

output "document_processing_queue_id" {
  description = "ID of the document processing SQS queue"
  value       = aws_sqs_queue.document_processing.id
}

output "document_processing_queue_arn" {
  description = "ARN of the document processing SQS queue"
  value       = aws_sqs_queue.document_processing.arn
}

output "document_processing_queue_url" {
  description = "URL of the document processing SQS queue"
  value       = aws_sqs_queue.document_processing.url
}

output "document_processing_dlq_arn" {
  description = "ARN of the document processing dead-letter queue"
  value       = aws_sqs_queue.document_processing_dlq.arn
}

output "alerts_queue_id" {
  description = "ID of the alerts SQS queue"
  value       = aws_sqs_queue.alerts.id
}

output "alerts_queue_arn" {
  description = "ARN of the alerts SQS queue"
  value       = aws_sqs_queue.alerts.arn
}

output "alerts_queue_url" {
  description = "URL of the alerts SQS queue"
  value       = aws_sqs_queue.alerts.url
}

output "kms_key_arn" {
  description = "ARN of the KMS key for SQS encryption"
  value       = aws_kms_key.sqs.arn
}

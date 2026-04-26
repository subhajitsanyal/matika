# CareLog Monitoring Module - Variables

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "alert_email" {
  description = "Email address for operator alert notifications"
  type        = string
}

variable "lambda_function_names" {
  description = "List of Lambda function names to monitor"
  type        = list(string)
}

variable "construct_fhir_batch_function_name" {
  description = "Function name for construct-fhir-batch Lambda (P95 duration alarm)"
  type        = string
}

variable "evaluate_thresholds_batch_function_name" {
  description = "Function name for evaluate-thresholds-batch Lambda (P95 duration alarm)"
  type        = string
}

variable "api_gateway_name" {
  description = "Name of the API Gateway REST API"
  type        = string
}

variable "api_gateway_stage" {
  description = "Stage name of the API Gateway deployment"
  type        = string
}

variable "rds_instance_id" {
  description = "Identifier of the RDS instance"
  type        = string
}

variable "sqs_queue_name" {
  description = "Name of the primary SQS queue"
  type        = string
}

variable "dlq_queue_name" {
  description = "Name of the SQS dead-letter queue"
  type        = string
}

variable "alerts_dlq_queue_name" {
  description = "Name of the alerts SQS dead-letter queue"
  type        = string
  default     = ""
}

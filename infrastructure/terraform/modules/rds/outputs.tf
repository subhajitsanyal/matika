# CareLog RDS Module - Outputs

output "db_instance_id" {
  description = "ID of the RDS instance"
  value       = aws_db_instance.main.id
}

output "db_instance_arn" {
  description = "ARN of the RDS instance"
  value       = aws_db_instance.main.arn
}

output "db_endpoint" {
  description = "Endpoint of the RDS instance"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "db_address" {
  description = "Address of the RDS instance"
  value       = aws_db_instance.main.address
  sensitive   = true
}

output "db_port" {
  description = "Port of the RDS instance"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Name of the database"
  value       = aws_db_instance.main.db_name
}

output "db_username" {
  description = "Master username of the database"
  value       = aws_db_instance.main.username
  sensitive   = true
}

output "db_password_secret_arn" {
  description = "ARN of the Secrets Manager secret containing the database password"
  value       = aws_secretsmanager_secret.db_password.arn
}

output "db_password_secret_name" {
  description = "Name of the Secrets Manager secret containing the database password"
  value       = aws_secretsmanager_secret.db_password.name
}

output "kms_key_arn" {
  description = "ARN of the KMS key for RDS encryption"
  value       = aws_kms_key.rds.arn
}

output "db_subnet_group_name" {
  description = "Name of the DB subnet group"
  value       = aws_db_subnet_group.main.name
}

# CareLog RDS Module - Variables

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for DB subnet group"
  type        = list(string)
}

variable "rds_security_group_id" {
  description = "Security group ID for RDS"
  type        = string
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "carelog"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "carelog_admin"
  sensitive   = true
}

variable "allocated_storage" {
  description = "Initial allocated storage in GB"
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Maximum allocated storage in GB (autoscaling)"
  type        = number
  default     = 100
}

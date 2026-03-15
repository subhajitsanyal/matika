# CareLog RDS Module
#
# Creates a PostgreSQL RDS instance for:
# - User and persona link storage
# - Threshold configurations
# - Reminder configurations
# - Consent records
# - Audit log metadata
#
# HIPAA Compliance:
# - Encryption at rest using KMS
# - Encryption in transit (SSL required)
# - Automated backups enabled
# - Multi-AZ deployment (production)
# - Private subnet placement

# KMS Key for RDS encryption
resource "aws_kms_key" "rds" {
  description             = "KMS key for CareLog RDS encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "carelog-${var.environment}-rds-key"
    Environment = var.environment
  }
}

resource "aws_kms_alias" "rds" {
  name          = "alias/carelog-${var.environment}-rds"
  target_key_id = aws_kms_key.rds.key_id
}

# DB Subnet Group
resource "aws_db_subnet_group" "main" {
  name       = "carelog-${var.environment}-db-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name        = "carelog-${var.environment}-db-subnet-group"
    Environment = var.environment
  }
}

# DB Parameter Group
resource "aws_db_parameter_group" "main" {
  family = "postgres15"
  name   = "carelog-${var.environment}-pg-params"

  # Force SSL connections - HIPAA compliance
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Log all connections for audit
  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  # Log all statements (be careful with performance in production)
  parameter {
    name         = "log_statement"
    value        = var.environment == "prod" ? "ddl" : "all"
    apply_method = "pending-reboot"
  }

  # UTF-8 encoding
  parameter {
    name  = "client_encoding"
    value = "UTF8"
  }

  tags = {
    Name        = "carelog-${var.environment}-pg-params"
    Environment = var.environment
  }
}

# Random password for database
resource "random_password" "db_password" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# Store password in Secrets Manager
resource "aws_secretsmanager_secret" "db_password" {
  name        = "carelog-${var.environment}-db-password"
  description = "CareLog RDS database password"
  kms_key_id  = aws_kms_key.rds.arn

  tags = {
    Name        = "carelog-${var.environment}-db-password"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id = aws_secretsmanager_secret.db_password.id
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db_password.result
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = var.db_name
  })
}

# RDS Instance
resource "aws_db_instance" "main" {
  identifier = "carelog-${var.environment}"

  # Engine configuration
  engine               = "postgres"
  engine_version       = "15"
  instance_class       = var.db_instance_class
  allocated_storage    = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type         = "gp3"
  storage_encrypted    = true
  kms_key_id           = aws_kms_key.rds.arn

  # Database configuration
  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password.result
  port     = 5432

  # Network configuration
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.rds_security_group_id]
  publicly_accessible    = false

  # Parameter and option groups
  parameter_group_name = aws_db_parameter_group.main.name

  # Backup configuration - HIPAA compliance
  backup_retention_period = var.environment == "prod" ? 35 : 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  # Multi-AZ for production
  multi_az = var.environment == "prod"

  # Performance Insights
  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  performance_insights_kms_key_id       = aws_kms_key.rds.arn

  # Enhanced monitoring
  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn

  # Deletion protection (production only)
  deletion_protection = var.environment == "prod"

  # Auto minor version upgrade
  auto_minor_version_upgrade = true

  # Final snapshot
  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "carelog-${var.environment}-final-snapshot" : null

  # Copy tags to snapshots
  copy_tags_to_snapshot = true

  tags = {
    Name        = "carelog-${var.environment}-db"
    Environment = var.environment
    HIPAA       = "true"
  }
}

# IAM Role for Enhanced Monitoring
resource "aws_iam_role" "rds_monitoring" {
  name = "carelog-${var.environment}-rds-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "carelog-${var.environment}-rds-monitoring-role"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# CloudWatch Alarms for RDS
resource "aws_cloudwatch_metric_alarm" "cpu_utilization" {
  alarm_name          = "carelog-${var.environment}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU utilization is high"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }

  tags = {
    Name        = "carelog-${var.environment}-rds-cpu-alarm"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "free_storage_space" {
  alarm_name          = "carelog-${var.environment}-rds-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5368709120 # 5 GB
  alarm_description   = "RDS free storage space is low"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }

  tags = {
    Name        = "carelog-${var.environment}-rds-storage-alarm"
    Environment = var.environment
  }
}

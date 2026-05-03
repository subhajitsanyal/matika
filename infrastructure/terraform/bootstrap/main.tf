# Terraform state backend bootstrap.
#
# Provisions the two AWS resources required to host remote Terraform state
# for every Matika environment:
#   - S3 bucket  carelog-terraform-state    (state files, versioned)
#   - DynamoDB   carelog-terraform-locks    (state locking)
#
# This config has its OWN local state (`bootstrap/terraform.tfstate`) on
# purpose: a config that creates its own backend would be a chicken-and-egg
# loop. The bootstrap state file is small, rarely changes, and is committed
# only as a backup elsewhere — losing it just means re-importing two
# resources, not a state rebuild.
#
# Run order on a fresh laptop:
#   1.  cd infrastructure/terraform/bootstrap && terraform init && terraform apply
#   2.  cd ../environments/dev && terraform init -migrate-state
#
# Naming follows the carelog-* prefix convention (CLAUDE.md note: kept until
# the v2.1 rename pass).

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "ap-south-1"
}

# ---------------------------------------------------------------------------
# S3 bucket — Terraform state
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "terraform_state" {
  bucket = "carelog-terraform-state"

  tags = {
    Name        = "carelog-terraform-state"
    Purpose     = "terraform-remote-state"
    ManagedBy   = "terraform-bootstrap"
  }

  # Belt-and-braces: protect the state bucket from accidental deletion.
  lifecycle {
    prevent_destroy = true
  }
}

# Versioning so a corrupted apply can be rolled back to the prior state
# object — non-negotiable for a state bucket.
resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Server-side encryption with the AWS-managed S3 key. Switching to a
# customer-managed KMS key is a follow-up if/when state files contain
# sensitive material that warrants a separate key boundary.
resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block all public access — the state bucket must never be public.
resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------------------------------------------------------------------------
# DynamoDB — Terraform state locking
# ---------------------------------------------------------------------------
#
# PAY_PER_REQUEST mode: state lock writes are rare (a few per day per env)
# and provisioned capacity would be wasted spend.

resource "aws_dynamodb_table" "terraform_locks" {
  name         = "carelog-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Name      = "carelog-terraform-locks"
    Purpose   = "terraform-state-locking"
    ManagedBy = "terraform-bootstrap"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Outputs — copy these into the dev/prod backend block.
# ---------------------------------------------------------------------------

output "state_bucket_name" {
  value = aws_s3_bucket.terraform_state.id
}

output "lock_table_name" {
  value = aws_dynamodb_table.terraform_locks.id
}

output "backend_block_dev" {
  description = "Drop into the terraform { backend \"s3\" { ... } } block in environments/dev/main.tf"
  value       = <<-EOT
    backend "s3" {
      bucket         = "${aws_s3_bucket.terraform_state.id}"
      key            = "dev/terraform.tfstate"
      region         = "ap-south-1"
      encrypt        = true
      dynamodb_table = "${aws_dynamodb_table.terraform_locks.id}"
    }
  EOT
}

# CareLog Bastion Module
#
# Creates a bastion EC2 instance with SSM Session Manager access
# for port-forwarding to private resources (e.g., RDS).
# No SSH key pair or inbound SSH rules are needed — access is via SSM only.

data "aws_region" "current" {}

# Latest Amazon Linux 2023 ARM64 AMI
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-arm64"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

# IAM Role for SSM Session Manager
resource "aws_iam_role" "bastion" {
  name = "carelog-${var.environment}-bastion-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "carelog-${var.environment}-bastion-role"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "bastion_ssm" {
  role       = aws_iam_role.bastion.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "bastion" {
  name = "carelog-${var.environment}-bastion-profile"
  role = aws_iam_role.bastion.name
}

# Security group for the bastion — outbound only, no inbound SSH needed
resource "aws_security_group" "bastion" {
  name        = "carelog-${var.environment}-bastion-sg"
  description = "Security group for bastion instance (SSM access only)"
  vpc_id      = var.vpc_id

  egress {
    description = "Allow all outbound traffic (SSM, RDS, etc.)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "carelog-${var.environment}-bastion-sg"
    Environment = var.environment
  }
}

# Allow bastion to access RDS on port 5432
resource "aws_security_group_rule" "bastion_to_rds" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.bastion.id
  security_group_id        = var.rds_security_group_id
  description              = "PostgreSQL access from bastion"
}

# Bastion EC2 instance
resource "aws_instance" "bastion" {
  ami                         = data.aws_ami.amazon_linux.id
  instance_type               = var.instance_type
  subnet_id                   = var.public_subnet_id
  iam_instance_profile        = aws_iam_instance_profile.bastion.name
  vpc_security_group_ids      = [aws_security_group.bastion.id]
  associate_public_ip_address = true

  metadata_options {
    http_tokens   = "required" # IMDSv2 only
    http_endpoint = "enabled"
  }

  tags = {
    Name        = "carelog-${var.environment}-bastion"
    Environment = var.environment
  }
}

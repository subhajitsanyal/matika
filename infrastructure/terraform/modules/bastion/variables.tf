# CareLog Bastion Module - Variables

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC"
  type        = string
}

variable "public_subnet_id" {
  description = "ID of a public subnet for the bastion instance"
  type        = string
}

variable "rds_security_group_id" {
  description = "ID of the RDS security group to allow bastion access"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for the bastion"
  type        = string
  default     = "t4g.micro"
}

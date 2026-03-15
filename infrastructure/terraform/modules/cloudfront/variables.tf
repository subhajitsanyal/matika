variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "carelog"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
}

variable "domain_name" {
  description = "Custom domain name for the web portal (optional)"
  type        = string
  default     = ""
}

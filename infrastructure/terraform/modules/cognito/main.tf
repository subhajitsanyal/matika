# CareLog Cognito Module
#
# Creates a Cognito user pool with four user groups:
# - patients: Primary health data loggers
# - attendants: Log vitals on behalf of patients
# - relatives: Account creators and caregivers
# - doctors: Clinical review via web portal
#
# HIPAA Compliance:
# - Strong password policy enforced
# - MFA available (optional in v1)
# - Secure token handling

# Cognito User Pool
resource "aws_cognito_user_pool" "main" {
  name = "carelog-${var.environment}-users"

  # Username configuration
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Password Policy - HIPAA compliant
  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  # MFA Configuration (optional in v1, but infrastructure ready)
  mfa_configuration = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  # Account Recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
    recovery_mechanism {
      name     = "verified_phone_number"
      priority = 2
    }
  }

  # Email Configuration — use SES if configured, otherwise Cognito default (50/day limit)
  email_configuration {
    email_sending_account  = var.ses_email_arn != "" ? "DEVELOPER" : "COGNITO_DEFAULT"
    source_arn             = var.ses_email_arn != "" ? var.ses_email_arn : null
    from_email_address     = var.ses_from_email != "" ? var.ses_from_email : null
    reply_to_email_address = var.ses_from_email != "" ? var.ses_from_email : null
  }

  # User Pool Add-ons
  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }

  # Schema - Standard attributes
  schema {
    name                     = "email"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    name                     = "name"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    name                     = "phone_number"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = false

    string_attribute_constraints {
      min_length = 1
      max_length = 20
    }
  }

  # Custom attributes for persona linking
  schema {
    name                     = "persona_type"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = false

    string_attribute_constraints {
      min_length = 1
      max_length = 20
    }
  }

  schema {
    name                     = "linked_patient_id"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = false

    string_attribute_constraints {
      min_length = 0
      max_length = 64
    }
  }

  schema {
    name                     = "onboarded_by"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = false

    string_attribute_constraints {
      min_length = 0
      max_length = 64
    }
  }

  # Verification message
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "CareLog - Verify your email"
    email_message        = "Your CareLog verification code is {####}"
  }

  # Admin create user config
  admin_create_user_config {
    allow_admin_create_user_only = false

    invite_message_template {
      email_subject = "Welcome to CareLog"
      email_message = "Your username is {username}. You have been invited to CareLog. Your temporary password is {####}. Please login at https://app.carelog.com"
      sms_message   = "Your CareLog username is {username}. Your temporary password is {####}"
    }
  }

  # Device tracking (for security)
  device_configuration {
    challenge_required_on_new_device      = true
    device_only_remembered_on_user_prompt = true
  }

  tags = {
    Name        = "carelog-${var.environment}-user-pool"
    Environment = var.environment
  }
}

# User Pool Domain
resource "aws_cognito_user_pool_domain" "main" {
  domain       = "carelog-${var.environment}"
  user_pool_id = aws_cognito_user_pool.main.id
}

# User Groups
resource "aws_cognito_user_group" "patients" {
  name         = "patients"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Primary health data loggers - the focus of all monitoring"
  precedence   = 1
}

resource "aws_cognito_user_group" "attendants" {
  name         = "attendants"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Log vitals and observations on patient's behalf"
  precedence   = 2
}

resource "aws_cognito_user_group" "relatives" {
  name         = "relatives"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Account creators, configure alerts, thresholds, and schedules"
  precedence   = 3
}

resource "aws_cognito_user_group" "doctors" {
  name         = "doctors"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Clinical review, care plan management, threshold overrides"
  precedence   = 4
}

# App Client for Mobile Apps
resource "aws_cognito_user_pool_client" "mobile" {
  name         = "carelog-mobile-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # Token validity
  access_token_validity  = 1  # 1 hour as per PRD
  id_token_validity      = 1  # 1 hour
  refresh_token_validity = 30 # 30 days as per PRD

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # OAuth configuration
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]

  callback_urls = var.mobile_callback_urls
  logout_urls   = var.mobile_logout_urls

  supported_identity_providers = ["COGNITO"]

  # Auth flows
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH"
  ]

  # Security
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  # Read/write attributes
  read_attributes = [
    "email",
    "name",
    "phone_number",
    "custom:persona_type",
    "custom:linked_patient_id",
    "custom:onboarded_by"
  ]

  write_attributes = [
    "email",
    "name",
    "phone_number",
    "custom:persona_type",
    "custom:linked_patient_id",
    "custom:onboarded_by"
  ]
}

# App Client for Web Portal (Doctors)
resource "aws_cognito_user_pool_client" "web" {
  name         = "carelog-web-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # Token validity
  access_token_validity  = 1  # 1 hour
  id_token_validity      = 1  # 1 hour
  refresh_token_validity = 7  # 7 days for web

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # OAuth configuration
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]

  callback_urls = var.web_callback_urls
  logout_urls   = var.web_logout_urls

  supported_identity_providers = ["COGNITO"]

  # Auth flows
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]

  # Security
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  generate_secret               = true

  # Read/write attributes
  read_attributes = [
    "email",
    "name",
    "phone_number",
    "custom:persona_type",
    "custom:linked_patient_id"
  ]

  write_attributes = [
    "email",
    "name",
    "phone_number"
  ]
}

# Resource Server for API scopes
resource "aws_cognito_resource_server" "api" {
  identifier   = "carelog-api"
  name         = "CareLog API"
  user_pool_id = aws_cognito_user_pool.main.id

  scope {
    scope_name        = "read:observations"
    scope_description = "Read patient observations"
  }

  scope {
    scope_name        = "write:observations"
    scope_description = "Write patient observations"
  }

  scope {
    scope_name        = "read:documents"
    scope_description = "Read patient documents"
  }

  scope {
    scope_name        = "write:documents"
    scope_description = "Upload patient documents"
  }

  scope {
    scope_name        = "manage:thresholds"
    scope_description = "Manage vital thresholds"
  }

  scope {
    scope_name        = "manage:careplan"
    scope_description = "Manage patient care plans"
  }
}

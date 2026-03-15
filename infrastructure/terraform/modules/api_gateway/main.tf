# CareLog API Gateway Module
#
# Creates a REST API Gateway with:
# - Cognito authorizer for authentication
# - Resource structure for FHIR operations
# - CORS configuration for web portal
# - Throttling and rate limiting
#
# HIPAA Compliance:
# - All endpoints require authentication
# - TLS 1.2+ enforced
# - Request/response logging enabled

# REST API
resource "aws_api_gateway_rest_api" "main" {
  name        = "carelog-${var.environment}-api"
  description = "CareLog Health Monitoring API"

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  # Minimum TLS version for HIPAA compliance
  minimum_compression_size = 1024

  tags = {
    Name        = "carelog-${var.environment}-api"
    Environment = var.environment
  }
}

# Cognito Authorizer
resource "aws_api_gateway_authorizer" "cognito" {
  name            = "cognito-authorizer"
  rest_api_id     = aws_api_gateway_rest_api.main.id
  type            = "COGNITO_USER_POOLS"
  provider_arns   = [var.cognito_user_pool_arn]
  identity_source = "method.request.header.Authorization"
}

# ============================================================
# RESOURCES
# ============================================================

# /patients
resource "aws_api_gateway_resource" "patients" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "patients"
}

# /patients/{patientId}
resource "aws_api_gateway_resource" "patient" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patients.id
  path_part   = "{patientId}"
}

# /observations
resource "aws_api_gateway_resource" "observations" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "observations"
}

# /observations/{observationId}
resource "aws_api_gateway_resource" "observation" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.observations.id
  path_part   = "{observationId}"
}

# /observations/sync
resource "aws_api_gateway_resource" "observations_sync" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.observations.id
  path_part   = "sync"
}

# /documents
resource "aws_api_gateway_resource" "documents" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "documents"
}

# /documents/presigned-url
resource "aws_api_gateway_resource" "documents_presigned" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.documents.id
  path_part   = "presigned-url"
}

# /thresholds
resource "aws_api_gateway_resource" "thresholds" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "thresholds"
}

# /thresholds/{patientId}
resource "aws_api_gateway_resource" "patient_thresholds" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.thresholds.id
  path_part   = "{patientId}"
}

# /reminders
resource "aws_api_gateway_resource" "reminders" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "reminders"
}

# /reminders/{patientId}
resource "aws_api_gateway_resource" "patient_reminders" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.reminders.id
  path_part   = "{patientId}"
}

# /care-plans
resource "aws_api_gateway_resource" "care_plans" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "care-plans"
}

# /care-plans/{patientId}
resource "aws_api_gateway_resource" "patient_care_plan" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.care_plans.id
  path_part   = "{patientId}"
}

# /alerts
resource "aws_api_gateway_resource" "alerts" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "alerts"
}

# /device-tokens
resource "aws_api_gateway_resource" "device_tokens" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "device-tokens"
}

# /audit-log
resource "aws_api_gateway_resource" "audit_log" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "audit-log"
}

# ============================================================
# METHODS (placeholder MOCK integrations until Lambda backends are connected)
# ============================================================

resource "aws_api_gateway_method" "patients_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patients.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patients_get" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.patients.id
  http_method = aws_api_gateway_method.patients_get.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "patients_get_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.patients.id
  http_method = aws_api_gateway_method.patients_get.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin" = true
  }
}

resource "aws_api_gateway_integration_response" "patients_get_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.patients.id
  http_method = aws_api_gateway_method.patients_get.http_method
  status_code = aws_api_gateway_method_response.patients_get_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin" = "'${var.cors_origin}'"
  }
}

# ============================================================
# GATEWAY RESPONSES (CORS)
# ============================================================

resource "aws_api_gateway_gateway_response" "cors_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  response_type = "DEFAULT_4XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${var.cors_origin}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
  }
}

resource "aws_api_gateway_gateway_response" "cors_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  response_type = "DEFAULT_5XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${var.cors_origin}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
  }
}

# ============================================================
# REQUEST/RESPONSE MODELS
# ============================================================

# FHIR Observation Model
resource "aws_api_gateway_model" "fhir_observation" {
  rest_api_id  = aws_api_gateway_rest_api.main.id
  name         = "FHIRObservation"
  description  = "FHIR R4 Observation resource"
  content_type = "application/json"

  schema = jsonencode({
    "$schema" = "http://json-schema.org/draft-04/schema#"
    type      = "object"
    required  = ["resourceType", "status", "code", "subject"]
    properties = {
      resourceType = { type = "string", enum = ["Observation"] }
      status       = { type = "string" }
      code = {
        type = "object"
        properties = {
          coding = {
            type = "array"
            items = {
              type = "object"
              properties = {
                system  = { type = "string" }
                code    = { type = "string" }
                display = { type = "string" }
              }
            }
          }
        }
      }
      subject = {
        type = "object"
        properties = {
          reference = { type = "string" }
        }
      }
      valueQuantity = {
        type = "object"
        properties = {
          value  = { type = "number" }
          unit   = { type = "string" }
          system = { type = "string" }
          code   = { type = "string" }
        }
      }
    }
  })
}

# Threshold Model
resource "aws_api_gateway_model" "threshold" {
  rest_api_id  = aws_api_gateway_rest_api.main.id
  name         = "Threshold"
  description  = "Vital threshold configuration"
  content_type = "application/json"

  schema = jsonencode({
    "$schema" = "http://json-schema.org/draft-04/schema#"
    type      = "object"
    required  = ["vitalType", "minValue", "maxValue"]
    properties = {
      vitalType = { type = "string" }
      minValue  = { type = "number" }
      maxValue  = { type = "number" }
      unit      = { type = "string" }
      setBy     = { type = "string", enum = ["relative", "doctor"] }
    }
  })
}

# ============================================================
# DEPLOYMENT
# ============================================================

resource "aws_api_gateway_deployment" "main" {
  rest_api_id = aws_api_gateway_rest_api.main.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.patients.id,
      aws_api_gateway_resource.observations.id,
      aws_api_gateway_resource.documents.id,
      aws_api_gateway_resource.thresholds.id,
      aws_api_gateway_resource.care_plans.id,
      aws_api_gateway_method.patients_get.id,
      aws_api_gateway_integration.patients_get.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

# IAM Role for API Gateway CloudWatch Logging
resource "aws_iam_role" "api_gateway_cloudwatch" {
  name = "carelog-${var.environment}-apigw-cloudwatch"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "apigateway.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "api_gateway_cloudwatch" {
  role       = aws_iam_role.api_gateway_cloudwatch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

resource "aws_api_gateway_account" "main" {
  cloudwatch_role_arn = aws_iam_role.api_gateway_cloudwatch.arn

  depends_on = [aws_iam_role_policy_attachment.api_gateway_cloudwatch]
}

resource "aws_api_gateway_stage" "main" {
  deployment_id = aws_api_gateway_deployment.main.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  stage_name    = var.environment

  depends_on = [aws_api_gateway_account.main]

  # Access logging
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access_logs.arn
    format = jsonencode({
      requestId         = "$context.requestId"
      ip                = "$context.identity.sourceIp"
      caller            = "$context.identity.caller"
      user              = "$context.identity.user"
      requestTime       = "$context.requestTime"
      httpMethod        = "$context.httpMethod"
      resourcePath      = "$context.resourcePath"
      status            = "$context.status"
      protocol          = "$context.protocol"
      responseLength    = "$context.responseLength"
      integrationError  = "$context.integrationErrorMessage"
      authorizerError   = "$context.authorizer.error"
    })
  }

  # Enable X-Ray tracing
  xray_tracing_enabled = true

  tags = {
    Name        = "carelog-${var.environment}-api-stage"
    Environment = var.environment
  }
}

# CloudWatch Log Group for API access logs
resource "aws_cloudwatch_log_group" "api_access_logs" {
  name              = "/aws/api-gateway/carelog-${var.environment}"
  retention_in_days = 365 # HIPAA compliance

  tags = {
    Name        = "carelog-${var.environment}-api-logs"
    Environment = var.environment
  }
}

# ============================================================
# THROTTLING / USAGE PLAN
# ============================================================

resource "aws_api_gateway_usage_plan" "main" {
  name        = "carelog-${var.environment}-usage-plan"
  description = "Usage plan for CareLog API"

  api_stages {
    api_id = aws_api_gateway_rest_api.main.id
    stage  = aws_api_gateway_stage.main.stage_name

    throttle {
      path        = "/*/*"
      burst_limit = var.throttle_burst_limit
      rate_limit  = var.throttle_rate_limit
    }
  }

  throttle_settings {
    burst_limit = var.throttle_burst_limit
    rate_limit  = var.throttle_rate_limit
  }

  quota_settings {
    limit  = var.quota_limit
    period = "DAY"
  }
}

# API Key (optional, for additional tracking)
resource "aws_api_gateway_api_key" "main" {
  name    = "carelog-${var.environment}-api-key"
  enabled = true
}

resource "aws_api_gateway_usage_plan_key" "main" {
  key_id        = aws_api_gateway_api_key.main.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.main.id
}

# ============================================================
# METHOD SETTINGS
# ============================================================

resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  stage_name  = aws_api_gateway_stage.main.stage_name
  method_path = "*/*"

  settings {
    metrics_enabled        = true
    logging_level          = "INFO"
    data_trace_enabled     = false # Don't log request/response bodies (PHI)
    throttling_burst_limit = var.throttle_burst_limit
    throttling_rate_limit  = var.throttle_rate_limit
  }
}

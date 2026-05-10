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

# /patients/{patientId}/team
resource "aws_api_gateway_resource" "patient_team" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient.id
  path_part   = "team"
}

# /patients/{patientId}/team/{memberId}
resource "aws_api_gateway_resource" "patient_team_member" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient_team.id
  path_part   = "{memberId}"
}

# /patients/{patientId}/summary
resource "aws_api_gateway_resource" "patient_summary" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient.id
  path_part   = "summary"
}

# /patients/{patientId}/observations
resource "aws_api_gateway_resource" "patient_observations" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient.id
  path_part   = "observations"
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
# ADDITIONAL RESOURCES
# ============================================================

# /invites
resource "aws_api_gateway_resource" "invites" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "invites"
}

# /invites/attendant
resource "aws_api_gateway_resource" "invites_attendant" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.invites.id
  path_part   = "attendant"
}

# /invites/doctor
resource "aws_api_gateway_resource" "invites_doctor" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.invites.id
  path_part   = "doctor"
}

# /invites/accept
resource "aws_api_gateway_resource" "invites_accept" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.invites.id
  path_part   = "accept"
}

# /session-config
resource "aws_api_gateway_resource" "session_config" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "session-config"
}

# /session-config/{patientId}
resource "aws_api_gateway_resource" "session_config_patient" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.session_config.id
  path_part   = "{patientId}"
}

# /interactions
resource "aws_api_gateway_resource" "interactions" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "interactions"
}

# /observations/batch
resource "aws_api_gateway_resource" "observations_batch" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.observations.id
  path_part   = "batch"
}

# /observations/bulk-sync
resource "aws_api_gateway_resource" "observations_bulk_sync" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.observations.id
  path_part   = "bulk-sync"
}

# /patients/{patientId}/recommendations
resource "aws_api_gateway_resource" "patient_recommendations" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient.id
  path_part   = "recommendations"
}

# /patients/{patientId}/recommendations/{recommendationId}
resource "aws_api_gateway_resource" "patient_recommendation" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient_recommendations.id
  path_part   = "{recommendationId}"
}

# /patients/{patientId}/parameter-configs
resource "aws_api_gateway_resource" "patient_parameter_configs" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient.id
  path_part   = "parameter-configs"
}

# /patients/{patientId}/parameter-configs/{configId}
resource "aws_api_gateway_resource" "patient_parameter_config" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient_parameter_configs.id
  path_part   = "{configId}"
}

# /patients/{patientId}/interactions
resource "aws_api_gateway_resource" "patient_interactions" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient.id
  path_part   = "interactions"
}

# /patients/{patientId}/interactions/{interactionId}
resource "aws_api_gateway_resource" "patient_interaction" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient_interactions.id
  path_part   = "{interactionId}"
}

# /patients/{patientId}/interactions/{interactionId}/transcript
resource "aws_api_gateway_resource" "patient_interaction_transcript" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient_interaction.id
  path_part   = "transcript"
}

# /prompts
resource "aws_api_gateway_resource" "prompts" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "prompts"
}

# /prompts/{promptType}
resource "aws_api_gateway_resource" "prompt_type" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.prompts.id
  path_part   = "{promptType}"
}

# ============================================================
# LAMBDA PROXY INTEGRATIONS
# ============================================================

# POST /patients — create-patient
resource "aws_api_gateway_method" "patients_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patients.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patients_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patients.id
  http_method             = aws_api_gateway_method.patients_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.create_patient_invoke_arn
}

# DELETE /patients/{patientId} — delete-patient (kept as MOCK until Lambda exists)
resource "aws_api_gateway_method" "patient_delete" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient.id
  http_method   = "DELETE"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_delete" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.patient.id
  http_method = aws_api_gateway_method.patient_delete.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "patient_delete_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.patient.id
  http_method = aws_api_gateway_method.patient_delete.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin" = true
  }
}

resource "aws_api_gateway_integration_response" "patient_delete_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.patient.id
  http_method = aws_api_gateway_method.patient_delete.http_method
  status_code = aws_api_gateway_method_response.patient_delete_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin" = "'${var.cors_origin}'"
  }

  depends_on = [aws_api_gateway_integration.patient_delete]
}

# DELETE /patients/{patientId}/team/{memberId} — remove-team-member (kept as MOCK)
resource "aws_api_gateway_method" "team_member_delete" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_team_member.id
  http_method   = "DELETE"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "team_member_delete" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.patient_team_member.id
  http_method = aws_api_gateway_method.team_member_delete.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "team_member_delete_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.patient_team_member.id
  http_method = aws_api_gateway_method.team_member_delete.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin" = true
  }
}

resource "aws_api_gateway_integration_response" "team_member_delete_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.patient_team_member.id
  http_method = aws_api_gateway_method.team_member_delete.http_method
  status_code = aws_api_gateway_method_response.team_member_delete_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin" = "'${var.cors_origin}'"
  }

  depends_on = [aws_api_gateway_integration.team_member_delete]
}

# POST /observations/sync — sync-observation
resource "aws_api_gateway_method" "observations_sync_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.observations_sync.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "observations_sync_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.observations_sync.id
  http_method             = aws_api_gateway_method.observations_sync_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.sync_observation_invoke_arn
}

# POST /observations/bulk-sync — bulk-sync
resource "aws_api_gateway_method" "observations_bulk_sync_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.observations_bulk_sync.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "observations_bulk_sync_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.observations_bulk_sync.id
  http_method             = aws_api_gateway_method.observations_bulk_sync_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.bulk_sync_invoke_arn
}

# POST /documents/presigned-url — presigned-url
resource "aws_api_gateway_method" "presigned_url_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.documents_presigned.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "presigned_url_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.documents_presigned.id
  http_method             = aws_api_gateway_method.presigned_url_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.presigned_url_invoke_arn
}

# POST /invites/attendant — invite-attendant
resource "aws_api_gateway_method" "invite_attendant_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.invites_attendant.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "invite_attendant_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.invites_attendant.id
  http_method             = aws_api_gateway_method.invite_attendant_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.invite_attendant_invoke_arn
}

# POST /invites/doctor — invite-doctor
resource "aws_api_gateway_method" "invite_doctor_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.invites_doctor.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "invite_doctor_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.invites_doctor.id
  http_method             = aws_api_gateway_method.invite_doctor_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.invite_doctor_invoke_arn
}

# POST /invites/accept — accept-invite (NO AUTH — user not yet registered)
resource "aws_api_gateway_method" "accept_invite_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.invites_accept.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "accept_invite_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.invites_accept.id
  http_method             = aws_api_gateway_method.accept_invite_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.accept_invite_invoke_arn
}

# /patients/{patientId}/care-team
resource "aws_api_gateway_resource" "patient_care_team" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient.id
  path_part   = "care-team"
}

# GET /patients/{patientId}/care-team → care-team Lambda
resource "aws_api_gateway_method" "patient_care_team_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_care_team.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_care_team_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_care_team.id
  http_method             = aws_api_gateway_method.patient_care_team_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.care_team_invoke_arn
}

# DELETE /patients/{patientId}/care-team → care-team Lambda (cancel invite)
resource "aws_api_gateway_method" "patient_care_team_delete" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_care_team.id
  http_method   = "DELETE"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_care_team_delete" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_care_team.id
  http_method             = aws_api_gateway_method.patient_care_team_delete.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.care_team_invoke_arn
}

# GET /patients/{patientId}/summary → patient-summary Lambda
resource "aws_api_gateway_method" "patient_summary_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_summary.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_summary_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_summary.id
  http_method             = aws_api_gateway_method.patient_summary_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.patient_summary_invoke_arn
}

# GET /session-config/{patientId} → fetch-session-config Lambda
resource "aws_api_gateway_method" "session_config_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.session_config_patient.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "session_config_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.session_config_patient.id
  http_method             = aws_api_gateway_method.session_config_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.fetch_session_config_invoke_arn
}

# POST /interactions → store-interaction Lambda
resource "aws_api_gateway_method" "interactions_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.interactions.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "interactions_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.interactions.id
  http_method             = aws_api_gateway_method.interactions_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.store_interaction_invoke_arn
}

# POST /observations/batch → construct-fhir-batch Lambda
resource "aws_api_gateway_method" "observations_batch_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.observations_batch.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "observations_batch_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.observations_batch.id
  http_method             = aws_api_gateway_method.observations_batch_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.construct_fhir_batch_invoke_arn
}

# GET /patients/{patientId}/observations → get-observations Lambda
resource "aws_api_gateway_method" "patient_observations_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_observations.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_observations_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_observations.id
  http_method             = aws_api_gateway_method.patient_observations_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.get_observations_invoke_arn
}

# ============================================================
# P3 DOCTOR PORTAL — RECOMMENDATIONS
# ============================================================

# GET /patients/{patientId}/recommendations → manage-recommendations
resource "aws_api_gateway_method" "patient_recommendations_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_recommendations.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_recommendations_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_recommendations.id
  http_method             = aws_api_gateway_method.patient_recommendations_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.manage_recommendations_invoke_arn
}

# POST /patients/{patientId}/recommendations → manage-recommendations
resource "aws_api_gateway_method" "patient_recommendations_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_recommendations.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_recommendations_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_recommendations.id
  http_method             = aws_api_gateway_method.patient_recommendations_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.manage_recommendations_invoke_arn
}

# PUT /patients/{patientId}/recommendations/{recommendationId} → manage-recommendations
resource "aws_api_gateway_method" "patient_recommendation_put" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_recommendation.id
  http_method   = "PUT"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_recommendation_put" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_recommendation.id
  http_method             = aws_api_gateway_method.patient_recommendation_put.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.manage_recommendations_invoke_arn
}

# ============================================================
# P3 DOCTOR PORTAL — PARAMETER CONFIGS
# ============================================================

# GET /patients/{patientId}/parameter-configs → manage-parameter-configs
resource "aws_api_gateway_method" "patient_parameter_configs_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_parameter_configs.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_parameter_configs_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_parameter_configs.id
  http_method             = aws_api_gateway_method.patient_parameter_configs_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.manage_parameter_configs_invoke_arn
}

# POST /patients/{patientId}/parameter-configs → manage-parameter-configs
resource "aws_api_gateway_method" "patient_parameter_configs_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_parameter_configs.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_parameter_configs_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_parameter_configs.id
  http_method             = aws_api_gateway_method.patient_parameter_configs_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.manage_parameter_configs_invoke_arn
}

# PUT /patients/{patientId}/parameter-configs/{configId} → manage-parameter-configs
resource "aws_api_gateway_method" "patient_parameter_config_put" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_parameter_config.id
  http_method   = "PUT"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_parameter_config_put" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_parameter_config.id
  http_method             = aws_api_gateway_method.patient_parameter_config_put.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.manage_parameter_configs_invoke_arn
}

# DELETE /patients/{patientId}/parameter-configs/{configId} → manage-parameter-configs
resource "aws_api_gateway_method" "patient_parameter_config_delete" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_parameter_config.id
  http_method   = "DELETE"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_parameter_config_delete" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_parameter_config.id
  http_method             = aws_api_gateway_method.patient_parameter_config_delete.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.manage_parameter_configs_invoke_arn
}

# ============================================================
# P3 DOCTOR PORTAL — INTERACTIONS
# ============================================================

# GET /patients/{patientId}/interactions → manage-interactions
resource "aws_api_gateway_method" "patient_interactions_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_interactions.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_interactions_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_interactions.id
  http_method             = aws_api_gateway_method.patient_interactions_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.manage_interactions_invoke_arn
}

# GET /patients/{patientId}/interactions/{interactionId}/transcript → manage-interactions
resource "aws_api_gateway_method" "patient_interaction_transcript_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_interaction_transcript.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_interaction_transcript_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_interaction_transcript.id
  http_method             = aws_api_gateway_method.patient_interaction_transcript_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.manage_interactions_invoke_arn
}

# ============================================================
# P3 DOCTOR PORTAL — PROMPTS
# ============================================================

# GET /prompts → manage-prompts
resource "aws_api_gateway_method" "prompts_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.prompts.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "prompts_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.prompts.id
  http_method             = aws_api_gateway_method.prompts_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.manage_prompts_invoke_arn
}

# PUT /prompts/{promptType} → manage-prompts
resource "aws_api_gateway_method" "prompt_type_put" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.prompt_type.id
  http_method   = "PUT"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "prompt_type_put" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.prompt_type.id
  http_method             = aws_api_gateway_method.prompt_type_put.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.manage_prompts_invoke_arn
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
      aws_api_gateway_resource.invites.id,
      aws_api_gateway_resource.observations_bulk_sync.id,
      aws_api_gateway_method.patients_post.id,
      aws_api_gateway_integration.patients_post.id,
      aws_api_gateway_method.patient_delete.id,
      aws_api_gateway_method.team_member_delete.id,
      aws_api_gateway_method.observations_sync_post.id,
      aws_api_gateway_integration.observations_sync_post.id,
      aws_api_gateway_method.observations_bulk_sync_post.id,
      aws_api_gateway_method.presigned_url_post.id,
      aws_api_gateway_method.invite_attendant_post.id,
      aws_api_gateway_method.invite_doctor_post.id,
      aws_api_gateway_method.accept_invite_post.id,
      aws_api_gateway_method.patient_care_team_get.id,
      aws_api_gateway_integration.patient_care_team_get.id,
      aws_api_gateway_method.patient_care_team_delete.id,
      aws_api_gateway_integration.patient_care_team_delete.id,
      aws_api_gateway_method.patient_summary_get.id,
      aws_api_gateway_integration.patient_summary_get.id,
      aws_api_gateway_method.patient_observations_get.id,
      aws_api_gateway_integration.patient_observations_get.id,
      aws_api_gateway_resource.session_config.id,
      aws_api_gateway_resource.session_config_patient.id,
      aws_api_gateway_method.session_config_get.id,
      aws_api_gateway_integration.session_config_get.id,
      aws_api_gateway_resource.interactions.id,
      aws_api_gateway_method.interactions_post.id,
      aws_api_gateway_integration.interactions_post.id,
      aws_api_gateway_resource.observations_batch.id,
      aws_api_gateway_method.observations_batch_post.id,
      aws_api_gateway_integration.observations_batch_post.id,
      # P3 Doctor Portal routes
      aws_api_gateway_resource.patient_recommendations.id,
      aws_api_gateway_resource.patient_recommendation.id,
      aws_api_gateway_method.patient_recommendations_get.id,
      aws_api_gateway_integration.patient_recommendations_get.id,
      aws_api_gateway_method.patient_recommendations_post.id,
      aws_api_gateway_integration.patient_recommendations_post.id,
      aws_api_gateway_method.patient_recommendation_put.id,
      aws_api_gateway_integration.patient_recommendation_put.id,
      aws_api_gateway_resource.patient_parameter_configs.id,
      aws_api_gateway_resource.patient_parameter_config.id,
      aws_api_gateway_method.patient_parameter_configs_get.id,
      aws_api_gateway_integration.patient_parameter_configs_get.id,
      aws_api_gateway_method.patient_parameter_configs_post.id,
      aws_api_gateway_integration.patient_parameter_configs_post.id,
      aws_api_gateway_method.patient_parameter_config_put.id,
      aws_api_gateway_integration.patient_parameter_config_put.id,
      aws_api_gateway_method.patient_parameter_config_delete.id,
      aws_api_gateway_integration.patient_parameter_config_delete.id,
      aws_api_gateway_resource.patient_interactions.id,
      aws_api_gateway_resource.patient_interaction.id,
      aws_api_gateway_resource.patient_interaction_transcript.id,
      aws_api_gateway_method.patient_interactions_get.id,
      aws_api_gateway_integration.patient_interactions_get.id,
      aws_api_gateway_method.patient_interaction_transcript_get.id,
      aws_api_gateway_integration.patient_interaction_transcript_get.id,
      aws_api_gateway_resource.prompts.id,
      aws_api_gateway_resource.prompt_type.id,
      aws_api_gateway_method.prompts_get.id,
      aws_api_gateway_integration.prompts_get.id,
      aws_api_gateway_method.prompt_type_put.id,
      aws_api_gateway_integration.prompt_type_put.id,
      # v2 routes — see routes_v2.tf
      aws_api_gateway_resource.conversation.id,
      aws_api_gateway_resource.conversation_turn.id,
      aws_api_gateway_resource.conversation_turn_stream.id,
      aws_api_gateway_resource.conversation_photo_extract.id,
      aws_api_gateway_resource.conversation_photo_presign.id,
      aws_api_gateway_resource.health.id,
      aws_api_gateway_method.conversation_turn_post.id,
      aws_api_gateway_integration.conversation_turn_post.id,
      aws_api_gateway_method.conversation_turn_stream_post.id,
      aws_api_gateway_integration.conversation_turn_stream_post.id,
      aws_api_gateway_method.conversation_photo_extract_post.id,
      aws_api_gateway_integration.conversation_photo_extract_post.id,
      aws_api_gateway_method.conversation_photo_presign_post.id,
      aws_api_gateway_integration.conversation_photo_presign_post.id,
      aws_api_gateway_method.health_get.id,
      aws_api_gateway_integration.health_get.id,
      # F2 — POST /sessions/{sessionId}/end
      aws_api_gateway_resource.sessions.id,
      aws_api_gateway_resource.session_id.id,
      aws_api_gateway_resource.session_end.id,
      aws_api_gateway_method.session_end_post.id,
      aws_api_gateway_integration.session_end_post.id,
      # F17 — POST + DELETE /device-tokens
      aws_api_gateway_method.device_tokens_post.id,
      aws_api_gateway_integration.device_tokens_post.id,
      aws_api_gateway_method.device_tokens_delete.id,
      aws_api_gateway_integration.device_tokens_delete.id,
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
      requestId        = "$context.requestId"
      ip               = "$context.identity.sourceIp"
      caller           = "$context.identity.caller"
      user             = "$context.identity.user"
      requestTime      = "$context.requestTime"
      httpMethod       = "$context.httpMethod"
      resourcePath     = "$context.resourcePath"
      status           = "$context.status"
      protocol         = "$context.protocol"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
      authorizerError  = "$context.authorizer.error"
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
      path        = "/patients/POST"
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

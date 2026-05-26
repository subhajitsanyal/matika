# Care Notes routes — PRD §6.9 / Spec §4.6
#
# Three endpoints, all Cognito-authorized:
#   GET  /patients/{patientId}/care-notes
#   POST /patients/{patientId}/care-notes/{noteId}/acknowledge
#   GET  /caregivers/{caregiverUserId}/care-notes/unread-count
#
# The deployment trigger hash in main.tf references the resource/method/
# integration ids defined below — keep that block in sync when adding new
# routes here.

# ------------------------------------------------------------
# /patients/{patientId}/care-notes
# ------------------------------------------------------------
resource "aws_api_gateway_resource" "patient_care_notes" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient.id
  path_part   = "care-notes"
}

# /patients/{patientId}/care-notes/{noteId}
resource "aws_api_gateway_resource" "patient_care_note" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient_care_notes.id
  path_part   = "{noteId}"
}

# /patients/{patientId}/care-notes/{noteId}/acknowledge
resource "aws_api_gateway_resource" "patient_care_note_acknowledge" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.patient_care_note.id
  path_part   = "acknowledge"
}

# GET /patients/{patientId}/care-notes → list
resource "aws_api_gateway_method" "patient_care_notes_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_care_notes.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_care_notes_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_care_notes.id
  http_method             = aws_api_gateway_method.patient_care_notes_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.care_notes_invoke_arn
}

# POST /patients/{patientId}/care-notes/{noteId}/acknowledge → ack
resource "aws_api_gateway_method" "patient_care_note_acknowledge_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.patient_care_note_acknowledge.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "patient_care_note_acknowledge_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.patient_care_note_acknowledge.id
  http_method             = aws_api_gateway_method.patient_care_note_acknowledge_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.care_notes_invoke_arn
}

# ------------------------------------------------------------
# /caregivers/{caregiverUserId}/care-notes/unread-count
# ------------------------------------------------------------
resource "aws_api_gateway_resource" "caregivers" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "caregivers"
}

resource "aws_api_gateway_resource" "caregiver" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.caregivers.id
  path_part   = "{caregiverUserId}"
}

resource "aws_api_gateway_resource" "caregiver_care_notes" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.caregiver.id
  path_part   = "care-notes"
}

resource "aws_api_gateway_resource" "caregiver_care_notes_unread_count" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.caregiver_care_notes.id
  path_part   = "unread-count"
}

resource "aws_api_gateway_method" "caregiver_care_notes_unread_count_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.caregiver_care_notes_unread_count.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "caregiver_care_notes_unread_count_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.caregiver_care_notes_unread_count.id
  http_method             = aws_api_gateway_method.caregiver_care_notes_unread_count_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.care_notes_invoke_arn
}

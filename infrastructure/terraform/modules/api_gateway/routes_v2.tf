# Matika v2 — API Gateway routes
#
# Adds four routes to the existing carelog-${env}-api REST API:
#   POST /conversation/turn           → matika-${env}-bedrock-router
#   POST /conversation/turn-stream    → matika-${env}-bedrock-router (SSE)
#   POST /conversation/photo-extract  → matika-${env}-bedrock-vision
#   GET  /health                      → matika-${env}-health-check (NO AUTH)
#
# All conversation routes use the existing Cognito authorizer (decision Q0.2:
# reuse carelog-dev-users pool). /health is unauthenticated by design — it's
# probed by smoke tests and external uptime monitors.
#
# After adding/removing routes here, also update the
# `aws_api_gateway_deployment.main.triggers` block in main.tf to include
# the new resource/method/integration IDs — otherwise the stage won't
# pick up the new routes on apply.

# ============================================================
# RESOURCES
# ============================================================

# /conversation
resource "aws_api_gateway_resource" "conversation" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "conversation"
}

# /conversation/turn
resource "aws_api_gateway_resource" "conversation_turn" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.conversation.id
  path_part   = "turn"
}

# /conversation/turn-stream
resource "aws_api_gateway_resource" "conversation_turn_stream" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.conversation.id
  path_part   = "turn-stream"
}

# /conversation/photo-extract
resource "aws_api_gateway_resource" "conversation_photo_extract" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.conversation.id
  path_part   = "photo-extract"
}

# /health
resource "aws_api_gateway_resource" "health" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "health"
}

# ============================================================
# METHODS + INTEGRATIONS
# ============================================================

# POST /conversation/turn
resource "aws_api_gateway_method" "conversation_turn_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.conversation_turn.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "conversation_turn_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.conversation_turn.id
  http_method             = aws_api_gateway_method.conversation_turn_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.bedrock_router_invoke_arn
}

# POST /conversation/turn-stream — same router Lambda, different handler path
resource "aws_api_gateway_method" "conversation_turn_stream_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.conversation_turn_stream.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "conversation_turn_stream_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.conversation_turn_stream.id
  http_method             = aws_api_gateway_method.conversation_turn_stream_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.bedrock_router_invoke_arn
}

# POST /conversation/photo-extract
resource "aws_api_gateway_method" "conversation_photo_extract_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.conversation_photo_extract.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "conversation_photo_extract_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.conversation_photo_extract.id
  http_method             = aws_api_gateway_method.conversation_photo_extract_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.bedrock_vision_invoke_arn
}

# GET /health — unauthenticated by design
resource "aws_api_gateway_method" "health_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.health.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "health_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.health.id
  http_method             = aws_api_gateway_method.health_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.health_check_invoke_arn
}

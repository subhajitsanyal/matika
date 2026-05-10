# Matika v2 — API Gateway routes
#
# Adds five routes to the existing carelog-${env}-api REST API:
#   POST /conversation/turn           → matika-${env}-bedrock-router
#   POST /conversation/turn-stream    → matika-${env}-bedrock-router (SSE)
#   POST /conversation/photo-extract  → matika-${env}-bedrock-vision
#   POST /conversation/photo-presign  → matika-${env}-photo-presign
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

# /conversation/photo-presign — issues short-lived S3 PUT URLs for the
# JPEG upload that precedes /conversation/photo-extract.
resource "aws_api_gateway_resource" "conversation_photo_presign" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.conversation.id
  path_part   = "photo-presign"
}

# /health
resource "aws_api_gateway_resource" "health" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "health"
}

# F2 — /sessions/{sessionId}/end. Two-segment path under a new
# /sessions resource. The lambda handler resolves caller→user_id
# from the Cognito authorizer claims; the route only needs the
# COGNITO_USER_POOLS authorizer to enforce a logged-in user.
resource "aws_api_gateway_resource" "sessions" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "sessions"
}

resource "aws_api_gateway_resource" "session_id" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.sessions.id
  path_part   = "{sessionId}"
}

resource "aws_api_gateway_resource" "session_end" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.session_id.id
  path_part   = "end"
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

# POST /conversation/photo-presign
resource "aws_api_gateway_method" "conversation_photo_presign_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.conversation_photo_presign.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "conversation_photo_presign_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.conversation_photo_presign.id
  http_method             = aws_api_gateway_method.conversation_photo_presign_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.photo_presign_invoke_arn
}

# POST /sessions/{sessionId}/end — F2 explicit-close
resource "aws_api_gateway_method" "session_end_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.session_end.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
  request_parameters = {
    "method.request.path.sessionId" = true
  }
}

resource "aws_api_gateway_integration" "session_end_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.session_end.id
  http_method             = aws_api_gateway_method.session_end_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.end_session_invoke_arn
}

# F17 — POST /device-tokens (register FCM/APNs token)
resource "aws_api_gateway_method" "device_tokens_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.device_tokens.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "device_tokens_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.device_tokens.id
  http_method             = aws_api_gateway_method.device_tokens_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.device_token_invoke_arn
}

# F17 — DELETE /device-tokens?deviceId=... (unregister on sign-out)
resource "aws_api_gateway_method" "device_tokens_delete" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.device_tokens.id
  http_method   = "DELETE"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
  request_parameters = {
    "method.request.querystring.deviceId" = true
  }
}

resource "aws_api_gateway_integration" "device_tokens_delete" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.device_tokens.id
  http_method             = aws_api_gateway_method.device_tokens_delete.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.device_token_invoke_arn
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

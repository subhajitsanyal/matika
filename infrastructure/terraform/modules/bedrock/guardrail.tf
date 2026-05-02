# Bedrock Guardrail — PHI redaction + denied medical-advice topics + custom emergency triggers.
#
# Real implementation in P0 — T-V2-004 per docs/matika_spec_v2.md §11.5.
# Content (denied topics, PII filters, custom triggers) authored by inference-platform agent.

# resource "aws_bedrock_guardrail" "matika" {
#   name        = "matika-${var.environment}-guardrail"
#   description = "Matika v2 guardrail: PHI redaction + denied medical-advice + custom emergency triggers"
#
#   blocked_input_messaging  = "I can't help with that here. Please contact your caregiver or a clinician."
#   blocked_outputs_messaging = "I can't share that. Please ask your caregiver or doctor."
#
#   # PII filters, denied topics, and custom topic triggers added in T-V2-004.
# }

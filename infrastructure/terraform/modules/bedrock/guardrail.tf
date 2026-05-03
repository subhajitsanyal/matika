# Bedrock Guardrail — content filters + denied medical-advice topics.
#
# Spec: docs/matika_spec_v2.md §11.5.
#
# v2.0 scope: content filters at HIGH strength + denied topics for medical
# advice and medication dosage. PII redaction is NOT enabled because the
# patient's first name is operationally needed in the conversation (the
# model addresses the patient by name). Custom emergency-keyword detection
# is handled in escalation/signal_detectors.ts (pre-model) rather than via
# Guardrail topic policy — emergencies need to escalate UP (route to Sonnet),
# not be blocked.

resource "aws_bedrock_guardrail" "matika" {
  name        = "matika-${var.environment}-guardrail"
  description = "Matika v2 guardrail: content filtering + denied medical-advice topics"

  blocked_input_messaging   = "I can't help with that here. Please contact your caregiver or a clinician."
  blocked_outputs_messaging = "I can't share that. Please ask your caregiver or doctor."

  content_policy_config {
    filters_config {
      input_strength  = "HIGH"
      output_strength = "HIGH"
      type            = "HATE"
    }
    filters_config {
      input_strength  = "HIGH"
      output_strength = "HIGH"
      type            = "INSULTS"
    }
    filters_config {
      input_strength  = "HIGH"
      output_strength = "HIGH"
      type            = "SEXUAL"
    }
    filters_config {
      input_strength  = "HIGH"
      output_strength = "HIGH"
      type            = "VIOLENCE"
    }
    filters_config {
      input_strength  = "HIGH"
      output_strength = "HIGH"
      type            = "MISCONDUCT"
    }
  }

  topic_policy_config {
    topics_config {
      name       = "medical_advice"
      definition = "Diagnosing illness, prescribing medication, recommending dosage changes, interpreting lab results, or making clinical decisions on behalf of a doctor."
      examples = [
        "Should I take more of my blood pressure medication?",
        "Is my heart rate dangerous?",
        "Do I have diabetes?",
        "What does this lab result mean?",
      ]
      type = "DENY"
    }
    topics_config {
      name       = "medication_dosage"
      definition = "Specific dosing instructions, drug interactions, or changes to medication regimens."
      examples = [
        "Can I take 200mg of metformin instead?",
        "Should I stop taking my statin?",
        "Is it safe to take ibuprofen with my blood thinner?",
      ]
      type = "DENY"
    }
  }
}

resource "aws_bedrock_guardrail_version" "matika" {
  description   = "Matika v2 initial guardrail version"
  guardrail_arn = aws_bedrock_guardrail.matika.guardrail_arn
}

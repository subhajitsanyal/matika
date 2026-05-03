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
    # NOTE: the medical_advice topic was originally broader ("interpreting lab
    # results", "Is my heart rate dangerous?", "What does this lab result
    # mean?") but blocked legitimate vital acknowledgment turns where the
    # model briefly classified a BP reading. Narrowed to prescriptive advice
    # only; the broader interpretation guard now lives in the system prompt.
    topics_config {
      name       = "medical_diagnosis_or_prescription"
      definition = "Telling the patient they have a diagnosis, prescribing medication, or recommending starting/stopping/changing medication doses without a doctor's direction."
      examples = [
        "You have hypertension and should start medication.",
        "Take 50mg of amlodipine twice a day.",
        "Stop taking your statin immediately.",
        "Do I have diabetes?",
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
  description   = "Matika v2 guardrail (auto-versioned on each guardrail change)"
  guardrail_arn = aws_bedrock_guardrail.matika.guardrail_arn

  lifecycle {
    # Publish a fresh version whenever the underlying guardrail content
    # changes. Otherwise the env var BEDROCK_GUARDRAIL_VERSION stays pinned
    # to the original v1 even after we update topic_policy_config etc.
    replace_triggered_by = [aws_bedrock_guardrail.matika]
  }
}

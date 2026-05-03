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
    # NOTES on iteration history:
    #   1. The original `medical_advice` topic ("interpreting lab results",
    #      "Is my heart rate dangerous?") blocked legitimate vital
    #      acknowledgment turns where the model briefly classified a BP
    #      reading. Narrowed to prescriptive advice only.
    #   2. A separate `medication_dosage` topic ("Specific dosing
    #      instructions, drug interactions") was originally added in
    #      addition. We removed it after discovering it triggered on
    #      caregiver_onboarding turns where caregivers DESCRIBED the
    #      patient's existing regimen ("he takes Amlodipine 5mg every
    #      morning, Metformin 500mg twice a day"). Bedrock topic DENY
    #      filters apply symmetrically to input and output, so the
    #      caregiver's contextual mention triggered just as readily as
    #      a patient asking for dosing advice. The remaining
    #      `medical_diagnosis_or_prescription` topic already covers the
    #      assistant GIVING dosing advice ("Take 50mg of amlodipine
    #      twice a day."), which is the actual concern. Asking for
    #      dosing advice ("Can I take 200mg instead?") is handled by
    #      the system prompt's refusal rules — blocking it at the
    #      Guardrail layer was redundant and caused real false positives.
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

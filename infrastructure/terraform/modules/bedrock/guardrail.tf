# Bedrock Guardrail — content filters only.
#
# Spec: docs/matika_spec_v2.md §11.5.
#
# v2.0 pilot scope: content filters at HIGH strength. PII redaction is
# NOT enabled because the patient's first name is operationally needed
# in the conversation (the model addresses the patient by name). Custom
# emergency-keyword detection is handled in escalation/signal_detectors.ts
# (pre-model) rather than via Guardrail topic policy — emergencies need
# to escalate UP (route to Sonnet), not be blocked.
#
# `topic_policy_config` is intentionally absent — see iteration history
# above the resource block below.

resource "aws_bedrock_guardrail" "matika" {
  name        = "matika-${var.environment}-guardrail"
  description = "Matika v2 guardrail: content filtering only (pilot scope)"

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

  # NOTES on topic_policy_config iteration history (the block is now absent):
  #   1. The original `medical_advice` topic ("interpreting lab results",
  #      "Is my heart rate dangerous?") blocked legitimate vital
  #      acknowledgment turns where the model briefly classified a BP
  #      reading. Narrowed to prescriptive advice only.
  #   2. A `medication_dosage` topic ("Specific dosing instructions, drug
  #      interactions") was added next, then removed because it triggered
  #      on caregiver_onboarding turns where caregivers DESCRIBED the
  #      patient's existing regimen ("he takes Amlodipine 5mg every
  #      morning, Metformin 500mg twice a day").
  #   3. The remaining `medical_diagnosis_or_prescription` topic was
  #      removed during Phase A.6 pilot smoke-testing (2026-05-03). The
  #      Bedrock topic classifier was firing on patient_logging *inputs*
  #      ("BP is one thirty over eighty five") — every turn was being
  #      rewritten to the blocked_input_messaging text. Topic DENY
  #      filters apply symmetrically to input and output and are
  #      classifier-driven, so even a benign vital report can match a
  #      topic about diagnoses/prescriptions. The system prompt's refusal
  #      rules in prompts/system_v2.md remain authoritative for "don't
  #      give diagnoses / don't prescribe" — the model layer can tell
  #      the difference between reporting a vital and interpreting one,
  #      where the Guardrail classifier cannot.
  #
  # If reintroducing topic policy post-pilot, gather a few hundred
  # passing transcripts first and use them as counter-examples to teach
  # the classifier what NOT to flag.
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

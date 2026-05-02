// Structured output parser for Bedrock LLM responses.
// Owner: backend agent. Schema owned by inference-platform agent (output_schema.json).
//
// Spec: docs/matika_spec_v2.md §6.4 — extracts JSON from <output>...</output>
// tags, validates against output_schema.json, and surfaces typed errors.

import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import schema from '../output_schema.json';

export type ParameterName =
  | 'blood_pressure_systolic'
  | 'blood_pressure_diastolic'
  | 'blood_glucose'
  | 'blood_glucose_fasting'
  | 'blood_glucose_postprandial'
  | 'body_temperature_c'
  | 'body_temperature_f'
  | 'spo2'
  | 'heart_rate'
  | 'body_weight';

export type ExtractedValueStatus = 'pending_confirmation' | 'confirmed' | 'rejected';

export type ActionType =
  | 'request_photo'
  | 'escalate_emergency'
  | 'pause_session'
  | 'complete_session'
  | 'confirm_value';

export type EscalationReason =
  | 'implausible_value'
  | 'emergency'
  | 'caregiver_protocol_design'
  | 'cross_session_continuity'
  | 'low_confidence_extraction'
  | 'code_switch_density_high'
  | 'long_response_expected';

export interface ExtractedValue {
  parameter: ParameterName;
  value: number;
  unit: string;
  loincCode: string;
  status: ExtractedValueStatus;
  confidence: number;
}

export interface Action {
  type: ActionType;
  reason?: string;
}

export interface TtsHints {
  language: 'en-IN' | 'hi-IN' | 'bn-IN';
  spellOutNumbers: boolean;
  rate?: number;
}

export interface StructuredOutput {
  responseText: string;
  ttsHints: TtsHints;
  extractedValues: ExtractedValue[];
  actions: Action[];
  stateTransition: string;
  escalationReason: EscalationReason | null;
}

export type ParseFailureKind =
  | 'no_output_tags'
  | 'multiple_output_tags'
  | 'invalid_json'
  | 'schema_validation';

export class StructuredOutputParseError extends Error {
  public readonly kind: ParseFailureKind;
  public readonly raw: string;
  public readonly validationErrors?: ErrorObject[];

  constructor(kind: ParseFailureKind, message: string, raw: string, validationErrors?: ErrorObject[]) {
    super(message);
    this.name = 'StructuredOutputParseError';
    this.kind = kind;
    this.raw = raw;
    this.validationErrors = validationErrors;
  }
}

// Compile the validator once at module load — Lambda re-uses across invocations.
const ajv = new Ajv({ strict: false, allErrors: true });
const validate: ValidateFunction<StructuredOutput> = ajv.compile(schema as object) as ValidateFunction<StructuredOutput>;

const OUTPUT_TAG_REGEX = /<output>([\s\S]*?)<\/output>/g;

export function parseStructuredOutput(rawLlmText: string): StructuredOutput {
  const matches = [...rawLlmText.matchAll(OUTPUT_TAG_REGEX)];

  if (matches.length === 0) {
    throw new StructuredOutputParseError(
      'no_output_tags',
      'No <output>...</output> block found in LLM response.',
      rawLlmText,
    );
  }
  if (matches.length > 1) {
    throw new StructuredOutputParseError(
      'multiple_output_tags',
      `Found ${matches.length} <output> blocks; expected exactly one.`,
      rawLlmText,
    );
  }

  const jsonText = matches[0][1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new StructuredOutputParseError(
      'invalid_json',
      `JSON.parse failed: ${(err as Error).message}`,
      rawLlmText,
    );
  }

  if (!validate(parsed)) {
    throw new StructuredOutputParseError(
      'schema_validation',
      `Schema validation failed: ${ajv.errorsText(validate.errors)}`,
      rawLlmText,
      validate.errors ?? undefined,
    );
  }

  return parsed as StructuredOutput;
}

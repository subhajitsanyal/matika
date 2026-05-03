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

// Result envelope so callers can distinguish strict-parse from
// fallback-recovered turns and emit telemetry accordingly. Production
// callers use parseStructuredOutput() which returns the bare value;
// callers that want telemetry use parseStructuredOutputDetailed().
export interface ParseDetails {
  parsed: StructuredOutput;
  // 'strict' = one `<output>` block, parsed cleanly (the happy path).
  // 'recovered_bare_json' = no `<output>` tags but the response was
  //   itself a single valid JSON object that matched the schema.
  //   Models occasionally drop the envelope on long/dense replies;
  //   this lets us recover invisibly to the user while still flagging
  //   the drift via telemetry.
  source: 'strict' | 'recovered_bare_json';
}

export function parseStructuredOutput(rawLlmText: string): StructuredOutput {
  return parseStructuredOutputDetailed(rawLlmText).parsed;
}

export function parseStructuredOutputDetailed(rawLlmText: string): ParseDetails {
  const matches = [...rawLlmText.matchAll(OUTPUT_TAG_REGEX)];

  if (matches.length > 1) {
    // Multiple <output> blocks is genuinely ambiguous — don't try to
    // pick one. Fail fast so the retry path can prompt for a single block.
    throw new StructuredOutputParseError(
      'multiple_output_tags',
      `Found ${matches.length} <output> blocks; expected exactly one.`,
      rawLlmText,
    );
  }

  if (matches.length === 1) {
    return { parsed: parseAndValidate(matches[0][1].trim(), rawLlmText), source: 'strict' };
  }

  // No <output> tags. Before giving up, try to recover a bare JSON
  // object — the most common failure mode is the model omitting tags
  // entirely on long/dense replies and just emitting the JSON directly.
  const recovered = tryRecoverBareJson(rawLlmText);
  if (recovered !== null) {
    return { parsed: recovered, source: 'recovered_bare_json' };
  }

  throw new StructuredOutputParseError(
    'no_output_tags',
    'No <output>...</output> block found in LLM response.',
    rawLlmText,
  );
}

function parseAndValidate(jsonText: string, raw: string): StructuredOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new StructuredOutputParseError(
      'invalid_json',
      `JSON.parse failed: ${(err as Error).message}`,
      raw,
    );
  }

  if (!validate(parsed)) {
    throw new StructuredOutputParseError(
      'schema_validation',
      `Schema validation failed: ${ajv.errorsText(validate.errors)}`,
      raw,
      validate.errors ?? undefined,
    );
  }

  return parsed as StructuredOutput;
}

// Best-effort recovery: scan for the first balanced JSON object in the
// raw text and return it if it parses + validates. If anything fails,
// return null and let the caller throw the original no_output_tags
// error — we want the retry path to still fire on truly malformed
// output, not silently accept noise.
function tryRecoverBareJson(rawLlmText: string): StructuredOutput | null {
  const start = rawLlmText.indexOf('{');
  if (start < 0) return null;

  // Walk the string tracking brace depth, ignoring braces inside
  // string literals. Stops at the first balanced `}` — fast enough
  // for typical 2KB responses.
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let end = -1;
  for (let i = start; i < rawLlmText.length; i++) {
    const ch = rawLlmText[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (inString) {
      if (ch === '\\') escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return null;

  const candidate = rawLlmText.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (validate(parsed)) {
      return parsed as StructuredOutput;
    }
  } catch {
    // Either not valid JSON or fails schema — let the caller fall
    // through to the regular no_output_tags error path.
  }
  return null;
}

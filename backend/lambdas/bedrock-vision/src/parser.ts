// Structured output parser for vision LLM responses.
// Schema in output_schema.json (owned by inference-platform).
//
// Extracts <output>...</output> block, parses JSON, validates against schema.
// Mirrors the parser pattern used by bedrock-router but with the vision-
// specific output shape.

import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import schema from '../output_schema.json';

export interface VisionExtraction {
  value: number;
  unit: string;
  confidence: number;
  rationale: string;
}

export type VisionParseFailureKind =
  | 'no_output_tags'
  | 'multiple_output_tags'
  | 'invalid_json'
  | 'schema_validation';

export class VisionParseError extends Error {
  public readonly kind: VisionParseFailureKind;
  public readonly raw: string;
  public readonly validationErrors?: ErrorObject[];

  constructor(kind: VisionParseFailureKind, message: string, raw: string, validationErrors?: ErrorObject[]) {
    super(message);
    this.name = 'VisionParseError';
    this.kind = kind;
    this.raw = raw;
    this.validationErrors = validationErrors;
  }
}

const ajv = new Ajv({ strict: false, allErrors: true });
const validate: ValidateFunction<VisionExtraction> = ajv.compile(schema as object) as ValidateFunction<VisionExtraction>;

const OUTPUT_TAG_REGEX = /<output>([\s\S]*?)<\/output>/g;

export function parseVisionOutput(rawLlmText: string): VisionExtraction {
  const matches = [...rawLlmText.matchAll(OUTPUT_TAG_REGEX)];
  if (matches.length === 0) {
    throw new VisionParseError(
      'no_output_tags',
      'No <output>...</output> block found in vision LLM response.',
      rawLlmText,
    );
  }
  if (matches.length > 1) {
    throw new VisionParseError(
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
    throw new VisionParseError(
      'invalid_json',
      `JSON.parse failed: ${(err as Error).message}`,
      rawLlmText,
    );
  }

  if (!validate(parsed)) {
    throw new VisionParseError(
      'schema_validation',
      `Vision output schema validation failed: ${ajv.errorsText(validate.errors)}`,
      rawLlmText,
      validate.errors ?? undefined,
    );
  }

  return parsed as VisionExtraction;
}

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';

describe('inference-platform scaffold', () => {
  it('passes a baseline test', () => {
    expect(1 + 1).toBe(2);
  });

  it('loads bedrock-router output schema as valid JSON Schema', () => {
    const schemaPath = resolve(
      __dirname,
      '..',
      '..',
      'backend',
      'lambdas',
      'bedrock-router',
      'output_schema.json',
    );
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(schema);

    // Validate a stub-shape document against the placeholder schema.
    const sample = {
      responseText: 'I heard one thirty over eighty five.',
      stateTransition: 'EXTRACTING -> PENDING_CONFIRMATION',
    };
    expect(validate(sample)).toBe(true);
  });
});

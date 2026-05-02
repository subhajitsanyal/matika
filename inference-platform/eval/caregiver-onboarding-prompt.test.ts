import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';

// Structural evals for backend/lambdas/bedrock-router/prompts/
// system_v2_caregiver_onboarding.md. Owned by inference-platform per
// AGENTS.md §3.1. The structured-output JSON schema is shared with
// system_v2.md (output_schema.json), so example blocks must validate
// against the same schema.

const PROMPT_PATH = resolve(
  __dirname,
  '..',
  '..',
  'backend',
  'lambdas',
  'bedrock-router',
  'prompts',
  'system_v2_caregiver_onboarding.md',
);

const SCHEMA_PATH = resolve(
  __dirname,
  '..',
  '..',
  'backend',
  'lambdas',
  'bedrock-router',
  'output_schema.json',
);

const PROMPT = readFileSync(PROMPT_PATH, 'utf-8');

describe('caregiver_onboarding prompt — structural checks', () => {
  it('exists and is non-empty', () => {
    expect(PROMPT.length).toBeGreaterThan(0);
  });

  it('contains the cache breakpoint marker', () => {
    expect(PROMPT).toContain('<!-- CACHE_BREAKPOINT -->');
  });

  it('size envelope (~2K–4K tokens for a focused onboarding prompt)', () => {
    expect(PROMPT.length).toBeGreaterThan(3000);
    expect(PROMPT.length).toBeLessThan(15000);
  });

  it('declares the audience is the caregiver, not the patient', () => {
    expect(PROMPT).toContain('caregiver');
    expect(PROMPT.toLowerCase()).toMatch(/not.*speaking to the patient|not.*the patient/);
  });

  it('walks through all seven onboarding stages', () => {
    const stages = [
      'Stage 1',
      'Stage 2',
      'Stage 3',
      'Stage 4',
      'Stage 5',
      'Stage 6',
      'Stage 7',
    ];
    for (const stage of stages) {
      expect(PROMPT).toContain(stage);
    }
  });

  it('mentions all three supported language locales', () => {
    expect(PROMPT).toContain('en-IN');
    expect(PROMPT).toContain('hi-IN');
    expect(PROMPT).toContain('bn-IN');
  });

  it('explicitly forbids extracting health values during onboarding', () => {
    expect(PROMPT.toLowerCase()).toMatch(/extractedvalues.*\[\]|always.*empty/i);
    expect(PROMPT.toLowerCase()).toContain("don't extract health values");
  });

  it('mentions parameter elicitation (Stage 5)', () => {
    expect(PROMPT.toLowerCase()).toContain('blood pressure');
    expect(PROMPT.toLowerCase()).toContain('blood glucose');
    expect(PROMPT.toLowerCase()).toMatch(/spo2|oxygen/);
  });

  it('describes frequency + deadline collection (Stage 6)', () => {
    expect(PROMPT.toLowerCase()).toMatch(/how often|every day|every other day|weekly/);
    expect(PROMPT.toLowerCase()).toMatch(/deadline|by what time/);
  });

  it('contains complete_session action guidance for Stage 7', () => {
    expect(PROMPT).toContain('complete_session');
  });

  it('contains pause_session action guidance for caregiver interruption', () => {
    expect(PROMPT).toContain('pause_session');
  });

  it('uses the caregiver_protocol_design escalation reason', () => {
    expect(PROMPT).toContain('caregiver_protocol_design');
  });
});

describe('caregiver_onboarding output examples validate against output_schema.json', () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);

  // Match only `<output>` at start of line — avoids inline-mention pollution.
  const exampleBlocks = [...PROMPT.matchAll(/^<output>([\s\S]*?)^<\/output>/gm)].map((m) => m[1]);

  it('finds at least three <output> example blocks', () => {
    expect(exampleBlocks.length).toBeGreaterThanOrEqual(3);
  });

  it('every example block is valid JSON', () => {
    for (const block of exampleBlocks) {
      expect(() => JSON.parse(block.trim())).not.toThrow();
    }
  });

  it('every example block validates against output_schema.json', () => {
    for (const block of exampleBlocks) {
      const parsed = JSON.parse(block.trim());
      const valid = validate(parsed);
      if (!valid) {
        throw new Error(
          `Schema validation failed: ${ajv.errorsText(validate.errors)}\n${block}`,
        );
      }
      expect(valid).toBe(true);
    }
  });

  it('every example block has empty extractedValues (onboarding rule)', () => {
    for (const block of exampleBlocks) {
      const parsed = JSON.parse(block.trim()) as { extractedValues: unknown[] };
      expect(parsed.extractedValues).toEqual([]);
    }
  });
});

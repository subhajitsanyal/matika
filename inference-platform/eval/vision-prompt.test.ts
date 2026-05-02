import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';

// Structural evals for backend/lambdas/bedrock-vision/prompts/extract_value.md.
// Owned by inference-platform per AGENTS.md §3.1. Any prompt change must keep
// these passing.

const PROMPT_PATH = resolve(
  __dirname,
  '..',
  '..',
  'backend',
  'lambdas',
  'bedrock-vision',
  'prompts',
  'extract_value.md',
);

const SCHEMA_PATH = resolve(
  __dirname,
  '..',
  '..',
  'backend',
  'lambdas',
  'bedrock-vision',
  'output_schema.json',
);

const PROMPT = readFileSync(PROMPT_PATH, 'utf-8');

describe('vision prompt — structural checks', () => {
  it('exists and is non-empty', () => {
    expect(PROMPT.length).toBeGreaterThan(0);
  });

  it('contains the cache breakpoint marker', () => {
    expect(PROMPT).toContain('<!-- CACHE_BREAKPOINT -->');
  });

  it('size envelope (~1.5K tokens for vision prompt)', () => {
    // Vision prompt is shorter than the conversational system prompt because
    // it describes a single narrow task. Allow 2K–10K characters.
    expect(PROMPT.length).toBeGreaterThan(2000);
    expect(PROMPT.length).toBeLessThan(10000);
  });

  it('contains a confidence rubric section', () => {
    expect(PROMPT).toContain('Confidence rubric');
  });

  it('mentions the 0.80 escalation threshold so the model calibrates', () => {
    expect(PROMPT).toMatch(/0\.80?/);
  });

  it('lists the device-type hints the handler will pass', () => {
    const hints = ['glucometer', 'bp_cuff', 'thermometer', 'pulse_oximeter', 'weighing_scale'];
    for (const h of hints) {
      expect(PROMPT).toContain(h);
    }
  });

  it('describes the output JSON shape', () => {
    expect(PROMPT).toContain('value');
    expect(PROMPT).toContain('unit');
    expect(PROMPT).toContain('confidence');
    expect(PROMPT).toContain('rationale');
  });

  it('contains at least three worked examples', () => {
    // Match any heading that starts with **Example
    const examples = PROMPT.match(/\*\*Example \d+/g) ?? [];
    expect(examples.length).toBeGreaterThanOrEqual(3);
  });
});

describe('vision output schema validates the prompt examples', () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);

  // Match only `<output>` at start of line — avoids capturing inline backtick
  // mentions in prose.
  const exampleBlocks = [...PROMPT.matchAll(/^<output>([\s\S]*?)^<\/output>/gm)].map((m) => m[1]);

  it('finds at least three <output> example blocks in the prompt', () => {
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
          `Schema validation failed for example: ${ajv.errorsText(validate.errors)}\n${block}`,
        );
      }
      expect(valid).toBe(true);
    }
  });
});

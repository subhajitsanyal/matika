import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';

// Structural evals for backend/lambdas/bedrock-router/prompts/system_v2.md.
// Owned by inference-platform per AGENTS.md §3.1. Any prompt change must keep
// these passing or the change is not eligible to merge.

const PROMPT_PATH = resolve(
  __dirname,
  '..',
  '..',
  'backend',
  'lambdas',
  'bedrock-router',
  'prompts',
  'system_v2.md',
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

describe('system prompt v2 — structural checks', () => {
  it('exists and is non-empty', () => {
    expect(PROMPT.length).toBeGreaterThan(0);
  });

  it('contains the cache breakpoint marker', () => {
    expect(PROMPT).toContain('<!-- CACHE_BREAKPOINT -->');
  });

  it('size is within expected envelope (~3K tokens)', () => {
    // Rough heuristic: 1 token ≈ 4 characters for English+devanagari mix.
    // Target 3K tokens (~12K chars). Allow 8K–18K.
    expect(PROMPT.length).toBeGreaterThan(8000);
    expect(PROMPT.length).toBeLessThan(18000);
  });

  it('contains the four required headline sections', () => {
    const required = [
      '# Languages',
      '# Health parameters',
      '# Conversation rules',
      '# Output format',
    ];
    for (const heading of required) {
      expect(PROMPT).toContain(heading);
    }
  });

  it('mentions all three supported language locales', () => {
    expect(PROMPT).toContain('en-IN');
    expect(PROMPT).toContain('hi-IN');
    expect(PROMPT).toContain('bn-IN');
  });

  it('lists all ten supported parameters', () => {
    const params = [
      'blood_pressure_systolic',
      'blood_pressure_diastolic',
      'blood_glucose',
      'blood_glucose_fasting',
      'blood_glucose_postprandial',
      'body_temperature_c',
      'body_temperature_f',
      'spo2',
      'heart_rate',
      'body_weight',
    ];
    for (const p of params) {
      expect(PROMPT).toContain(p);
    }
  });

  it('lists every action type from the schema', () => {
    const actions = [
      'request_photo',
      'escalate_emergency',
      'pause_session',
      'complete_session',
      'confirm_value',
    ];
    for (const a of actions) {
      expect(PROMPT).toContain(a);
    }
  });

  it('lists every escalation reason from the schema', () => {
    const reasons = [
      'implausible_value',
      'emergency',
      'caregiver_protocol_design',
      'cross_session_continuity',
      'low_confidence_extraction',
      'code_switch_density_high',
      'long_response_expected',
    ];
    for (const r of reasons) {
      expect(PROMPT).toContain(r);
    }
  });

  it('contains an example for each language path', () => {
    // We expect at least one example block triggered by an English, Hindi, and
    // Bengali patient utterance.
    expect(PROMPT.toLowerCase()).toContain('english');
    expect(PROMPT.toLowerCase()).toContain('hindi');
    expect(PROMPT.toLowerCase()).toContain('bengali');
  });
});

describe('output schema validates the prompt examples', () => {
  // The system prompt embeds example <output> blocks. They must match the
  // schema — if they drift, model imitation will produce invalid responses.
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);

  // Match only `<output>` at start of line — avoids capturing inline backtick
  // mentions of <output> in explanatory prose.
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
        throw new Error(`Schema validation failed for example: ${ajv.errorsText(validate.errors)}\n${block}`);
      }
      expect(valid).toBe(true);
    }
  });
});

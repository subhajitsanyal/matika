import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Structural evals for backend/lambdas/bedrock-router/prompts/summarize.md.
// Owned by inference-platform per AGENTS.md §3.1.

const PROMPT_PATH = resolve(
  __dirname,
  '..',
  '..',
  'backend',
  'lambdas',
  'bedrock-router',
  'prompts',
  'summarize.md',
);

const PROMPT = readFileSync(PROMPT_PATH, 'utf-8');

describe('summarize.md — structural checks', () => {
  it('exists and is non-empty', () => {
    expect(PROMPT.length).toBeGreaterThan(0);
  });

  it('contains the cache breakpoint marker', () => {
    expect(PROMPT).toContain('<!-- CACHE_BREAKPOINT -->');
  });

  it('size envelope (~500-token summarization prompt)', () => {
    // Smaller than the conversational system prompt; bigger than a one-liner.
    // 1K–6K characters.
    expect(PROMPT.length).toBeGreaterThan(1000);
    expect(PROMPT.length).toBeLessThan(6000);
  });

  it('explains both inputs (existing summary + older turns)', () => {
    expect(PROMPT.toLowerCase()).toContain('existing summary');
    expect(PROMPT.toLowerCase()).toMatch(/older turns/i);
  });

  it('caps output length to keep summaries small', () => {
    // The handler relies on summaries being short to keep the per-patient
    // cache block compact. Hard upper bound called out in the prompt.
    expect(PROMPT).toMatch(/(≤|<=)\s*80\s*tokens|1.3 sentences|1–3 sentences/);
  });

  it('instructs to note confirmed health values', () => {
    expect(PROMPT.toLowerCase()).toMatch(/confirmed.*value|health values/i);
  });

  it('instructs to note unresolved topics', () => {
    expect(PROMPT.toLowerCase()).toMatch(/unresolved|haven'?t been resolved/i);
  });

  it('forbids verbatim quotes (paraphrase only)', () => {
    expect(PROMPT.toLowerCase()).toMatch(/(paraphrase|not.*verbatim quotes)/);
  });

  it('forbids JSON or output-tag wrapping', () => {
    expect(PROMPT.toLowerCase()).toMatch(/no json|no <output>|no preamble/i);
  });

  it('contains at least one worked example', () => {
    expect(PROMPT.toLowerCase()).toContain('example');
  });
});

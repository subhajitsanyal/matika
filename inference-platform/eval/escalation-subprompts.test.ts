import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Structural evals for the escalation sub-prompts in
// backend/lambdas/bedrock-router/escalation_subprompts/. Owned by
// inference-platform per AGENTS.md §3.1.
//
// The handler prepends these to the per-turn block when a routing escalation
// reason fires. Their job is to give the LLM a focused directive sharper than
// the system prompt provides on its own. These evals are structural —
// semantic quality is human review.

const SUBPROMPT_DIR = resolve(
  __dirname,
  '..',
  '..',
  'backend',
  'lambdas',
  'bedrock-router',
  'escalation_subprompts',
);

function loadSubprompt(name: string): string {
  return readFileSync(resolve(SUBPROMPT_DIR, name), 'utf-8');
}

describe('emergency.md — escalation sub-prompt', () => {
  const PROMPT = loadSubprompt('emergency.md');

  it('exists and is non-empty', () => {
    expect(PROMPT.length).toBeGreaterThan(0);
  });

  it('declares it is a safety escalation', () => {
    expect(PROMPT.toUpperCase()).toContain('SAFETY ESCALATION');
  });

  it('instructs to set escalate_emergency action', () => {
    expect(PROMPT).toContain('escalate_emergency');
  });

  it('instructs to set escalationReason: "emergency"', () => {
    expect(PROMPT).toContain('emergency');
    expect(PROMPT.toLowerCase()).toContain('escalationreason');
  });

  it('instructs to NOT continue normal vital-logging', () => {
    expect(PROMPT.toLowerCase()).toMatch(/(stop|do not continue) (normal )?vital/i);
  });

  it('instructs to set extractedValues to empty', () => {
    expect(PROMPT).toContain('extractedValues');
    expect(PROMPT.toLowerCase()).toMatch(/extractedvalues:?\s*\[\]/);
  });

  it('reasonable size envelope', () => {
    expect(PROMPT.length).toBeGreaterThan(500);
    expect(PROMPT.length).toBeLessThan(5000);
  });
});

describe('implausible_value.md — escalation sub-prompt', () => {
  const PROMPT = loadSubprompt('implausible_value.md');

  it('exists and is non-empty', () => {
    expect(PROMPT.length).toBeGreaterThan(0);
  });

  it('declares it is a plausibility challenge', () => {
    expect(PROMPT.toUpperCase()).toContain('PLAUSIBILITY CHALLENGE');
  });

  it('mentions the physiological hard range', () => {
    expect(PROMPT.toLowerCase()).toMatch(/physiological (hard )?range/);
  });

  it('instructs to NOT record the implausible value', () => {
    expect(PROMPT.toLowerCase()).toMatch(/(not record|do not record)/);
  });

  it('instructs to set extractedValues to empty', () => {
    expect(PROMPT.toLowerCase()).toMatch(/extractedvalues:?\s*\[\]/);
  });

  it('mentions PLAUSIBILITY_CHALLENGE state transition', () => {
    expect(PROMPT).toContain('PLAUSIBILITY_CHALLENGE');
  });

  it('does NOT include emergency-style escalation language', () => {
    // Implausibility is a correctness signal, not safety — we don't want
    // the LLM to confuse the patient by sounding alarmed about a typo.
    expect(PROMPT.toLowerCase()).not.toContain('escalate_emergency');
    expect(PROMPT.toLowerCase()).not.toContain('emergency services');
  });

  it('reasonable size envelope', () => {
    expect(PROMPT.length).toBeGreaterThan(500);
    expect(PROMPT.length).toBeLessThan(5000);
  });
});

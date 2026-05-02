import { buildBedrockBody, countCacheBreakpoints } from '../src/prompt_builder';

describe('buildBedrockBody', () => {
  const valid = {
    systemPrompt: 'You are Matika, a warm health companion...',
    perPatientBlock: '## Patient\n- Name: Test',
    perTurnBlock: '## Current transcript\n**patient:** BP is 130/85.',
    maxTokens: 1024,
  };

  it('produces the expected Anthropic-on-Bedrock body shape', () => {
    const body = buildBedrockBody(valid);
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
    expect(body.max_tokens).toBe(1024);
    expect(body.system).toHaveLength(1);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toHaveLength(2);
  });

  it('places the system prompt as a cached system block', () => {
    const body = buildBedrockBody(valid);
    expect(body.system[0]).toEqual({
      type: 'text',
      text: valid.systemPrompt,
      cache_control: { type: 'ephemeral' },
    });
  });

  it('places per-patient as the first cached user content block', () => {
    const body = buildBedrockBody(valid);
    expect(body.messages[0].content[0]).toEqual({
      type: 'text',
      text: valid.perPatientBlock,
      cache_control: { type: 'ephemeral' },
    });
  });

  it('places per-turn as the second user content block, uncached', () => {
    const body = buildBedrockBody(valid);
    expect(body.messages[0].content[1]).toEqual({
      type: 'text',
      text: valid.perTurnBlock,
    });
    expect(body.messages[0].content[1].cache_control).toBeUndefined();
  });

  it('throws on empty system prompt', () => {
    expect(() => buildBedrockBody({ ...valid, systemPrompt: '   ' })).toThrow(/systemPrompt/);
  });

  it('throws on empty per-turn block', () => {
    expect(() => buildBedrockBody({ ...valid, perTurnBlock: '' })).toThrow(/perTurnBlock/);
  });

  it('throws on non-positive maxTokens', () => {
    expect(() => buildBedrockBody({ ...valid, maxTokens: 0 })).toThrow(/maxTokens/);
    expect(() => buildBedrockBody({ ...valid, maxTokens: -1 })).toThrow(/maxTokens/);
  });

  it('allows empty per-patient block (e.g. fresh session before context loads)', () => {
    const body = buildBedrockBody({ ...valid, perPatientBlock: '' });
    expect(body.messages[0].content[0].text).toBe('');
  });
});

describe('countCacheBreakpoints', () => {
  it('counts both cache breakpoints in a standard body', () => {
    const body = buildBedrockBody({
      systemPrompt: 's',
      perPatientBlock: 'p',
      perTurnBlock: 't',
      maxTokens: 100,
    });
    expect(countCacheBreakpoints(body)).toBe(2);
  });

  it('returns 0 for a body with no cache_control markers', () => {
    expect(
      countCacheBreakpoints({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 100,
        system: [{ type: 'text', text: 's' }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 't' }] }],
      }),
    ).toBe(0);
  });

  it('stays under Anthropic 4-breakpoint limit for our standard body', () => {
    const body = buildBedrockBody({
      systemPrompt: 's',
      perPatientBlock: 'p',
      perTurnBlock: 't',
      maxTokens: 100,
    });
    expect(countCacheBreakpoints(body)).toBeLessThanOrEqual(4);
  });
});

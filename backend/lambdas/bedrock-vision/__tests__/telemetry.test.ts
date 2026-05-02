import {
  calculateCost,
  calculateCostForTier,
  buildVisionModelCallRecord,
  pricingForTier,
  PgClient,
  PgVisionModelCallRecorder,
  HAIKU_VISION_PRICING,
  SONNET_VISION_PRICING,
} from '../src/telemetry';

describe('pricingForTier', () => {
  it('returns Haiku pricing for T2_VISION', () => {
    expect(pricingForTier('T2_VISION')).toBe(HAIKU_VISION_PRICING);
  });

  it('returns Sonnet pricing for T3_VISION', () => {
    expect(pricingForTier('T3_VISION')).toBe(SONNET_VISION_PRICING);
  });
});

describe('calculateCost', () => {
  it('zero usage costs zero', () => {
    expect(calculateCost({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, HAIKU_VISION_PRICING)).toBe(0);
  });

  it('computes Haiku vision cost for typical reading', () => {
    // 1500 input (1200 cached) + 30 output, on Haiku
    // non-cached: 300 * $1/Mtok = $0.0003
    // cached: 1200 * $0.1/Mtok = $0.00012
    // output: 30 * $5/Mtok = $0.00015
    // total: $0.00057
    const cost = calculateCost(
      { inputTokens: 1500, cachedInputTokens: 1200, outputTokens: 30 },
      HAIKU_VISION_PRICING,
    );
    expect(cost).toBeCloseTo(0.00057, 6);
  });

  it('Sonnet vision cost is 3x Haiku for the same usage', () => {
    const usage = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 };
    const haiku = calculateCostForTier(usage, 'T2_VISION');
    const sonnet = calculateCostForTier(usage, 'T3_VISION');
    expect(sonnet).toBeCloseTo(haiku * 3, 6);
  });

  it('throws on negative tokens', () => {
    expect(() =>
      calculateCost({ inputTokens: -1, cachedInputTokens: 0, outputTokens: 0 }, HAIKU_VISION_PRICING),
    ).toThrow(/negative/);
  });

  it('throws when cached exceeds input', () => {
    expect(() =>
      calculateCost({ inputTokens: 100, cachedInputTokens: 200, outputTokens: 0 }, HAIKU_VISION_PRICING),
    ).toThrow(/cannot exceed/);
  });
});

describe('buildVisionModelCallRecord', () => {
  it('produces a complete record with T2_VISION tier', () => {
    const record = buildVisionModelCallRecord({
      sessionId: 'session-1',
      patientId: 'patient-1',
      tier: 'T2_VISION',
      model: 'claude-haiku-4-5',
      guardrailBlocked: false,
      usage: { inputTokens: 1500, cachedInputTokens: 1200, outputTokens: 30 },
      latencyMs: 720,
      inferenceRegion: 'ap-southeast-1',
      escalationReason: null,
    });
    expect(record).toEqual({
      sessionId: 'session-1',
      patientId: 'patient-1',
      tier: 'T2_VISION',
      model: 'claude-haiku-4-5',
      streamed: false,
      guardrailBlocked: false,
      inputTokens: 1500,
      cachedInputTokens: 1200,
      outputTokens: 30,
      latencyMs: 720,
      inferenceRegion: 'ap-southeast-1',
      escalationReason: null,
      costUsd: 0.00057,
    });
  });

  it('captures vision_low_confidence escalation reason on Haiku miss', () => {
    const record = buildVisionModelCallRecord({
      sessionId: 's',
      patientId: 'p',
      tier: 'T2_VISION',
      model: 'claude-haiku-4-5',
      guardrailBlocked: false,
      usage: { inputTokens: 1500, cachedInputTokens: 0, outputTokens: 30 },
      latencyMs: 720,
      inferenceRegion: 'ap-southeast-1',
      escalationReason: 'vision_low_confidence',
    });
    expect(record.escalationReason).toBe('vision_low_confidence');
  });

  it('streamed is always false for vision', () => {
    const record = buildVisionModelCallRecord({
      sessionId: 's',
      patientId: 'p',
      tier: 'T3_VISION',
      model: 'claude-sonnet-4-x',
      guardrailBlocked: false,
      usage: { inputTokens: 2000, cachedInputTokens: 0, outputTokens: 50 },
      latencyMs: 1500,
      inferenceRegion: 'ap-southeast-1',
      escalationReason: null,
    });
    expect(record.streamed).toBe(false);
  });
});

describe('PgVisionModelCallRecorder', () => {
  it('writes one INSERT INTO model_call with all 13 columns', async () => {
    const calls: Array<{ text: string; params: unknown[] }> = [];
    const client: PgClient = {
      async query(text, params) {
        calls.push({ text, params: params ?? [] });
        return { rows: [] };
      },
    };
    const recorder = new PgVisionModelCallRecorder(client);
    await recorder.record({
      sessionId: 's1',
      patientId: 'p1',
      tier: 'T2_VISION',
      model: 'claude-haiku-4-5',
      streamed: false,
      guardrailBlocked: false,
      inputTokens: 1500,
      cachedInputTokens: 1200,
      outputTokens: 30,
      latencyMs: 720,
      inferenceRegion: 'ap-southeast-1',
      escalationReason: null,
      costUsd: 0.00057,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('INSERT INTO model_call');
    expect(calls[0].params).toEqual([
      's1',
      'p1',
      'T2_VISION',
      'claude-haiku-4-5',
      false,
      false,
      1500,
      1200,
      30,
      720,
      'ap-southeast-1',
      null,
      0.00057,
    ]);
  });
});

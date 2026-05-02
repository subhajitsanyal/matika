import {
  calculateCost,
  calculateCostForTier,
  buildModelCallRecord,
  cacheHitRate,
} from '../src/telemetry';
import {
  HAIKU_4_5_PRICING,
  SONNET_4_X_PRICING,
  pricingForTier,
} from '../src/pricing';

describe('pricingForTier', () => {
  it('returns Haiku pricing for T2', () => {
    expect(pricingForTier('T2')).toBe(HAIKU_4_5_PRICING);
  });

  it('returns Sonnet pricing for T3', () => {
    expect(pricingForTier('T3')).toBe(SONNET_4_X_PRICING);
  });

  it('returns Haiku vision pricing for T2_VISION', () => {
    expect(pricingForTier('T2_VISION')).toBe(HAIKU_4_5_PRICING);
  });

  it('returns Sonnet vision pricing for T3_VISION', () => {
    expect(pricingForTier('T3_VISION')).toBe(SONNET_4_X_PRICING);
  });
});

describe('calculateCost', () => {
  it('zero usage costs zero', () => {
    expect(calculateCost({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, HAIKU_4_5_PRICING)).toBe(0);
  });

  it('computes Haiku cost for a typical short turn', () => {
    // 1840 in (1420 cached) + 28 out, on Haiku
    // non-cached input: 420 * $1/Mtok = $0.00042
    // cached input: 1420 * $0.1/Mtok = $0.000142
    // output: 28 * $5/Mtok = $0.00014
    // total: $0.000702 → rounded to 6dp: 0.000702
    const cost = calculateCost(
      { inputTokens: 1840, cachedInputTokens: 1420, outputTokens: 28 },
      HAIKU_4_5_PRICING,
    );
    expect(cost).toBeCloseTo(0.000702, 6);
  });

  it('computes Sonnet cost for a typical T3 turn', () => {
    // 2100 in (1420 cached) + 85 out, on Sonnet
    // non-cached: 680 * $3/Mtok = $0.00204
    // cached: 1420 * $0.3/Mtok = $0.000426
    // output: 85 * $15/Mtok = $0.001275
    // total: $0.003741
    const cost = calculateCost(
      { inputTokens: 2100, cachedInputTokens: 1420, outputTokens: 85 },
      SONNET_4_X_PRICING,
    );
    expect(cost).toBeCloseTo(0.003741, 6);
  });

  it('rounds to 6 decimal places', () => {
    const cost = calculateCost({ inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, HAIKU_4_5_PRICING);
    // 1/1M * 1.0 + 1/1M * 5.0 = 0.000001 + 0.000005 = 0.000006
    expect(cost).toBe(0.000006);
  });

  it('throws on negative tokens', () => {
    expect(() =>
      calculateCost({ inputTokens: -1, cachedInputTokens: 0, outputTokens: 0 }, HAIKU_4_5_PRICING),
    ).toThrow(/negative/);
  });

  it('throws when cached exceeds input', () => {
    expect(() =>
      calculateCost({ inputTokens: 100, cachedInputTokens: 200, outputTokens: 0 }, HAIKU_4_5_PRICING),
    ).toThrow(/cannot exceed/);
  });
});

describe('calculateCostForTier', () => {
  it('Sonnet costs more than Haiku for the same usage', () => {
    const usage = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 };
    const haiku = calculateCostForTier(usage, 'T2');
    const sonnet = calculateCostForTier(usage, 'T3');
    expect(sonnet).toBeGreaterThan(haiku);
  });
});

describe('buildModelCallRecord', () => {
  it('produces a complete record matching V005 schema', () => {
    const record = buildModelCallRecord({
      sessionId: 'session-1',
      patientId: 'patient-1',
      tier: 'T2',
      model: 'claude-haiku-4-5',
      streamed: false,
      guardrailBlocked: false,
      usage: { inputTokens: 1840, cachedInputTokens: 1420, outputTokens: 28 },
      latencyMs: 612,
      inferenceRegion: 'ap-southeast-1',
      escalationReason: null,
    });

    expect(record).toEqual({
      sessionId: 'session-1',
      patientId: 'patient-1',
      tier: 'T2',
      model: 'claude-haiku-4-5',
      streamed: false,
      guardrailBlocked: false,
      inputTokens: 1840,
      cachedInputTokens: 1420,
      outputTokens: 28,
      latencyMs: 612,
      inferenceRegion: 'ap-southeast-1',
      escalationReason: null,
      costUsd: 0.000702,
    });
  });

  it('captures escalation reason for T3 records', () => {
    const record = buildModelCallRecord({
      sessionId: 'session-1',
      patientId: 'patient-1',
      tier: 'T3',
      model: 'claude-sonnet-4-x',
      streamed: true,
      guardrailBlocked: false,
      usage: { inputTokens: 2100, cachedInputTokens: 1420, outputTokens: 85 },
      latencyMs: 1842,
      inferenceRegion: 'ap-southeast-1',
      escalationReason: 'emergency_keyword',
    });
    expect(record.tier).toBe('T3');
    expect(record.escalationReason).toBe('emergency_keyword');
    expect(record.streamed).toBe(true);
  });

  it('captures guardrail block flag', () => {
    const record = buildModelCallRecord({
      sessionId: 'session-1',
      patientId: 'patient-1',
      tier: 'T2',
      model: 'claude-haiku-4-5',
      streamed: false,
      guardrailBlocked: true,
      usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 0 },
      latencyMs: 80,
      inferenceRegion: 'ap-southeast-1',
      escalationReason: null,
    });
    expect(record.guardrailBlocked).toBe(true);
  });
});

describe('cacheHitRate', () => {
  it('zero on empty input', () => {
    expect(cacheHitRate({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it('zero on no cache hits', () => {
    expect(cacheHitRate({ inputTokens: 1000, cachedInputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it('one on full cache hit', () => {
    expect(cacheHitRate({ inputTokens: 1000, cachedInputTokens: 1000, outputTokens: 0 })).toBe(1);
  });

  it('returns the expected fraction', () => {
    expect(cacheHitRate({ inputTokens: 1000, cachedInputTokens: 800, outputTokens: 0 })).toBe(0.8);
  });
});

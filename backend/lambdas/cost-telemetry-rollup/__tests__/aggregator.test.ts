import {
  aggregate,
  yesterdayUtc,
  dayRangeUtc,
  ModelCallRow,
} from '../src/aggregator';

function row(overrides: Partial<ModelCallRow> = {}): ModelCallRow {
  return {
    patientId: 'patient-1',
    tier: 'T2',
    inputTokens: 100,
    cachedInputTokens: 80,
    outputTokens: 20,
    costUsd: 0.001,
    ...overrides,
  };
}

describe('aggregate', () => {
  it('returns empty array for empty input', () => {
    expect(aggregate([], '2026-05-01')).toEqual([]);
  });

  it('aggregates a single row into a single output row', () => {
    const result = aggregate([row()], '2026-05-01');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      patientId: 'patient-1',
      day: '2026-05-01',
      haikuCalls: 1,
      sonnetCalls: 0,
      visionHaikuCalls: 0,
      visionSonnetCalls: 0,
      totalInputTokens: 100,
      totalCachedInputTokens: 80,
      totalOutputTokens: 20,
      totalCostUsd: 0.001,
    });
  });

  it('sums multiple rows for the same patient', () => {
    const rows = [
      row({ tier: 'T2', inputTokens: 1000, cachedInputTokens: 800, outputTokens: 50, costUsd: 0.005 }),
      row({ tier: 'T3', inputTokens: 2000, cachedInputTokens: 1500, outputTokens: 100, costUsd: 0.05 }),
      row({ tier: 'T2', inputTokens: 500, cachedInputTokens: 400, outputTokens: 25, costUsd: 0.0025 }),
    ];
    const result = aggregate(rows, '2026-05-01');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      patientId: 'patient-1',
      haikuCalls: 2,
      sonnetCalls: 1,
      totalInputTokens: 3500,
      totalCachedInputTokens: 2700,
      totalOutputTokens: 175,
      totalCostUsd: 0.0575,
    });
  });

  it('separates aggregates by patient', () => {
    const rows = [
      row({ patientId: 'patient-1', tier: 'T2' }),
      row({ patientId: 'patient-2', tier: 'T3' }),
      row({ patientId: 'patient-1', tier: 'T2' }),
    ];
    const result = aggregate(rows, '2026-05-01');
    expect(result).toHaveLength(2);
    const p1 = result.find((r) => r.patientId === 'patient-1');
    const p2 = result.find((r) => r.patientId === 'patient-2');
    expect(p1!.haikuCalls).toBe(2);
    expect(p1!.sonnetCalls).toBe(0);
    expect(p2!.haikuCalls).toBe(0);
    expect(p2!.sonnetCalls).toBe(1);
  });

  it('counts each tier into its own bucket', () => {
    const rows = [
      row({ tier: 'T2' }),
      row({ tier: 'T3' }),
      row({ tier: 'T2_VISION' }),
      row({ tier: 'T3_VISION' }),
      row({ tier: 'T3_VISION' }),
    ];
    const result = aggregate(rows, '2026-05-01');
    expect(result[0]).toMatchObject({
      haikuCalls: 1,
      sonnetCalls: 1,
      visionHaikuCalls: 1,
      visionSonnetCalls: 2,
    });
  });

  it('rounds totalCostUsd to 4 decimal places', () => {
    const rows = [
      row({ costUsd: 0.000123 }),
      row({ costUsd: 0.000456 }),
      row({ costUsd: 0.000789 }),
    ];
    const result = aggregate(rows, '2026-05-01');
    // sum = 0.001368 → round to 4dp = 0.0014
    expect(result[0].totalCostUsd).toBe(0.0014);
  });

  it('preserves precision with many small costs', () => {
    // 100 calls × $0.000702 each = $0.0702
    const rows = Array.from({ length: 100 }, () => row({ costUsd: 0.000702 }));
    const result = aggregate(rows, '2026-05-01');
    expect(result[0].totalCostUsd).toBeCloseTo(0.0702, 4);
  });

  it('attaches the supplied day to every output row', () => {
    const rows = [
      row({ patientId: 'a' }),
      row({ patientId: 'b' }),
    ];
    const result = aggregate(rows, '2026-05-01');
    expect(result.every((r) => r.day === '2026-05-01')).toBe(true);
  });

  it('output is sorted by patientId for determinism', () => {
    const rows = [
      row({ patientId: 'zzz' }),
      row({ patientId: 'aaa' }),
      row({ patientId: 'mmm' }),
    ];
    const result = aggregate(rows, '2026-05-01');
    expect(result.map((r) => r.patientId)).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('throws on malformed day', () => {
    expect(() => aggregate([], '2026-5-1')).toThrow(/YYYY-MM-DD/);
    expect(() => aggregate([], 'invalid')).toThrow();
    expect(() => aggregate([], '')).toThrow();
  });
});

describe('yesterdayUtc', () => {
  it('returns yesterday in YYYY-MM-DD UTC', () => {
    expect(yesterdayUtc(new Date('2026-05-02T05:00:00Z'))).toBe('2026-05-01');
  });

  it('handles month boundary', () => {
    expect(yesterdayUtc(new Date('2026-06-01T01:00:00Z'))).toBe('2026-05-31');
  });

  it('handles year boundary', () => {
    expect(yesterdayUtc(new Date('2027-01-01T00:30:00Z'))).toBe('2026-12-31');
  });

  it('handles day boundary at midnight UTC', () => {
    expect(yesterdayUtc(new Date('2026-05-02T00:00:00.001Z'))).toBe('2026-05-01');
  });
});

describe('dayRangeUtc', () => {
  it('produces a 24-hour [start, end) range', () => {
    const { start, end } = dayRangeUtc('2026-05-01');
    expect(start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-02T00:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('throws on malformed day', () => {
    expect(() => dayRangeUtc('2026-5-1')).toThrow(/YYYY-MM-DD/);
  });
});

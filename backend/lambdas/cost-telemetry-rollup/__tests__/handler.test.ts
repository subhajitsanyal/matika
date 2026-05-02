import { handleRollup, HandlerDeps } from '../src/handler';
import type { ModelCallRow, AggregatedRow } from '../src/aggregator';

interface CapturedCalls {
  reads: Array<{ start: Date; end: Date }>;
  writes: AggregatedRow[][];
}

function makeDeps(opts: { rows?: ModelCallRow[]; now?: Date } = {}): {
  deps: HandlerDeps;
  calls: CapturedCalls;
} {
  const calls: CapturedCalls = { reads: [], writes: [] };
  const deps: HandlerDeps = {
    reader: {
      async readModelCalls(start, end) {
        calls.reads.push({ start, end });
        return opts.rows ?? [];
      },
    },
    writer: {
      async upsertCostTelemetry(rows) {
        calls.writes.push(rows);
      },
    },
    now: opts.now ? () => opts.now! : undefined,
  };
  return { deps, calls };
}

describe('handleRollup', () => {
  it('defaults to "yesterday UTC" when rollupDate not provided', async () => {
    const { deps, calls } = makeDeps({ now: new Date('2026-05-02T05:00:00Z') });
    const result = await handleRollup({}, deps);

    expect(result.day).toBe('2026-05-01');
    expect(calls.reads).toHaveLength(1);
    expect(calls.reads[0].start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(calls.reads[0].end.toISOString()).toBe('2026-05-02T00:00:00.000Z');
  });

  it('honors explicit rollupDate', async () => {
    const { deps, calls } = makeDeps({ now: new Date('2026-05-02T05:00:00Z') });
    const result = await handleRollup({ rollupDate: '2026-04-15' }, deps);

    expect(result.day).toBe('2026-04-15');
    expect(calls.reads[0].start.toISOString()).toBe('2026-04-15T00:00:00.000Z');
    expect(calls.reads[0].end.toISOString()).toBe('2026-04-16T00:00:00.000Z');
  });

  it('aggregates rows and writes them', async () => {
    const rows: ModelCallRow[] = [
      {
        patientId: 'p1',
        tier: 'T2',
        inputTokens: 1840,
        cachedInputTokens: 1420,
        outputTokens: 28,
        costUsd: 0.000702,
      },
      {
        patientId: 'p1',
        tier: 'T3',
        inputTokens: 2100,
        cachedInputTokens: 1420,
        outputTokens: 85,
        costUsd: 0.003741,
      },
      {
        patientId: 'p2',
        tier: 'T2',
        inputTokens: 1500,
        cachedInputTokens: 1200,
        outputTokens: 22,
        costUsd: 0.000420,
      },
    ];
    const { deps, calls } = makeDeps({ rows, now: new Date('2026-05-02T05:00:00Z') });
    const result = await handleRollup({}, deps);

    expect(calls.writes).toHaveLength(1);
    const aggregated = calls.writes[0];
    expect(aggregated).toHaveLength(2); // 2 patients

    const p1 = aggregated.find((r) => r.patientId === 'p1');
    expect(p1).toMatchObject({
      day: '2026-05-01',
      haikuCalls: 1,
      sonnetCalls: 1,
      totalInputTokens: 3940,
    });
    expect(p1!.totalCostUsd).toBeCloseTo(0.004443, 4);

    const p2 = aggregated.find((r) => r.patientId === 'p2');
    expect(p2!.haikuCalls).toBe(1);

    expect(result.day).toBe('2026-05-01');
    expect(result.modelCallRowsRead).toBe(3);
    expect(result.patientsAggregated).toBe(2);
    // Aggregator rounds each patient's total to 4dp (matching NUMERIC(10,4)
    // storage), then sumTotalCost adds the rounded values:
    //   p1 = 0.000702 + 0.003741 = 0.004443 → rounded to 0.0044
    //   p2 = 0.000420 → rounded to 0.0004
    //   sum = 0.0048
    expect(result.totalCostUsd).toBe(0.0048);
  });

  it('handles empty days (no model_call rows)', async () => {
    const { deps, calls } = makeDeps({ rows: [], now: new Date('2026-05-02T05:00:00Z') });
    const result = await handleRollup({}, deps);

    expect(result.modelCallRowsRead).toBe(0);
    expect(result.patientsAggregated).toBe(0);
    expect(result.totalCostUsd).toBe(0);
    // Writer is called with empty array; the writer itself short-circuits.
    expect(calls.writes).toHaveLength(1);
    expect(calls.writes[0]).toEqual([]);
  });

  it('rounds totalCostUsd to 4dp in result summary', async () => {
    const rows: ModelCallRow[] = [
      {
        patientId: 'p1',
        tier: 'T2',
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 5,
        costUsd: 0.123456,
      },
      {
        patientId: 'p2',
        tier: 'T2',
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 5,
        costUsd: 0.123444,
      },
    ];
    const { deps } = makeDeps({ rows });
    const result = await handleRollup({ rollupDate: '2026-05-01' }, deps);
    // Sum: 0.246900, 4dp = 0.2469
    expect(result.totalCostUsd).toBe(0.2469);
  });

  it('throws on malformed rollupDate', async () => {
    const { deps } = makeDeps();
    await expect(handleRollup({ rollupDate: 'not-a-date' }, deps)).rejects.toThrow(/YYYY-MM-DD/);
  });
});

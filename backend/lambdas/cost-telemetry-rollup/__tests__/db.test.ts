import { PgClient, PgRollupReader, PgRollupWriter } from '../src/db';
import type { AggregatedRow } from '../src/aggregator';

interface CallLog {
  text: string;
  params?: unknown[];
}

function stubClient(rowsByQuery: Map<string, unknown[]>): { client: PgClient; calls: CallLog[] } {
  const calls: CallLog[] = [];
  const client: PgClient = {
    async query<R>(text: string, params?: unknown[]) {
      calls.push({ text, params });
      let matched: unknown[] = [];
      for (const [key, rows] of rowsByQuery) {
        if (text.includes(key)) {
          matched = rows;
          break;
        }
      }
      return { rows: matched as R[] };
    },
  };
  return { client, calls };
}

describe('PgRollupReader', () => {
  it('queries model_call with the supplied date range', async () => {
    const rows = new Map<string, unknown[]>();
    rows.set('FROM model_call', [
      {
        patient_id: 'p1',
        tier: 'T2',
        input_tokens: 1840,
        cached_input_tokens: 1420,
        output_tokens: 28,
        cost_usd: '0.000702',
      },
    ]);
    const { client, calls } = stubClient(rows);
    const reader = new PgRollupReader(client);

    const start = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-05-02T00:00:00Z');
    const result = await reader.readModelCalls(start, end);

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('FROM model_call');
    expect(calls[0].text).toContain('created_at >= $1 AND created_at < $2');
    expect(calls[0].params).toEqual([start.toISOString(), end.toISOString()]);
    expect(result).toEqual([
      {
        patientId: 'p1',
        tier: 'T2',
        inputTokens: 1840,
        cachedInputTokens: 1420,
        outputTokens: 28,
        costUsd: 0.000702,
      },
    ]);
  });

  it('parses NUMERIC cost_usd from string (node-postgres default)', async () => {
    const rows = new Map<string, unknown[]>();
    rows.set('FROM model_call', [
      {
        patient_id: 'p1',
        tier: 'T3',
        input_tokens: 2100,
        cached_input_tokens: 1420,
        output_tokens: 85,
        cost_usd: '0.003741',
      },
    ]);
    const { client } = stubClient(rows);
    const result = await new PgRollupReader(client).readModelCalls(
      new Date(),
      new Date(),
    );
    expect(result[0].costUsd).toBe(0.003741);
    expect(typeof result[0].costUsd).toBe('number');
  });

  it('handles cost_usd already as number (numeric parser configured)', async () => {
    const rows = new Map<string, unknown[]>();
    rows.set('FROM model_call', [
      {
        patient_id: 'p1',
        tier: 'T2',
        input_tokens: 100,
        cached_input_tokens: 80,
        output_tokens: 5,
        cost_usd: 0.000123,
      },
    ]);
    const { client } = stubClient(rows);
    const result = await new PgRollupReader(client).readModelCalls(
      new Date(),
      new Date(),
    );
    expect(result[0].costUsd).toBe(0.000123);
  });

  it('returns empty array when no rows', async () => {
    const rows = new Map<string, unknown[]>();
    rows.set('FROM model_call', []);
    const { client } = stubClient(rows);
    const result = await new PgRollupReader(client).readModelCalls(
      new Date(),
      new Date(),
    );
    expect(result).toEqual([]);
  });
});

describe('PgRollupWriter', () => {
  function makeRow(overrides: Partial<AggregatedRow> = {}): AggregatedRow {
    return {
      patientId: 'p1',
      day: '2026-05-01',
      haikuCalls: 10,
      sonnetCalls: 1,
      visionHaikuCalls: 0,
      visionSonnetCalls: 0,
      totalInputTokens: 18400,
      totalCachedInputTokens: 14200,
      totalOutputTokens: 280,
      totalCostUsd: 0.0085,
      ...overrides,
    };
  }

  it('issues no SQL when given an empty array', async () => {
    const { client, calls } = stubClient(new Map());
    await new PgRollupWriter(client).upsertCostTelemetry([]);
    expect(calls).toEqual([]);
  });

  it('issues one INSERT...ON CONFLICT per row', async () => {
    const { client, calls } = stubClient(new Map());
    await new PgRollupWriter(client).upsertCostTelemetry([makeRow({ patientId: 'p1' }), makeRow({ patientId: 'p2' })]);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.text).toContain('INSERT INTO cost_telemetry');
      expect(c.text).toContain('ON CONFLICT (patient_id, day) DO UPDATE');
    }
  });

  it('does NOT touch ocr_local_calls in the ON CONFLICT clause', async () => {
    const { client, calls } = stubClient(new Map());
    await new PgRollupWriter(client).upsertCostTelemetry([makeRow()]);
    const sql = calls[0].text;
    // Insert section may not even mention ocr_local_calls (default 0); the
    // critical thing is the UPDATE clause must NOT overwrite it.
    const updateClause = sql.split('DO UPDATE SET')[1] ?? '';
    expect(updateClause).not.toContain('ocr_local_calls');
  });

  it('passes parameters in the order columns are declared', async () => {
    const { client, calls } = stubClient(new Map());
    const row = makeRow();
    await new PgRollupWriter(client).upsertCostTelemetry([row]);
    expect(calls[0].params).toEqual([
      row.patientId,
      row.day,
      row.haikuCalls,
      row.sonnetCalls,
      row.visionHaikuCalls,
      row.visionSonnetCalls,
      row.totalInputTokens,
      row.totalCachedInputTokens,
      row.totalOutputTokens,
      row.totalCostUsd,
    ]);
  });

  it('updates updated_at on conflict', async () => {
    const { client, calls } = stubClient(new Map());
    await new PgRollupWriter(client).upsertCostTelemetry([makeRow()]);
    const sql = calls[0].text;
    expect(sql).toContain('updated_at = NOW()');
  });
});

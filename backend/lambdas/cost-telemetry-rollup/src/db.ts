// Postgres-backed reader/writer for the cost-telemetry rollup.
//
// Owned by backend. Uses the same minimal PgClient interface as
// backend/lambdas/bedrock-router/src/db.ts so the same stub fits.

import type { ModelCallRow, AggregatedRow, Tier } from './aggregator';

export interface PgClient {
  query<R = unknown>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface RollupReader {
  readModelCalls(start: Date, end: Date): Promise<ModelCallRow[]>;
}

export interface RollupWriter {
  upsertCostTelemetry(rows: AggregatedRow[]): Promise<void>;
}

// node-postgres returns NUMERIC columns as strings to avoid float precision
// loss. We parse to number at the boundary; the aggregator uses native doubles
// which are sufficient for pilot-scale sums (< $10K/day).
interface ModelCallRowRaw {
  patient_id: string;
  tier: Tier;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  cost_usd: string | number;
}

export class PgRollupReader implements RollupReader {
  constructor(private client: PgClient) {}

  async readModelCalls(start: Date, end: Date): Promise<ModelCallRow[]> {
    const result = await this.client.query<ModelCallRowRaw>(
      `SELECT patient_id, tier, input_tokens, cached_input_tokens, output_tokens, cost_usd
       FROM model_call
       WHERE created_at >= $1 AND created_at < $2`,
      [start.toISOString(), end.toISOString()],
    );
    return result.rows.map((r) => ({
      patientId: r.patient_id,
      tier: r.tier,
      inputTokens: r.input_tokens,
      cachedInputTokens: r.cached_input_tokens,
      outputTokens: r.output_tokens,
      costUsd: typeof r.cost_usd === 'string' ? parseFloat(r.cost_usd) : r.cost_usd,
    }));
  }
}

export class PgRollupWriter implements RollupWriter {
  constructor(private client: PgClient) {}

  async upsertCostTelemetry(rows: AggregatedRow[]): Promise<void> {
    if (rows.length === 0) return;

    // One INSERT...ON CONFLICT per row keeps the SQL simple and the parameter
    // list bounded. For pilot scale (~10 patients) this is one-digit
    // milliseconds; revisit batching when patient count crosses ~1000.
    //
    // Critical: ocr_local_calls is intentionally LEFT UNTOUCHED on conflict
    // because a separate client-telemetry endpoint (Increment 8 / future) is
    // expected to populate it. We only update the columns we computed here.
    for (const row of rows) {
      await this.client.query(
        `INSERT INTO cost_telemetry (
           patient_id, day,
           haiku_calls, sonnet_calls,
           vision_haiku_calls, vision_sonnet_calls,
           total_input_tokens, total_cached_input_tokens, total_output_tokens,
           total_cost_usd, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (patient_id, day) DO UPDATE SET
           haiku_calls = EXCLUDED.haiku_calls,
           sonnet_calls = EXCLUDED.sonnet_calls,
           vision_haiku_calls = EXCLUDED.vision_haiku_calls,
           vision_sonnet_calls = EXCLUDED.vision_sonnet_calls,
           total_input_tokens = EXCLUDED.total_input_tokens,
           total_cached_input_tokens = EXCLUDED.total_cached_input_tokens,
           total_output_tokens = EXCLUDED.total_output_tokens,
           total_cost_usd = EXCLUDED.total_cost_usd,
           updated_at = NOW()`,
        [
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
        ],
      );
    }
  }
}

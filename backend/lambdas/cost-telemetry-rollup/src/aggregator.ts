// Pure aggregation logic for cost_telemetry rollup.
//
// Closes T-V2-108 (rollup half). The handler reads a day's model_call rows
// from RDS, hands them to this aggregator, and writes the resulting
// AggregatedRow[] back via UPSERT.
//
// Owned by backend per AGENTS.md.

export type Tier = 'T2' | 'T3' | 'T2_VISION' | 'T3_VISION';

export interface ModelCallRow {
  patientId: string;
  tier: Tier;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AggregatedRow {
  patientId: string;
  day: string; // ISO date YYYY-MM-DD
  haikuCalls: number;
  sonnetCalls: number;
  visionHaikuCalls: number;
  visionSonnetCalls: number;
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number; // rounded to 4 decimal places (NUMERIC(10,4))
}

interface MutableAggregate {
  patientId: string;
  haikuCalls: number;
  sonnetCalls: number;
  visionHaikuCalls: number;
  visionSonnetCalls: number;
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

// Group rows by patient_id, accumulate counts/sums, return finalized
// AggregatedRow[] tagged with the supplied `day`. Output order is sorted by
// patientId for determinism in tests and stable diffs in audit dumps.
export function aggregate(rows: ModelCallRow[], day: string): AggregatedRow[] {
  validateDay(day);
  const byPatient = new Map<string, MutableAggregate>();

  for (const row of rows) {
    let agg = byPatient.get(row.patientId);
    if (!agg) {
      agg = {
        patientId: row.patientId,
        haikuCalls: 0,
        sonnetCalls: 0,
        visionHaikuCalls: 0,
        visionSonnetCalls: 0,
        totalInputTokens: 0,
        totalCachedInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      };
      byPatient.set(row.patientId, agg);
    }
    incrementTier(agg, row.tier);
    agg.totalInputTokens += row.inputTokens;
    agg.totalCachedInputTokens += row.cachedInputTokens;
    agg.totalOutputTokens += row.outputTokens;
    agg.totalCostUsd += row.costUsd;
  }

  const sortedKeys = [...byPatient.keys()].sort();
  return sortedKeys.map((patientId) => {
    const a = byPatient.get(patientId)!;
    return {
      patientId: a.patientId,
      day,
      haikuCalls: a.haikuCalls,
      sonnetCalls: a.sonnetCalls,
      visionHaikuCalls: a.visionHaikuCalls,
      visionSonnetCalls: a.visionSonnetCalls,
      totalInputTokens: a.totalInputTokens,
      totalCachedInputTokens: a.totalCachedInputTokens,
      totalOutputTokens: a.totalOutputTokens,
      totalCostUsd: roundToFourDp(a.totalCostUsd),
    };
  });
}

function incrementTier(agg: MutableAggregate, tier: Tier): void {
  switch (tier) {
    case 'T2':
      agg.haikuCalls++;
      break;
    case 'T3':
      agg.sonnetCalls++;
      break;
    case 'T2_VISION':
      agg.visionHaikuCalls++;
      break;
    case 'T3_VISION':
      agg.visionSonnetCalls++;
      break;
    default: {
      const _exhaustive: never = tier;
      throw new Error(`Unknown tier: ${String(_exhaustive)}`);
    }
  }
}

function roundToFourDp(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function validateDay(day: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`day must be YYYY-MM-DD, got "${day}"`);
  }
}

// Helper: compute "yesterday in UTC" as YYYY-MM-DD given a `now` clock.
// Used by the handler when no explicit rollupDate is provided.
export function yesterdayUtc(now: Date = new Date()): string {
  const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yyyy = y.getUTCFullYear();
  const mm = String(y.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(y.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Helper: build the [start, end) UTC timestamp range for a given day.
export function dayRangeUtc(day: string): { start: Date; end: Date } {
  validateDay(day);
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

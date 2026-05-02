// Cost-telemetry rollup Lambda handler.
//
// Triggered by EventBridge daily (scheduled cron — see Terraform module
// `monitoring` per AGENTS.md / devops). Reads the previous UTC day's
// model_call rows, aggregates per (patient, day), upserts cost_telemetry.
//
// Closes T-V2-108. Owned by backend.

import { aggregate, dayRangeUtc, yesterdayUtc, AggregatedRow } from './aggregator';
import type { RollupReader, RollupWriter } from './db';

export interface RollupEvent {
  // Optional override for backfill or replay. Defaults to "yesterday UTC"
  // computed at handler invocation. ISO date format YYYY-MM-DD.
  rollupDate?: string;
}

export interface RollupResult {
  day: string;
  modelCallRowsRead: number;
  patientsAggregated: number;
  totalCostUsd: number;
}

export interface HandlerDeps {
  reader: RollupReader;
  writer: RollupWriter;
  // Pluggable clock — defaults to system Date for production.
  now?: () => Date;
}

export async function handleRollup(
  event: RollupEvent,
  deps: HandlerDeps,
): Promise<RollupResult> {
  const day = event.rollupDate ?? yesterdayUtc(deps.now?.());
  const { start, end } = dayRangeUtc(day);

  const rows = await deps.reader.readModelCalls(start, end);
  const aggregated = aggregate(rows, day);
  await deps.writer.upsertCostTelemetry(aggregated);

  return {
    day,
    modelCallRowsRead: rows.length,
    patientsAggregated: aggregated.length,
    totalCostUsd: sumTotalCost(aggregated),
  };
}

function sumTotalCost(rows: AggregatedRow[]): number {
  const sum = rows.reduce((acc, r) => acc + r.totalCostUsd, 0);
  return Math.round(sum * 10_000) / 10_000;
}

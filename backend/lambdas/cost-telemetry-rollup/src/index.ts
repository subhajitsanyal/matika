// Lambda entry point. Constructs pg pool + reader/writer on cold start;
// reuses across warm invocations. Triggered by EventBridge daily.

import { handleRollup, RollupEvent, RollupResult, HandlerDeps } from './handler';
import { PgRollupReader, PgRollupWriter } from './db';
import { getPgPool } from './db_secret';

let _deps: HandlerDeps | null = null;

async function buildDeps(): Promise<HandlerDeps> {
  if (_deps) return _deps;
  const pool = await getPgPool();
  _deps = {
    reader: new PgRollupReader(pool),
    writer: new PgRollupWriter(pool),
  };
  return _deps;
}

// EventBridge passes a CloudWatch Events shape to scheduled-rule targets;
// optional `rollupDate` accepted via a manual invoke for backfill.
export async function handler(event: unknown): Promise<RollupResult> {
  const rollupEvent: RollupEvent = isRollupEvent(event) ? event : {};
  return handleRollup(rollupEvent, await buildDeps());
}

function isRollupEvent(input: unknown): input is RollupEvent {
  return (
    typeof input === 'object' &&
    input !== null &&
    (typeof (input as RollupEvent).rollupDate === 'string' ||
      (input as RollupEvent).rollupDate === undefined)
  );
}

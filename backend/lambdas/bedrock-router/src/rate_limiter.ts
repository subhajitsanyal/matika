// Per-patient rate limit enforcement.
//
// Spec §11.6:
// - Soft cap: 100 model calls per patient per UTC day → warning emitted in
//   response telemetry; client can show a banner.
// - Hard cap: 500 model calls per patient per UTC day → 429 + caregiver
//   alert; session locked until the next UTC day rolls over.
//
// Rate-limit window is UTC day. Counts ALL model_call rows (conversation +
// summarizer + future internal callers) — fair: those calls cost money too,
// and a runaway long session could blow the budget via summarizer alone.
//
// Owned by backend.

import type { PgClient } from './db';

export interface RateLimitConfig {
  softLimit: number;
  hardLimit: number;
}

export interface RateLimitDecision {
  allowed: boolean; // false when hard cap reached; handler must 429
  softCapReached: boolean; // surfaced to client via response telemetry
  callsToday: number;
  remainingHard: number; // max(0, hardLimit - callsToday)
}

export interface RateLimiter {
  check(patientId: string): Promise<RateLimitDecision>;
}

export class PgRateLimiter implements RateLimiter {
  constructor(
    private client: PgClient,
    private config: RateLimitConfig,
  ) {
    if (config.softLimit < 0 || config.hardLimit < 0) {
      throw new Error('Rate limits cannot be negative');
    }
    if (config.softLimit > config.hardLimit) {
      throw new Error(
        `softLimit (${config.softLimit}) cannot exceed hardLimit (${config.hardLimit})`,
      );
    }
  }

  async check(patientId: string): Promise<RateLimitDecision> {
    // Use date_trunc on the server side so the boundary always matches the
    // DB's UTC clock, not the Lambda runtime's clock. Avoids drift on
    // Lambda cold-starts that span midnight.
    const result = await this.client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM model_call
       WHERE patient_id = $1
         AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
      [patientId],
    );
    const countStr = result.rows[0]?.count ?? '0';
    const callsToday = parseInt(countStr, 10);
    return {
      allowed: callsToday < this.config.hardLimit,
      softCapReached: callsToday >= this.config.softLimit,
      callsToday,
      remainingHard: Math.max(0, this.config.hardLimit - callsToday),
    };
  }
}

// Pure helper used by handler tests and as a defensive fallback.
export function decideFromCount(
  callsToday: number,
  config: RateLimitConfig,
): RateLimitDecision {
  return {
    allowed: callsToday < config.hardLimit,
    softCapReached: callsToday >= config.softLimit,
    callsToday,
    remainingHard: Math.max(0, config.hardLimit - callsToday),
  };
}

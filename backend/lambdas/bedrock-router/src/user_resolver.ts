// Resolve a Cognito sub to the internal users.id UUID.
//
// Used for caregiver attribution (T-V2-303): when a caregiver_onboarding
// session writes to parameter_configs, the threshold_set_by FK references
// users.id, but the API surface only sees the caregiver's Cognito sub
// (their JWT claim). This helper bridges the two.
//
// Pattern mirrors bedrock-vision/src/patient_resolver.ts. Kept local to
// bedrock-router to avoid cross-Lambda coupling — the helper is small.

import type { Pool } from 'pg';

export interface UserResolver {
  resolveInternalId(cognitoSub: string): Promise<string | null>;
}

export class PgUserResolver implements UserResolver {
  // Lambdas typically see <100 unique users per warm-instance lifetime,
  // so an unbounded Map is fine here. Swap to LRU only if patterns change.
  private readonly cache = new Map<string, string | null>();

  constructor(private readonly pool: Pool) {}

  async resolveInternalId(cognitoSub: string): Promise<string | null> {
    if (this.cache.has(cognitoSub)) {
      return this.cache.get(cognitoSub) ?? null;
    }
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
      [cognitoSub],
    );
    // Cache misses too — a malicious or stale Cognito sub shouldn't keep
    // hitting the DB. The cache lives only for the warm-instance lifetime.
    const id = rows.length > 0 ? rows[0].id : null;
    this.cache.set(cognitoSub, id);
    return id;
  }
}

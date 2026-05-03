// Resolve a Cognito sub to the internal patients.id UUID.
//
// Why this exists: the API surface accepts patientId as the Cognito sub
// (clients only know their JWT claims), but every FK in the DB
// — model_call.patient_id, alerts.patient_id, observations.patient_id —
// references patients.id, which is a separate UUID generated when the
// post-confirmation Cognito trigger creates the user/patient pair.
//
// bedrock-router does the same resolution via its full PgPatientContextLoader
// (which also fetches medical conditions, language, age, etc.). Vision
// doesn't need any of that context — only the FK target — so this leaner
// resolver caches the cognito_sub → internal-id mapping in process memory.

import type { Pool } from 'pg';

export interface PatientResolver {
  resolveInternalId(cognitoSub: string): Promise<string>;
}

export class PgPatientResolver implements PatientResolver {
  // Lambdas typically see <100 unique patients per warm-instance lifetime,
  // so an unbounded Map is fine. If that ever changes, swap to LRU.
  private readonly cache = new Map<string, string>();

  constructor(private readonly pool: Pool) {}

  async resolveInternalId(cognitoSub: string): Promise<string> {
    const cached = this.cache.get(cognitoSub);
    if (cached) return cached;

    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT p.id
         FROM patients p
         JOIN users u ON u.id = p.user_id
        WHERE u.cognito_sub = $1
        LIMIT 1`,
      [cognitoSub],
    );
    if (rows.length === 0) {
      throw new Error(`No patient found for cognito_sub ${cognitoSub}`);
    }
    const id = rows[0].id;
    this.cache.set(cognitoSub, id);
    return id;
  }
}

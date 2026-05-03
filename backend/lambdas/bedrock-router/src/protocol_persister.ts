// Persists a ProtocolDraft to parameter_configs + patient_topics.
// All writes happen in a single transaction so a partial failure leaves
// the patient's existing protocol unchanged.
//
// Tables touched:
//   parameter_configs  — one row per monitored parameter (upsert on
//                        unique (patient_id, parameter_name))
//   patient_topics     — one row per discussed topic (upsert on
//                        unique (patient_id, topic_id))
//
// NOT touched (deferred):
//   reminder_configs   — v1-era table keyed on the vital_type ENUM. v2's
//                        parameter_configs already carries frequency_days
//                        and daily_deadline; the reminder-sender Lambda
//                        will be moved to read from parameter_configs in
//                        a separate task.
//   thresholds         — v1-era separate table. v2 reads thresholds from
//                        parameter_configs.threshold_min[1] / [2].

import type { Pool } from 'pg';

import type { ProtocolDraft, ProtocolTopic, ProtocolParameter } from './protocol_extractor';

export interface ProtocolPersistResult {
  parametersConfigured: number;
  topicsConfigured: number;
  // Topics in the draft that didn't match any row in the `topics` lookup.
  // Logged for diagnostics; not a hard failure.
  topicsSkipped: string[];
}

export interface ProtocolPersister {
  persist(
    patientId: string,
    // The caregiver's users.id, persisted on parameter_configs.threshold_set_by.
    // Pass null when the caller can't reliably identify the caregiver — bedrock-router
    // doesn't yet receive caregiver identity in the TurnRequest, so today this is
    // always null for caregiver-onboarding sessions. Wiring up persona-link
    // resolution (caregiver cognito_sub + target patient → caregiver user_id)
    // is a separate task. See AGENTS.md / plan T-V2-303.
    caregiverUserId: string | null,
    draft: ProtocolDraft,
  ): Promise<ProtocolPersistResult>;
}

export class PgProtocolPersister implements ProtocolPersister {
  constructor(private readonly pool: Pool) {}

  async persist(
    patientId: string,
    caregiverUserId: string | null,
    draft: ProtocolDraft,
  ): Promise<ProtocolPersistResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      let parametersConfigured = 0;
      for (const p of draft.parameters) {
        await this.upsertParameterConfig(client, patientId, caregiverUserId, p);
        parametersConfigured++;
      }

      const topicsSkipped: string[] = [];
      let topicsConfigured = 0;
      for (const t of draft.topics) {
        const ok = await this.upsertPatientTopic(client, patientId, t);
        if (ok) {
          topicsConfigured++;
        } else {
          topicsSkipped.push(t.topicName);
        }
      }

      await client.query('COMMIT');
      return { parametersConfigured, topicsConfigured, topicsSkipped };
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback failures — surface the original error.
      }
      throw e;
    } finally {
      client.release();
    }
  }

  private async upsertParameterConfig(
    client: PoolClientLike,
    patientId: string,
    caregiverUserId: string | null,
    p: ProtocolParameter,
  ): Promise<void> {
    // parameter_configs uses TEXT[] / NUMERIC[] arrays for loinc_codes,
    // threshold_min, threshold_max because some parameters (BP) have
    // paired entries. We write single-element arrays here; bedrock-router's
    // reader takes [1] off them.
    await client.query(
      `INSERT INTO parameter_configs (
         patient_id, parameter_name, display_name, loinc_codes, unit,
         frequency_days, daily_deadline, timezone,
         threshold_min, threshold_max, threshold_set_by, active
       )
       VALUES (
         $1, $2, $3, ARRAY[$4]::text[], $5,
         $6, $7::time, $8,
         $9, $10, $11, true
       )
       ON CONFLICT (patient_id, parameter_name) DO UPDATE SET
         display_name      = EXCLUDED.display_name,
         loinc_codes       = EXCLUDED.loinc_codes,
         unit              = EXCLUDED.unit,
         frequency_days    = EXCLUDED.frequency_days,
         daily_deadline    = EXCLUDED.daily_deadline,
         timezone          = EXCLUDED.timezone,
         threshold_min     = EXCLUDED.threshold_min,
         threshold_max     = EXCLUDED.threshold_max,
         threshold_set_by  = EXCLUDED.threshold_set_by,
         active            = true,
         updated_at        = NOW()`,
      [
        patientId,
        p.parameterName,
        p.displayName,
        p.loincCode,
        p.unit,
        p.frequencyDays,
        p.dailyDeadline, // 'HH:MM' — Postgres TIME accepts this directly
        p.timezone,
        p.thresholdMin === null ? null : [p.thresholdMin],
        p.thresholdMax === null ? null : [p.thresholdMax],
        caregiverUserId,
      ],
    );
  }

  // Returns true if the topic existed in the lookup and was upserted;
  // false if the topic name was unknown (caller records it as skipped).
  private async upsertPatientTopic(
    client: PoolClientLike,
    patientId: string,
    t: ProtocolTopic,
  ): Promise<boolean> {
    const lookup = await client.query<{ id: string }>(
      `SELECT id FROM topics WHERE name = $1 AND active = TRUE LIMIT 1`,
      [t.topicName],
    );
    if (lookup.rows.length === 0) {
      return false;
    }
    const topicId = lookup.rows[0].id;
    await client.query(
      `INSERT INTO patient_topics (patient_id, topic_id, status, collected_data, last_updated)
       VALUES ($1, $2, $3, $4::jsonb, NOW())
       ON CONFLICT (patient_id, topic_id) DO UPDATE SET
         status         = EXCLUDED.status,
         collected_data = EXCLUDED.collected_data,
         last_updated   = NOW()`,
      [
        patientId,
        topicId,
        t.status,
        t.collectedData === null ? null : JSON.stringify(t.collectedData),
      ],
    );
    return true;
  }
}

// Minimal subset of pg.PoolClient that we use. Tests can implement this
// with a single `query` mock without importing the pg package.
interface PoolClientLike {
  query<R = unknown>(text: string, values?: readonly unknown[]): Promise<{ rows: R[] }>;
}

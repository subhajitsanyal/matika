// Tests use a fake pg.Pool with `connect()` returning a fake client whose
// `query()` is captured for assertions. This avoids any real DB.

import type { Pool } from 'pg';
import { PgProtocolPersister } from '../src/protocol_persister';
import type { ProtocolDraft } from '../src/protocol_extractor';

interface CapturedQuery {
  text: string;
  values: readonly unknown[];
}

function makeFakePool(opts: {
  topicLookups?: Record<string, string | undefined>;
  failOn?: { sqlContains: string; error: Error };
} = {}): { pool: Pool; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];

  const fakeClient = {
    async query(text: string, values?: readonly unknown[]) {
      queries.push({ text, values: values ?? [] });
      if (opts.failOn && text.includes(opts.failOn.sqlContains)) {
        throw opts.failOn.error;
      }
      if (text.includes('SELECT id FROM topics')) {
        const name = String(values?.[0] ?? '');
        const id = (opts.topicLookups ?? {
          medications: 'topic-uuid-medications',
          conditions: 'topic-uuid-conditions',
          dietary_restrictions: 'topic-uuid-diet',
        })[name];
        return id ? { rows: [{ id }] } : { rows: [] };
      }
      return { rows: [] };
    },
    release() {
      // no-op
    },
  };

  const fakePool = {
    async connect() {
      return fakeClient;
    },
  };

  return { pool: fakePool as unknown as Pool, queries };
}

const baseDraft: ProtocolDraft = {
  parameters: [
    {
      parameterName: 'blood_pressure_systolic',
      displayName: 'Blood Pressure (Systolic)',
      loincCode: '8480-6',
      unit: 'mmHg',
      frequencyDays: 1,
      dailyDeadline: '09:00',
      timezone: 'Asia/Kolkata',
      thresholdMin: 90,
      thresholdMax: 160,
    },
  ],
  topics: [
    {
      topicName: 'medications',
      status: 'complete',
      collectedData: { summary: 'Amlodipine 5mg' },
    },
  ],
};

describe('PgProtocolPersister.persist', () => {
  it('runs BEGIN, upserts parameter and topic, then COMMITs', async () => {
    const { pool, queries } = makeFakePool();
    const persister = new PgProtocolPersister(pool);
    const result = await persister.persist('patient-internal-id', 'caregiver-id', baseDraft);

    expect(result.parametersConfigured).toBe(1);
    expect(result.topicsConfigured).toBe(1);
    expect(result.topicsSkipped).toEqual([]);

    const sqlOrder = queries.map((q) => q.text.split('\n')[0].trim());
    expect(sqlOrder[0]).toBe('BEGIN');
    expect(sqlOrder[sqlOrder.length - 1]).toBe('COMMIT');

    // parameter_configs upsert receives the right values in order
    const paramQuery = queries.find((q) => q.text.includes('INSERT INTO parameter_configs'));
    expect(paramQuery).toBeDefined();
    expect(paramQuery!.values[0]).toBe('patient-internal-id');
    expect(paramQuery!.values[1]).toBe('blood_pressure_systolic');
    expect(paramQuery!.values[3]).toBe('8480-6');
    expect(paramQuery!.values[5]).toBe(1); // frequencyDays
    expect(paramQuery!.values[6]).toBe('09:00');
    expect(paramQuery!.values[8]).toEqual([90]); // threshold_min array
    expect(paramQuery!.values[9]).toEqual([160]); // threshold_max array
    expect(paramQuery!.values[10]).toBe('caregiver-id');
  });

  it('passes null thresholds through as null arrays', async () => {
    const draft: ProtocolDraft = {
      parameters: [
        {
          ...baseDraft.parameters[0],
          thresholdMin: null,
          thresholdMax: null,
        },
      ],
      topics: [],
    };
    const { pool, queries } = makeFakePool();
    await new PgProtocolPersister(pool).persist('p', 'c', draft);
    const paramQuery = queries.find((q) => q.text.includes('INSERT INTO parameter_configs'));
    expect(paramQuery!.values[8]).toBeNull();
    expect(paramQuery!.values[9]).toBeNull();
  });

  it('passes null caregiverUserId as threshold_set_by null', async () => {
    const { pool, queries } = makeFakePool();
    await new PgProtocolPersister(pool).persist('p', null, baseDraft);
    const paramQuery = queries.find((q) => q.text.includes('INSERT INTO parameter_configs'));
    expect(paramQuery!.values[10]).toBeNull();
  });

  it('records topics with unknown name in topicsSkipped (not a hard failure)', async () => {
    const draft: ProtocolDraft = {
      parameters: [],
      topics: [
        { topicName: 'medications', status: 'complete', collectedData: null },
        { topicName: 'allergies', status: 'incomplete', collectedData: null },
      ],
    };
    const { pool, queries } = makeFakePool({
      // allergies is NOT in the lookup → returns empty rows.
      topicLookups: { medications: 'topic-uuid-medications' },
    });
    const result = await new PgProtocolPersister(pool).persist('p', 'c', draft);
    expect(result.topicsConfigured).toBe(1);
    expect(result.topicsSkipped).toEqual(['allergies']);
    // Only one upsert into patient_topics
    const ptUpserts = queries.filter((q) => q.text.includes('INSERT INTO patient_topics'));
    expect(ptUpserts).toHaveLength(1);
  });

  it('serializes collectedData as JSON for the patient_topics insert', async () => {
    const { pool, queries } = makeFakePool();
    await new PgProtocolPersister(pool).persist('p', 'c', baseDraft);
    const ptQuery = queries.find((q) => q.text.includes('INSERT INTO patient_topics'));
    expect(ptQuery).toBeDefined();
    // 4th positional value is the JSONB payload
    expect(ptQuery!.values[3]).toBe(JSON.stringify({ summary: 'Amlodipine 5mg' }));
  });

  it('ROLLBACKs and re-throws when the parameter upsert fails', async () => {
    const { pool, queries } = makeFakePool({
      failOn: { sqlContains: 'INSERT INTO parameter_configs', error: new Error('boom') },
    });
    await expect(
      new PgProtocolPersister(pool).persist('p', 'c', baseDraft),
    ).rejects.toThrow('boom');
    const sqlOrder = queries.map((q) => q.text.split('\n')[0].trim());
    expect(sqlOrder).toContain('BEGIN');
    expect(sqlOrder).toContain('ROLLBACK');
    expect(sqlOrder).not.toContain('COMMIT');
  });
});

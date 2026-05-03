import {
  PgClient,
  PgPatientContextLoader,
  PgTurnContextLoader,
  PgSessionPersister,
  PgModelCallRecorder,
} from '../src/db';
import type { ModelCallRecord } from '../src/telemetry';

interface CallLog {
  text: string;
  params?: unknown[];
}

function stubClient(rowsByQuery: Map<string, unknown[]>): { client: PgClient; calls: CallLog[] } {
  const calls: CallLog[] = [];
  const client: PgClient = {
    async query<R>(text: string, params?: unknown[]) {
      calls.push({ text, params });
      const key = matchKey(text, rowsByQuery);
      return { rows: (rowsByQuery.get(key) ?? []) as R[] };
    },
  };
  return { client, calls };
}

function matchKey(text: string, map: Map<string, unknown[]>): string {
  for (const key of map.keys()) {
    if (text.includes(key)) return key;
  }
  return '';
}

describe('PgPatientContextLoader', () => {
  it('resolves cognito_sub then issues four parallel queries and assembles the PatientContext', async () => {
    const rows = new Map<string, unknown[]>();
    // Phase 1 query — JOIN users on cognito_sub → patients.id + profile fields.
    rows.set('FROM patients p', [
      {
        id: 'patient-1',
        name: 'Ramesh Sharma',
        age: 72,
        gender: 'male',
        primary_language: 'hi-IN',
        conditions: ['hypertension'],
        medical_history_summary: null, // v1 schema has no such column
      },
    ]);
    rows.set('FROM parameter_configs', [
      {
        parameter_name: 'blood_pressure_systolic',
        loinc_code: '8480-6',
        unit: 'mmHg',
        frequency_days: 1,
        daily_deadline: '18:00',
        timezone: 'Asia/Kolkata',
        threshold_min: 90,
        threshold_max: 140,
        threshold_set_by: null, // v1 stores user_id; mapping to caregiver/doctor deferred
        active: true,
      },
    ]);
    rows.set('FROM patient_topics', [
      {
        topic_name: 'medications', // aliased from topics.name
        status: 'complete',
        last_updated: '2026-04-30T00:00:00Z',
        summary: null, // v1 has no summary column
      },
    ]);
    rows.set('FROM interaction_sessions', [
      {
        session_id: 's1',
        session_type: 'patient_logging',
        language: 'hi-IN',
        started_at: '2026-04-30T12:00:00Z',
        ended_at: '2026-04-30T12:05:00Z',
        status: 'complete',
        captured_values: [], // v1 stores extracted_summary JSONB; loader returns []
        incomplete_reason: null,
      },
    ]);
    rows.set('FROM recommendations', [
      {
        parameter_name: 'blood_glucose_fasting',
        source: 'doctor',
        rationale: 'Better diabetic monitoring',
        suggested_frequency_days: 1,
        requires_gentle_introduction: false, // v1 has no such column; loader returns false
      },
    ]);

    const { client, calls } = stubClient(rows);
    const loader = new PgPatientContextLoader(client);
    const ctx = await loader.load('cognito-sub-abc');

    // Phase 1 (sequential) + Phase 2 (four parallel) = 5 query calls total.
    expect(calls).toHaveLength(5);
    expect(calls[0].text).toContain('FROM patients p');
    expect(calls[0].params).toEqual(['cognito-sub-abc']);
    // The next four use the resolved internal patients.id.
    for (let i = 1; i <= 4; i++) {
      expect(calls[i].params).toEqual(['patient-1']);
    }
    expect(ctx.patient.id).toBe('patient-1'); // internal UUID surfaced for model_call.patient_id
    expect(ctx.patient.name).toBe('Ramesh Sharma');
    expect(ctx.patient.conditions).toEqual(['hypertension']);
    expect(ctx.patient.medicalHistorySummary).toBeNull();
    expect(ctx.protocol[0].parameterName).toBe('blood_pressure_systolic');
    expect(ctx.protocol[0].thresholdSetBy).toBeNull();
    expect(ctx.topics[0].topicName).toBe('medications');
    expect(ctx.topics[0].lastUpdated).toBeInstanceOf(Date);
    expect(ctx.topics[0].summary).toBeNull();
    expect(ctx.recentSessions[0].capturedValues).toEqual([]);
    expect(ctx.pendingRecommendations[0].requiresGentleIntroduction).toBe(false);
  });

  it('throws when the patient row is missing', async () => {
    const rows = new Map<string, unknown[]>();
    rows.set('FROM patients p', []);
    const { client } = stubClient(rows);
    const loader = new PgPatientContextLoader(client);
    await expect(loader.load('missing-sub')).rejects.toThrow(/No patient row/);
  });

  it('handles null conditions gracefully', async () => {
    const rows = new Map<string, unknown[]>();
    rows.set('FROM patients p', [
      {
        id: 'p',
        name: 'Test',
        age: 30,
        gender: 'female',
        primary_language: 'en-IN',
        conditions: null,
        medical_history_summary: null,
      },
    ]);
    rows.set('FROM parameter_configs', []);
    rows.set('FROM patient_topics', []);
    rows.set('FROM interaction_sessions', []);
    rows.set('FROM recommendations', []);
    const { client } = stubClient(rows);
    const ctx = await new PgPatientContextLoader(client).load('cognito-sub-test');
    expect(ctx.patient.conditions).toEqual([]);
    expect(ctx.patient.medicalHistorySummary).toBeNull();
  });
});

describe('PgTurnContextLoader', () => {
  it('loads session state and turn history', async () => {
    const rows = new Map<string, unknown[]>();
    rows.set('FROM interaction_sessions WHERE id', [
      {
        id: 'session-1',
        session_type: 'patient_logging',
        language: 'en-IN',
        fsm_state: 'EXTRACTING',
        captured_this_session: [],
        pending_confirmation: [],
        still_needed: ['blood_glucose'],
        transcript_history: [
          { role: 'system', text: 'How are you?', timestamp: '2026-05-02T10:00:00Z' },
          { role: 'patient', text: "I'm fine.", timestamp: '2026-05-02T10:00:30Z' },
        ],
        conversation_summary: null,
      },
    ]);
    const { client } = stubClient(rows);
    const ctx = await new PgTurnContextLoader(client).load('session-1', 'My BP is 130 over 85.');
    expect(ctx.sessionState.sessionId).toBe('session-1');
    expect(ctx.sessionState.fsmState).toBe('EXTRACTING');
    expect(ctx.sessionState.stillNeeded).toEqual(['blood_glucose']);
    expect(ctx.recentTurns).toHaveLength(2);
    expect(ctx.recentTurns[0].timestamp).toBeInstanceOf(Date);
    expect(ctx.currentTranscript).toBe('My BP is 130 over 85.');
  });

  it('throws when session row is missing', async () => {
    const rows = new Map<string, unknown[]>();
    rows.set('FROM interaction_sessions WHERE id', []);
    const { client } = stubClient(rows);
    await expect(new PgTurnContextLoader(client).load('missing', 'x')).rejects.toThrow(
      /No interaction_sessions row/,
    );
  });

  it('handles null transcript_history', async () => {
    const rows = new Map<string, unknown[]>();
    rows.set('FROM interaction_sessions WHERE id', [
      {
        id: 'session-2',
        session_type: 'patient_logging',
        language: 'en-IN',
        fsm_state: 'GREETING',
        captured_this_session: null,
        pending_confirmation: null,
        still_needed: null,
        transcript_history: null,
        conversation_summary: null,
      },
    ]);
    const { client } = stubClient(rows);
    const ctx = await new PgTurnContextLoader(client).load('session-2', 'hi');
    expect(ctx.recentTurns).toEqual([]);
    expect(ctx.sessionState.capturedThisSession).toEqual([]);
    expect(ctx.sessionState.stillNeeded).toEqual([]);
  });
});

describe('PgSessionPersister', () => {
  it('issues one UPDATE with the right column ordering', async () => {
    const { client, calls } = stubClient(new Map());
    const persister = new PgSessionPersister(client);
    await persister.update('session-1', {
      fsmState: 'PENDING_CONFIRMATION',
      capturedThisSession: [],
      pendingConfirmation: [],
      stillNeeded: ['blood_glucose'],
      transcriptHistory: [
        { role: 'patient', text: 'BP 130/85', timestamp: new Date('2026-05-02T10:00:00Z') },
      ],
      escalationsTriggered: ['emergency'],
      inferenceRegion: 'ap-southeast-1',
      streamingUsed: false,
      conversationSummary: 'Earlier patient confirmed BP 132/84.',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('UPDATE interaction_sessions');
    expect(calls[0].text).toContain('conversation_summary = $10');
    expect(calls[0].params).toBeDefined();
    const params = calls[0].params as unknown[];
    expect(params[0]).toBe('session-1');
    expect(params[1]).toBe('PENDING_CONFIRMATION');
    expect(params[6]).toBe('["emergency"]');
    expect(params[7]).toBe('ap-southeast-1');
    expect(params[8]).toBe(false);
    expect(params[9]).toBe('Earlier patient confirmed BP 132/84.');
  });

  it('writes null conversationSummary when no summary exists', async () => {
    const { client, calls } = stubClient(new Map());
    await new PgSessionPersister(client).update('s', {
      fsmState: 'EXTRACTING',
      capturedThisSession: [],
      pendingConfirmation: [],
      stillNeeded: [],
      transcriptHistory: [],
      escalationsTriggered: [],
      inferenceRegion: 'ap-southeast-1',
      streamingUsed: false,
      conversationSummary: null,
    });
    const params = calls[0].params as unknown[];
    expect(params[9]).toBeNull();
  });

  it('serializes transcript history with ISO timestamps', async () => {
    const { client, calls } = stubClient(new Map());
    await new PgSessionPersister(client).update('s', {
      fsmState: 'EXTRACTING',
      capturedThisSession: [],
      pendingConfirmation: [],
      stillNeeded: [],
      transcriptHistory: [
        { role: 'patient', text: 'hi', timestamp: new Date('2026-05-02T10:00:00Z') },
      ],
      escalationsTriggered: [],
      inferenceRegion: 'ap-southeast-1',
      streamingUsed: false,
      conversationSummary: null,
    });
    const params = calls[0].params as unknown[];
    const historyJson = params[5] as string;
    const parsed = JSON.parse(historyJson);
    expect(parsed[0].timestamp).toBe('2026-05-02T10:00:00.000Z');
  });
});

describe('PgModelCallRecorder', () => {
  it('issues one INSERT with all model_call columns', async () => {
    const { client, calls } = stubClient(new Map());
    const record: ModelCallRecord = {
      sessionId: 's1',
      patientId: 'p1',
      tier: 'T2',
      model: 'claude-haiku-4-5',
      streamed: false,
      guardrailBlocked: false,
      inputTokens: 1840,
      cachedInputTokens: 1420,
      outputTokens: 28,
      latencyMs: 612,
      inferenceRegion: 'ap-southeast-1',
      escalationReason: null,
      costUsd: 0.000702,
    };
    await new PgModelCallRecorder(client).record(record);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('INSERT INTO model_call');
    expect(calls[0].params).toEqual([
      's1', 'p1', 'T2', 'claude-haiku-4-5', false, false,
      1840, 1420, 28, 612, 'ap-southeast-1', null, 0.000702,
    ]);
  });
});

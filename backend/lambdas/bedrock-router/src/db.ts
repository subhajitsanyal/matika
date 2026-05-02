// Postgres-backed implementations of the loader/persister/recorder contracts.
// Owned by backend.
//
// The PgClient interface is intentionally a subset of pg.Pool / pg.Client so
// either can be passed in. Tests pass a stub that returns predetermined rows.
//
// The SQL strings here are written against the v1 + V005 schema as documented
// in docs/matika_spec_v2.md §5 and docs/carelog_spec.md §5. Verify against the
// actual deployed schema during P1 integration testing — column names may need
// adjustment for the v1 tables we don't fully control here.

import type { ExtractedValue } from './parser';
import type {
  PatientContext,
  PatientContextLoader,
  TurnContext,
  TurnContextLoader,
  Turn,
  SessionState,
  FsmState,
  SessionType,
  SupportedLanguage,
  ParameterConfig,
  PatientTopic,
  SessionSummary,
  Recommendation,
  CapturedValueSummary,
} from './context/types';
import type { ModelCallRecord } from './telemetry';

// Minimal pg-compatible interface. Both pg.Pool and pg.Client implement this.
export interface PgClient {
  query<R = unknown>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

// ---------- Patient context loader ----------

interface PatientRow {
  id: string;
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  primary_language: SupportedLanguage;
  conditions: string[] | null;
  medical_history_summary: string | null;
}

interface ParameterConfigRow {
  parameter_name: string;
  loinc_code: string;
  unit: string;
  frequency_days: number;
  daily_deadline: string;
  timezone: string;
  threshold_min: number | null;
  threshold_max: number | null;
  threshold_set_by: 'caregiver' | 'doctor' | null;
  active: boolean;
}

interface PatientTopicRow {
  topic_name: string;
  status: 'incomplete' | 'complete' | 'outdated';
  last_updated: string | null; // ISO timestamp
  summary: string | null;
}

interface SessionSummaryRow {
  session_id: string;
  session_type: SessionType;
  language: SupportedLanguage;
  started_at: string;
  ended_at: string | null;
  status: 'complete' | 'incomplete';
  captured_values: CapturedValueSummary[] | null;
  incomplete_reason: string | null;
}

interface RecommendationRow {
  parameter_name: string;
  source: 'analytics' | 'doctor';
  rationale: string;
  suggested_frequency_days: number | null;
  requires_gentle_introduction: boolean;
}

export class PgPatientContextLoader implements PatientContextLoader {
  constructor(private client: PgClient) {}

  async load(patientId: string): Promise<PatientContext> {
    const [patientRows, configRows, topicRows, sessionRows, recRows] = await Promise.all([
      this.client.query<PatientRow>(
        `SELECT id, name, age, gender, primary_language, conditions, medical_history_summary
         FROM patient WHERE id = $1`,
        [patientId],
      ),
      this.client.query<ParameterConfigRow>(
        `SELECT parameter_name, loinc_code, unit, frequency_days, daily_deadline, timezone,
                threshold_min, threshold_max, threshold_set_by, active
         FROM parameter_config
         WHERE patient_id = $1 AND active = TRUE
         ORDER BY parameter_name`,
        [patientId],
      ),
      this.client.query<PatientTopicRow>(
        `SELECT t.topic_name, pt.status, pt.last_updated, pt.summary
         FROM patient_topic pt JOIN topic t ON t.id = pt.topic_id
         WHERE pt.patient_id = $1
         ORDER BY t.topic_name`,
        [patientId],
      ),
      this.client.query<SessionSummaryRow>(
        `SELECT id AS session_id, session_type, language, started_at, ended_at, status,
                extracted_parameters AS captured_values, incomplete_reason
         FROM interaction_session
         WHERE patient_id = $1
         ORDER BY started_at DESC
         LIMIT 3`,
        [patientId],
      ),
      this.client.query<RecommendationRow>(
        `SELECT parameter_name, source, rationale, suggested_frequency_days,
                requires_gentle_introduction
         FROM recommendation
         WHERE patient_id = $1 AND status = 'pending'
         ORDER BY created_at`,
        [patientId],
      ),
    ]);

    if (patientRows.rows.length === 0) {
      throw new Error(`No patient row found for id ${patientId}`);
    }
    const p = patientRows.rows[0];

    return {
      patient: {
        id: p.id,
        name: p.name,
        age: p.age,
        gender: p.gender,
        primaryLanguage: p.primary_language,
        conditions: p.conditions ?? [],
        medicalHistorySummary: p.medical_history_summary,
      },
      protocol: configRows.rows.map(mapParameterConfig),
      topics: topicRows.rows.map(mapPatientTopic),
      recentSessions: sessionRows.rows.map(mapSessionSummary),
      pendingRecommendations: recRows.rows.map(mapRecommendation),
    };
  }
}

function mapParameterConfig(r: ParameterConfigRow): ParameterConfig {
  return {
    parameterName: r.parameter_name,
    loincCode: r.loinc_code,
    unit: r.unit,
    frequencyDays: r.frequency_days,
    dailyDeadline: r.daily_deadline,
    timezone: r.timezone,
    thresholdMin: r.threshold_min,
    thresholdMax: r.threshold_max,
    thresholdSetBy: r.threshold_set_by,
    active: r.active,
  };
}

function mapPatientTopic(r: PatientTopicRow): PatientTopic {
  return {
    topicName: r.topic_name,
    status: r.status,
    lastUpdated: r.last_updated ? new Date(r.last_updated) : null,
    summary: r.summary,
  };
}

function mapSessionSummary(r: SessionSummaryRow): SessionSummary {
  return {
    sessionId: r.session_id,
    sessionType: r.session_type,
    language: r.language,
    startedAt: new Date(r.started_at),
    endedAt: r.ended_at ? new Date(r.ended_at) : null,
    status: r.status,
    capturedValues: r.captured_values ?? [],
    incompleteReason: r.incomplete_reason,
  };
}

function mapRecommendation(r: RecommendationRow): Recommendation {
  return {
    parameterName: r.parameter_name,
    source: r.source,
    rationale: r.rationale,
    suggestedFrequencyDays: r.suggested_frequency_days,
    requiresGentleIntroduction: r.requires_gentle_introduction,
  };
}

// ---------- Turn context loader ----------

interface SessionRow {
  id: string;
  session_type: SessionType;
  language: SupportedLanguage;
  fsm_state: FsmState;
  captured_this_session: ExtractedValue[] | null;
  pending_confirmation: ExtractedValue[] | null;
  still_needed: string[] | null;
  transcript_history: Array<{ role: 'patient' | 'caregiver' | 'system'; text: string; timestamp: string }> | null;
  conversation_summary: string | null;
}

export class PgTurnContextLoader implements TurnContextLoader {
  constructor(private client: PgClient) {}

  async load(sessionId: string, currentTranscript: string): Promise<TurnContext> {
    const result = await this.client.query<SessionRow>(
      `SELECT id, session_type, language, fsm_state, captured_this_session, pending_confirmation,
              still_needed, transcript_history, conversation_summary
       FROM interaction_session WHERE id = $1`,
      [sessionId],
    );
    if (result.rows.length === 0) {
      throw new Error(`No interaction_session row found for id ${sessionId}`);
    }
    const r = result.rows[0];
    const sessionState: SessionState = {
      sessionId: r.id,
      sessionType: r.session_type,
      language: r.language,
      fsmState: r.fsm_state,
      capturedThisSession: r.captured_this_session ?? [],
      pendingConfirmation: r.pending_confirmation ?? [],
      stillNeeded: r.still_needed ?? [],
    };
    const recentTurns: Turn[] = (r.transcript_history ?? []).map((t) => ({
      role: t.role,
      text: t.text,
      timestamp: new Date(t.timestamp),
    }));
    return {
      sessionState,
      recentTurns,
      conversationSummary: r.conversation_summary,
      currentTranscript,
    };
  }
}

// ---------- Session persister ----------

export interface SessionUpdate {
  fsmState: FsmState;
  capturedThisSession: ExtractedValue[];
  pendingConfirmation: ExtractedValue[];
  stillNeeded: string[];
  transcriptHistory: Turn[];
  escalationsTriggered: string[];
  inferenceRegion: string;
  streamingUsed: boolean;
  conversationSummary: string | null;
}

export interface SessionPersister {
  update(sessionId: string, patch: SessionUpdate): Promise<void>;
}

export class PgSessionPersister implements SessionPersister {
  constructor(private client: PgClient) {}

  async update(sessionId: string, patch: SessionUpdate): Promise<void> {
    await this.client.query(
      `UPDATE interaction_session
       SET fsm_state = $2,
           captured_this_session = $3,
           pending_confirmation = $4,
           still_needed = $5,
           transcript_history = $6,
           escalations_triggered = $7,
           inference_region = $8,
           streaming_used = $9,
           conversation_summary = $10
       WHERE id = $1`,
      [
        sessionId,
        patch.fsmState,
        JSON.stringify(patch.capturedThisSession),
        JSON.stringify(patch.pendingConfirmation),
        patch.stillNeeded,
        JSON.stringify(
          patch.transcriptHistory.map((t) => ({
            role: t.role,
            text: t.text,
            timestamp: t.timestamp.toISOString(),
          })),
        ),
        JSON.stringify(patch.escalationsTriggered),
        patch.inferenceRegion,
        patch.streamingUsed,
        patch.conversationSummary,
      ],
    );
  }
}

// ---------- model_call recorder ----------

export interface ModelCallRecorder {
  record(record: ModelCallRecord): Promise<void>;
}

export class PgModelCallRecorder implements ModelCallRecorder {
  constructor(private client: PgClient) {}

  async record(record: ModelCallRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO model_call (
         session_id, patient_id, tier, model, streamed, guardrail_blocked,
         input_tokens, cached_input_tokens, output_tokens, latency_ms,
         inference_region, escalation_reason, cost_usd
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        record.sessionId,
        record.patientId,
        record.tier,
        record.model,
        record.streamed,
        record.guardrailBlocked,
        record.inputTokens,
        record.cachedInputTokens,
        record.outputTokens,
        record.latencyMs,
        record.inferenceRegion,
        record.escalationReason,
        record.costUsd,
      ],
    );
  }
}

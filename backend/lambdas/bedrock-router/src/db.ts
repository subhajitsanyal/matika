// Postgres-backed implementations of the loader/persister/recorder contracts.
// Owned by backend.
//
// The PgClient interface is intentionally a subset of pg.Pool / pg.Client so
// either can be passed in. Tests pass a stub that returns predetermined rows.
//
// Schema reality (v1 + V004 + V005) differs from the v2 spec in several places.
// The loader handles these mappings:
//   patients.name              → users.name (JOIN on patients.user_id)
//   patients.age               → derived: EXTRACT(YEAR FROM AGE(date_of_birth))
//   patients.primary_language  → patients.language
//   patients.conditions        → patients.medical_conditions
//   patients.medical_history_summary → does not exist in v1; returned as null
//   parameter_configs.loinc_code     → loinc_codes[1] (column is TEXT[])
//   parameter_configs.threshold_min  → threshold_min[1]  (column is NUMERIC[])
//   parameter_configs.threshold_max  → threshold_max[1]  (column is NUMERIC[])
//   parameter_configs.threshold_set_by → stored as user_id UUID; mapping to
//                                        'caregiver'|'doctor' deferred — null
//   topics.topic_name          → topics.name
//   patient_topics.summary     → does not exist in v1; null
//   interaction_sessions.captured_values → extracted_summary JSONB (empty for
//                                          now; shape contract not yet pinned)
//   interaction_sessions.incomplete_reason → does not exist in v1; null
//   recommendations.requires_gentle_introduction → does not exist in v1; false
//
// Identity model: load() accepts the Cognito sub from the JWT (passed in the
// request body as `patientId`). It JOINs users.cognito_sub → patients.user_id
// to resolve the internal patients.id UUID, which is then used for the
// other four queries (and surfaces in PatientContext.patient.id so the
// handler can pass it to model_call.patient_id).

import type { ExtractedValue } from './parser';
import type {
  CareNotesRecorder,
  CareNotesRecordInput,
  RecentAmbiguousNote,
} from './care_notes_recorder';
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
  CareTeamMember,
} from './context/types';
import type { ModelCallRecord } from './telemetry';

// Minimal pg-compatible interface. Both pg.Pool and pg.Client implement this.
export interface PgClient {
  query<R = unknown>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

// ---------- Patient context loader ----------

interface PatientRow {
  id: string;
  user_id: string;
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

interface CareTeamMemberRow {
  user_id: string;
  name: string;
}

export class PgPatientContextLoader implements PatientContextLoader {
  constructor(private client: PgClient) {}

  async load(cognitoSub: string): Promise<PatientContext> {
    // Phase 1: resolve cognito_sub → patients.id and load the patient profile
    // in a single round trip. The four parallel queries below need the
    // internal UUID so they can't fan out before this completes.
    const patientResult = await this.client.query<PatientRow>(
      `SELECT
         p.id,
         u.id AS user_id,
         u.name,
         COALESCE(EXTRACT(YEAR FROM AGE(p.date_of_birth))::int, 0) AS age,
         p.gender,
         p.language AS primary_language,
         p.medical_conditions AS conditions,
         NULL::text AS medical_history_summary
       FROM patients p
       JOIN users u ON u.id = p.user_id
       WHERE u.cognito_sub = $1`,
      [cognitoSub],
    );

    if (patientResult.rows.length === 0) {
      throw new Error(`No patient row found for cognito_sub ${cognitoSub}`);
    }
    const p = patientResult.rows[0];
    const internalPatientId = p.id;

    // Phase 2: five parallel queries against the internal patient ID.
    const [configRows, topicRows, sessionRows, recRows, careTeamRows] = await Promise.all([
      this.client.query<ParameterConfigRow>(
        `SELECT parameter_name,
                COALESCE(loinc_codes[1], '') AS loinc_code,
                unit,
                frequency_days,
                to_char(daily_deadline, 'HH24:MI') AS daily_deadline,
                timezone,
                threshold_min[1] AS threshold_min,
                threshold_max[1] AS threshold_max,
                NULL::text AS threshold_set_by,
                active
         FROM parameter_configs
         WHERE patient_id = $1 AND active = TRUE
         ORDER BY parameter_name`,
        [internalPatientId],
      ),
      this.client.query<PatientTopicRow>(
        `SELECT t.name AS topic_name,
                pt.status,
                pt.last_updated,
                NULL::text AS summary
         FROM patient_topics pt
         JOIN topics t ON t.id = pt.topic_id
         WHERE pt.patient_id = $1
         ORDER BY t.name`,
        [internalPatientId],
      ),
      this.client.query<SessionSummaryRow>(
        `SELECT id AS session_id,
                session_type,
                language,
                started_at,
                ended_at,
                CASE WHEN status = 'complete' THEN 'complete' ELSE 'incomplete' END AS status,
                '[]'::jsonb AS captured_values,
                NULL::text AS incomplete_reason
         FROM interaction_sessions
         WHERE patient_id = $1
         ORDER BY started_at DESC
         LIMIT 3`,
        [internalPatientId],
      ),
      this.client.query<RecommendationRow>(
        `SELECT parameter_name,
                source,
                rationale,
                suggested_frequency_days,
                FALSE AS requires_gentle_introduction
         FROM recommendations
         WHERE patient_id = $1 AND status = 'pending'
         ORDER BY created_at`,
        [internalPatientId],
      ),
      // PRD §6.9 / Spec §6.10 — active caregivers for record_note resolution.
      // Filtering on relationship='caregiver' (not 'relative') keeps the
      // recipient-resolution scope aligned with v2.0's caregiver-only target.
      this.client.query<CareTeamMemberRow>(
        `SELECT u.id AS user_id, u.name
         FROM persona_links pl
         JOIN users u ON u.id = pl.linked_user_id
         WHERE pl.patient_id = $1
           AND pl.is_active = TRUE
           AND pl.relationship = 'caregiver'
           AND u.is_active = TRUE
         ORDER BY pl.created_at`,
        [internalPatientId],
      ),
    ]);

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
      userId: p.user_id,
      protocol: configRows.rows.map(mapParameterConfig),
      topics: topicRows.rows.map(mapPatientTopic),
      recentSessions: sessionRows.rows.map(mapSessionSummary),
      pendingRecommendations: recRows.rows.map(mapRecommendation),
      careTeam: careTeamRows.rows.map(mapCareTeamMember),
    };
  }
}

function mapCareTeamMember(row: CareTeamMemberRow): CareTeamMember {
  return { userId: row.user_id, name: row.name, relationship: 'caregiver' };
}

// ---------- Session creator ----------
//
// Inserts a fresh interaction_sessions row when the handler encounters a
// sessionId that doesn't exist (first turn of a new session). All fields not
// passed in here are picked up from the schema defaults (status='in_progress',
// turn_count=0, fsm_state='CREATED', etc.). The ON CONFLICT (id) DO NOTHING
// clause makes this idempotent if two concurrent first turns race.

export interface SessionCreator {
  create(params: SessionCreateParams): Promise<void>;
}

export interface SessionCreateParams {
  sessionId: string;
  // F23 — null is allowed ONLY for caregiver_onboarding sessions in
  // their profile-extraction phase, before create-patient-from-voice
  // fires the mid-session pivot. The V008 migration relaxed the
  // interaction_sessions.patient_id NOT NULL constraint for exactly
  // this case; the V008 CHECK constraint blocks the same NULL on
  // patient_logging / caregiver_config sessions at the database layer.
  patientId: string | null;
  userId: string; // internal users.id UUID
  sessionType: SessionType;
  language: SupportedLanguage;
}

export class PgSessionCreator implements SessionCreator {
  constructor(private client: PgClient) {}

  async create(params: SessionCreateParams): Promise<void> {
    await this.client.query(
      `INSERT INTO interaction_sessions (id, patient_id, user_id, session_type, language)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [params.sessionId, params.patientId, params.userId, params.sessionType, params.language],
    );
  }
}

// F23 — given a session id, return the patient's cognito_sub IF the
// session row exists AND its patient_id has been UPDATEd post-pivot
// (i.e., it's no longer NULL). Used by the handler to decide between
// returning a placeholder PatientContext stub and loading the real
// post-pivot patient context. Returns null when the session is still
// pre-pivot OR doesn't exist.

export interface PivotedPatientLookup {
  lookup(sessionId: string): Promise<string | null>;
}

export class PgPivotedPatientLookup implements PivotedPatientLookup {
  constructor(private client: PgClient) {}

  async lookup(sessionId: string): Promise<string | null> {
    const result = await this.client.query<{ cognito_sub: string }>(
      `SELECT u.cognito_sub
       FROM interaction_sessions s
       JOIN patients p ON p.id = s.patient_id
       JOIN users u ON u.id = p.user_id
       WHERE s.id = $1 AND s.patient_id IS NOT NULL`,
      [sessionId],
    );
    return result.rows[0]?.cognito_sub ?? null;
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
       FROM interaction_sessions WHERE id = $1`,
      [sessionId],
    );
    if (result.rows.length === 0) {
      throw new Error(`No interaction_sessions row found for id ${sessionId}`);
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
  // Lifecycle terminus columns (testing_todos_v2.md F2). Both nullable
  // → undefined/null preserves the existing column value via COALESCE.
  // The handler sets these on `complete_session` and `escalate_emergency`
  // actions; otherwise leaves them alone and the row stays in_progress.
  status?: 'in_progress' | 'paused' | 'complete' | 'incomplete' | null;
  endedAt?: Date | null;
}

export interface SessionPersister {
  update(sessionId: string, patch: SessionUpdate): Promise<void>;
}

export class PgSessionPersister implements SessionPersister {
  constructor(private client: PgClient) {}

  async update(sessionId: string, patch: SessionUpdate): Promise<void> {
    // status/ended_at use COALESCE($N, col) so undefined/null in patch
    // leaves the existing value intact. F2: the handler sets these only
    // on `complete_session` / `escalate_emergency` actions.
    await this.client.query(
      `UPDATE interaction_sessions
       SET fsm_state = $2,
           captured_this_session = $3,
           pending_confirmation = $4,
           still_needed = $5,
           transcript_history = $6,
           escalations_triggered = $7,
           inference_region = $8,
           streaming_used = $9,
           conversation_summary = $10,
           status = COALESCE($11, status),
           ended_at = COALESCE($12, ended_at)
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
        patch.status ?? null,
        patch.endedAt ?? null,
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

// ---------- care_notes recorder ----------
//
// PRD §6.9 / Spec §6.10 — persistence for the patient-asides feature. The
// handler does name-resolution against patientCtx.careTeam in process; this
// class owns only the SQL.

export class PgCareNotesRecorder implements CareNotesRecorder {
  constructor(private client: PgClient) {}

  async insert(input: CareNotesRecordInput): Promise<{ id: string }> {
    const result = await this.client.query<{ id: string }>(
      `INSERT INTO care_notes (
         patient_id, session_id, turn_index, source, recipient_role,
         recipient_user_id, candidate_user_ids, mentioned_name,
         disambiguation_status, note_text, note_language
       ) VALUES ($1, $2, $3, 'patient_request', 'caregiver', $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        input.patientId,
        input.sessionId,
        input.turnIndex,
        input.recipientUserId,
        input.candidateUserIds.length > 0 ? input.candidateUserIds : null,
        input.mentionedName,
        input.disambiguationStatus,
        input.noteText,
        input.noteLanguage,
      ],
    );
    if (result.rows.length === 0) {
      throw new Error('care_notes INSERT returned no rows');
    }
    return { id: result.rows[0].id };
  }

  async findRecentAmbiguous(
    sessionId: string,
    maxAgeMinutes = 5,
  ): Promise<RecentAmbiguousNote | null> {
    const result = await this.client.query<{
      id: string;
      mentioned_name: string | null;
      candidate_user_ids: string[] | null;
    }>(
      `SELECT id, mentioned_name, candidate_user_ids
       FROM care_notes
       WHERE session_id = $1
         AND disambiguation_status = 'ambiguous'
         AND created_at >= NOW() - ($2 || ' minutes')::interval
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId, String(maxAgeMinutes)],
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      id: r.id,
      mentionedName: r.mentioned_name,
      candidateUserIds: r.candidate_user_ids ?? [],
    };
  }

  async updateToResolved(
    id: string,
    recipientUserId: string,
    mentionedName: string | null,
  ): Promise<void> {
    await this.client.query(
      `UPDATE care_notes
         SET recipient_user_id = $1,
             mentioned_name = $2,
             disambiguation_status = 'resolved',
             candidate_user_ids = NULL,
             updated_at = NOW()
       WHERE id = $3`,
      [recipientUserId, mentionedName, id],
    );
  }

  async findDuplicateInTurn(
    sessionId: string,
    turnIndex: number,
    noteText: string,
  ): Promise<{ id: string } | null> {
    const result = await this.client.query<{ id: string }>(
      `SELECT id FROM care_notes
       WHERE session_id = $1 AND turn_index = $2 AND note_text = $3
       LIMIT 1`,
      [sessionId, turnIndex, noteText],
    );
    if (result.rows.length === 0) return null;
    return { id: result.rows[0].id };
  }
}

// Shared types for prompt-context building.
// Per spec §6.3: system prompt (cached) + per-patient block (cached, patient-keyed)
// + per-turn block (uncached) are concatenated and sent to Bedrock.
//
// This file defines the shapes the renderers consume. The loader interface
// (PatientContextLoader, TurnContextLoader) is the contract between handler
// (T-V2-103, increment 3) and the DB layer.

import type { ExtractedValue } from '../parser';

export type SupportedLanguage = 'en-IN' | 'hi-IN' | 'bn-IN';
export type SessionType = 'patient_logging' | 'caregiver_config' | 'caregiver_onboarding';
export type SessionStatus = 'complete' | 'incomplete';

export interface PatientProfile {
  id: string;
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  primaryLanguage: SupportedLanguage;
  conditions: string[];
  medicalHistorySummary: string | null;
}

export interface ParameterConfig {
  parameterName: string;
  loincCode: string;
  unit: string;
  frequencyDays: number;
  dailyDeadline: string; // "HH:MM" 24-hour, patient's local time
  timezone: string; // IANA, e.g. "Asia/Kolkata"
  thresholdMin: number | null;
  thresholdMax: number | null;
  thresholdSetBy: 'caregiver' | 'doctor' | null;
  active: boolean;
}

export type TopicStatus = 'incomplete' | 'complete' | 'outdated';

export interface PatientTopic {
  topicName: string;
  status: TopicStatus;
  lastUpdated: Date | null;
  summary: string | null;
}

export interface CapturedValueSummary {
  parameter: string;
  value: number;
  unit: string;
}

export interface SessionSummary {
  sessionId: string;
  sessionType: SessionType;
  language: SupportedLanguage;
  startedAt: Date;
  endedAt: Date | null;
  status: SessionStatus;
  capturedValues: CapturedValueSummary[];
  incompleteReason: string | null;
}

export type RecommendationSource = 'analytics' | 'doctor';

export interface Recommendation {
  parameterName: string;
  source: RecommendationSource;
  rationale: string;
  suggestedFrequencyDays: number | null;
  requiresGentleIntroduction: boolean;
}

export interface PatientContext {
  patient: PatientProfile;
  // Internal users.id resolved from the cognito sub. Used by the handler when
  // INSERTing a fresh interaction_sessions row (which has user_id NOT NULL).
  // Not rendered into the prompt.
  userId: string;
  protocol: ParameterConfig[]; // active configs only
  topics: PatientTopic[];
  recentSessions: SessionSummary[]; // most recent first; up to 3 entries
  pendingRecommendations: Recommendation[];
  // F23 — true when this context is the synthetic stub used during the
  // pre-pivot profile-extraction phase of a caregiver_onboarding
  // session. The patient row doesn't exist yet (and `patient.id` /
  // `userId` are empty strings); downstream code paths that touch
  // patient_id-bound tables (model_call, sessionPersister.update,
  // observation writes) skip when this is true. Spec §6.9.
  placeholder?: boolean;
}

// Loader contract — handler (increment 3) implements via pg; tests pass stubs.
export interface PatientContextLoader {
  load(patientId: string): Promise<PatientContext>;
}

// ---------- Per-turn types ----------

export type FsmState =
  | 'CREATED'
  | 'GREETING'
  | 'EXTRACTING'
  | 'PENDING_CONFIRMATION'
  | 'AWAITING_PHOTO'
  | 'PLAUSIBILITY_CHALLENGE'
  | 'EMERGENCY'
  | 'PAUSED'
  | 'COMPLETE'
  | 'TERMINAL'
  // F23 — caregiver_onboarding two-pass states (spec §6.9). Valid only
  // when sessionType === 'caregiver_onboarding'. The state machine
  // accepts these transitions regardless of session_type — that
  // session-type gating is enforced at the handler layer (rejects
  // these states for patient_logging / caregiver_config sessions).
  | 'EXTRACTING_PROFILE'
  | 'AWAITING_PROFILE_CONFIRMATION'
  | 'PROFILE_CONFIRMED';

export interface SessionState {
  sessionId: string;
  sessionType: SessionType;
  language: SupportedLanguage;
  fsmState: FsmState;
  capturedThisSession: ExtractedValue[];
  pendingConfirmation: ExtractedValue[];
  stillNeeded: string[]; // parameter names not yet captured
}

export interface Turn {
  role: 'patient' | 'caregiver' | 'system';
  text: string;
  timestamp: Date;
}

export interface TurnContext {
  sessionState: SessionState;
  recentTurns: Turn[]; // already trimmed to the sliding window (oldest first)
  conversationSummary: string | null; // summary of overflow turns, if any
  currentTranscript: string;
}

export interface TurnContextLoader {
  load(sessionId: string, currentTranscript: string): Promise<TurnContext>;
}

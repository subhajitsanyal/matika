export interface ParameterConfig {
  id: string;
  patient_id: string;
  parameter_name: string;
  display_name: string;
  loinc_codes: string[];
  unit: string;
  frequency_days: number;
  daily_deadline: string; // "HH:MM"
  timezone: string;
  threshold_min: number[] | null;
  threshold_max: number[] | null;
  threshold_set_by: string | null;
  active: boolean;
  updated_at: string;
}

export interface Recommendation {
  id: string;
  patient_id: string;
  source: 'analytics' | 'doctor';
  source_doctor_id: string | null;
  parameter_name: string;
  loinc_code: string | null;
  rationale: string;
  suggested_frequency_days: number | null;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  resolved_at: string | null;
}

export interface InteractionSession {
  id: string;
  patient_id: string;
  session_type: 'patient_logging' | 'caregiver_config' | 'caregiver_onboarding';
  language: string;
  status: 'complete' | 'incomplete';
  turn_count: number;
  duration_ms: number;
  extracted_summary: Record<string, unknown>;
  started_at: string;
  ended_at: string;
}

export interface TranscriptEntry {
  turn: number;
  role: 'patient' | 'caregiver' | 'system';
  text: string;
  timestamp: string;
}

export interface ConversationPrompt {
  prompt_type: string;
  version: string;
  system_prompt: string;
  updated_at: string;
}

/**
 * CloudApiClient — wraps all CareLog Cloud API (API Gateway) endpoints.
 *
 * All requests require a Cognito JWT Bearer token. The client accepts tokens
 * for different personas (patient, caregiver, doctor) and attaches them as
 * Authorization headers.
 *
 * Base URL pattern:
 *   https://{api-id}.execute-api.ap-south-1.amazonaws.com/{stage}
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionConfigResponse {
  patient_id: string;
  patient_name: string;
  language: string;
  timezone: string;
  parameters: ParameterConfig[];
  topics: TopicConfig[];
  prompts: Record<string, string>;
  recommendations: Recommendation[];
  last_session_summary: {
    date: string;
    confirmed_values: string[];
    status: string;
  } | null;
}

export interface ParameterConfig {
  id: string;
  name: string;
  loinc_codes: string[];
  unit: string;
  frequency_days: number;
  daily_deadline: string;
  threshold_min: number[] | null;
  threshold_max: number[] | null;
  threshold_set_by: string | null;
  last_logged: string | null;
}

export interface TopicConfig {
  id: string;
  name: string;
  description: string;
  status: string;
  collected_data: unknown;
  last_updated: string | null;
}

export interface Recommendation {
  id: string;
  source: string;
  parameter_name: string;
  rationale: string;
  status: string;
}

export interface FhirBatchRequest {
  patient_id: string;
  session_id: string;
  recorded_by: string;
  recorded_at: string;
  values: FhirBatchValue[];
}

export interface FhirBatchValue {
  parameter: string;
  loinc_code: string;
  value: number;
  unit: string;
}

export interface FhirBatchResponse {
  observations_created: number;
  observation_ids: string[];
  s3_keys: string[];
  threshold_evaluation: {
    status: string;
    alerts: ThresholdAlert[];
  };
}

export interface ThresholdAlert {
  parameter: string;
  value: number;
  threshold_max: number;
  alert_type: string;
}

export interface StoreInteractionResponse {
  interaction_id: string;
  audio_s3_key: string;
  transcript_s3_key: string;
  status: string;
}

export interface AlertRecord {
  id: string;
  patient_id: string;
  alert_type: string;
  parameter_name: string;
  value: number;
  threshold: number;
  status: string;
  created_at: string;
}

export interface PatientCreateRequest {
  name: string;
  date_of_birth: string;
  language: string;
  caregiver_id: string;
  timezone?: string;
}

export interface PatientCreateResponse {
  patient_id: string;
  user_id: string;
  status: string;
}

export interface ThresholdUpdateRequest {
  patient_id: string;
  parameter_name: string;
  threshold_min?: number[];
  threshold_max?: number[];
}

export interface PromptsResponse {
  prompts: Record<string, {
    version: string;
    system_prompt: string;
    updated_at: string;
  }>;
}

export interface RecommendationCreateRequest {
  patient_id: string;
  parameter_name: string;
  loinc_code: string;
  rationale: string;
  suggested_frequency_days: number;
}

export interface ParameterConfigCreateRequest {
  vital_type: string;
  frequency_days: number;
  daily_deadline: string;
  timezone: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class CloudApiClient {
  private client: AxiosInstance;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.token = token;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /** Switch auth token (e.g. to act as a different persona). */
  setToken(token: string): void {
    this.token = token;
    this.client.defaults.headers['Authorization'] = `Bearer ${token}`;
  }

  // ---- Session Config ----------------------------------------------------

  async fetchSessionConfig(patientId: string): Promise<SessionConfigResponse> {
    const res = await this.client.get<SessionConfigResponse>(
      `/session-config/${patientId}`,
    );
    return res.data;
  }

  // ---- FHIR Observations -------------------------------------------------

  async constructFhirBatch(body: FhirBatchRequest): Promise<FhirBatchResponse> {
    const res = await this.client.post<FhirBatchResponse>(
      '/observations/batch',
      body,
    );
    return res.data;
  }

  async getObservations(
    patientId: string,
    params?: { start_date?: string; end_date?: string; parameter?: string },
  ): Promise<AxiosResponse> {
    return this.client.get(`/observations/${patientId}`, { params });
  }

  // ---- Interactions -------------------------------------------------------

  async storeInteraction(
    metadata: Record<string, unknown>,
    patientAudio?: Buffer,
    systemAudio?: Buffer,
    devicePhotos?: Buffer[],
  ): Promise<StoreInteractionResponse> {
    const form = new FormData();
    form.append('metadata', JSON.stringify(metadata));
    if (patientAudio) form.append('patient_audio', patientAudio, { filename: 'patient_audio.pcm' });
    if (systemAudio) form.append('system_audio', systemAudio, { filename: 'system_audio.pcm' });
    if (devicePhotos) {
      for (const photo of devicePhotos) {
        form.append('device_photos[]', photo, { filename: 'device_photo.jpg' });
      }
    }
    const res = await this.client.post<StoreInteractionResponse>('/interactions', form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${this.token}` },
    });
    return res.data;
  }

  async getInteractions(patientId: string): Promise<AxiosResponse> {
    return this.client.get(`/interactions`, { params: { patient_id: patientId } });
  }

  // ---- Recommendations ---------------------------------------------------

  async getRecommendations(patientId: string): Promise<{ recommendations: Recommendation[] }> {
    const res = await this.client.get(`/patients/${patientId}/recommendations`);
    return res.data;
  }

  async createRecommendation(body: RecommendationCreateRequest): Promise<AxiosResponse> {
    return this.client.post(`/patients/${body.patient_id}/recommendations`, body);
  }

  async updateRecommendationStatus(
    patientId: string,
    recommendationId: string,
    status: 'accepted' | 'rejected',
  ): Promise<AxiosResponse> {
    return this.client.put(`/patients/${patientId}/recommendations/${recommendationId}`, { status });
  }

  // ---- Parameter Configs --------------------------------------------------

  async updateParameterConfig(
    patientId: string,
    body: ParameterConfigCreateRequest,
  ): Promise<AxiosResponse> {
    return this.client.put(`/reminders/${patientId}`, body);
  }

  // ---- Thresholds ---------------------------------------------------------

  async updateThreshold(body: ThresholdUpdateRequest): Promise<AxiosResponse> {
    return this.client.put(`/thresholds/${body.patient_id}`, body);
  }

  async getThresholds(patientId: string): Promise<AxiosResponse> {
    return this.client.get(`/thresholds/${patientId}`);
  }

  // ---- Alerts -------------------------------------------------------------

  async getAlerts(patientId: string): Promise<{ alerts: AlertRecord[] }> {
    const res = await this.client.get(`/alerts`, { params: { patient_id: patientId } });
    return res.data;
  }

  // ---- Patients -----------------------------------------------------------

  async createPatient(body: PatientCreateRequest): Promise<PatientCreateResponse> {
    const res = await this.client.post<PatientCreateResponse>('/patients', body);
    return res.data;
  }

  async getPatient(patientId: string): Promise<AxiosResponse> {
    return this.client.get(`/patients/${patientId}`);
  }

  async updatePatientLanguage(patientId: string, language: string): Promise<AxiosResponse> {
    return this.client.put(`/patients/${patientId}/language`, { language });
  }

  async deletePatient(patientId: string): Promise<AxiosResponse> {
    return this.client.delete(`/patients/${patientId}`);
  }

  // ---- Invites ------------------------------------------------------------

  async inviteAttendant(patientId: string, email: string, name: string): Promise<AxiosResponse> {
    return this.client.post('/invites/attendant', { patient_id: patientId, email, name });
  }

  // ---- Prompts ------------------------------------------------------------

  async getPrompts(): Promise<PromptsResponse> {
    const res = await this.client.get<PromptsResponse>('/prompts');
    return res.data;
  }

  // ---- Topics -------------------------------------------------------------

  async storeTopicData(
    patientId: string,
    topicId: string,
    collectedData: Record<string, unknown>,
    sessionId: string,
  ): Promise<AxiosResponse> {
    return this.client.post(`/patients/${patientId}/topics/${topicId}`, {
      collected_data: collectedData,
      session_id: sessionId,
    });
  }

  // ---- Device Tokens (for notification testing) --------------------------

  async registerDeviceToken(token: string, platform: string): Promise<AxiosResponse> {
    return this.client.post('/device-tokens', { token, platform });
  }

  // ---- Check Missed Measurements (invoke) --------------------------------

  async checkMissedMeasurements(): Promise<AxiosResponse> {
    return this.client.post('/admin/check-missed-measurements');
  }

  // ---- Check Daily Deadline (invoke) -------------------------------------

  async checkDailyDeadline(): Promise<AxiosResponse> {
    return this.client.post('/admin/check-daily-deadline');
  }

  // ---- Audit Log ----------------------------------------------------------

  async getAuditLog(params?: Record<string, string>): Promise<AxiosResponse> {
    return this.client.get('/audit-log', { params });
  }

  // ---- Generic request for ad-hoc calls ----------------------------------

  async request<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.request<T>({
      ...config,
      headers: { ...config.headers, Authorization: `Bearer ${this.token}` },
    });
  }
}

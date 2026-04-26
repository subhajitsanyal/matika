/**
 * MacMiniClient — wraps all Mac Mini service endpoints (STT, LLM, TTS, Vision, Health).
 *
 * Default ports:
 *   Health :8000   STT :8001   LLM :8002   TTS :8003   Vision :8004
 *
 * All connections are plain HTTP over LAN — no TLS, no auth.
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'offline';
  services: {
    stt: ServiceHealth;
    llm: ServiceHealth;
    tts: ServiceHealth;
    vision: ServiceHealth;
  };
}

export interface ServiceHealth {
  status: 'up' | 'down';
  port: number;
}

export interface TranscribeResponse {
  text: string;
  language: string;
  duration_ms: number;
  segments: TranscribeSegment[];
}

export interface TranscribeSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number;
}

export interface LlmSessionCreateRequest {
  session_type: 'patient_logging' | 'caregiver_config' | 'caregiver_onboarding';
  patient_id: string;
  language: string;
  config: {
    parameters: LlmParameterConfig[];
    topics?: LlmTopicConfig[];
    system_prompt: string;
    patient_name: string;
    last_session_summary?: string;
  };
}

export interface LlmParameterConfig {
  name: string;
  loinc_codes: string[];
  unit: string;
  frequency_days: number;
  threshold_min?: number[];
  threshold_max?: number[];
}

export interface LlmTopicConfig {
  id: string;
  name: string;
  description: string;
  status: string;
  last_collected: string | null;
}

export interface LlmSessionCreateResponse {
  session_id: string;
  greeting_text: string;
  state: 'active';
}

export interface LlmUtteranceRequest {
  text: string;
  turn_number: number;
}

export interface ExtractedValue {
  parameter: string;
  loinc_code: string;
  value: number;
  unit: string;
  status: 'pending_confirmation' | 'confirmed';
}

export type LlmAction =
  | 'greeting'
  | 'confirm_value'
  | 'ask_parameter'
  | 'suggest_photo'
  | 'ask_topic'
  | 'implausible_value'
  | 'emergency'
  | 'session_summary'
  | 'ask_repeat'
  | 'fallback_text';

export interface LlmUtteranceResponse {
  response_text: string;
  extracted_values: ExtractedValue[];
  session_state: {
    confirmed_values: ExtractedValue[];
    pending_confirmation: string[];
    remaining_parameters: string[];
    topics_addressed: string[];
    turn_count: number;
  };
  action: LlmAction;
  requires_photo: boolean;
}

export interface LlmEndSessionRequest {
  reason: 'user_stopped' | 'pause_timeout' | 'all_captured';
}

export interface LlmEndSessionResponse {
  session_id: string;
  summary: {
    confirmed_values: Omit<ExtractedValue, 'status'>[];
    missed_parameters: string[];
    topics_addressed: string[];
    turn_count: number;
    language: string;
    duration_ms: number;
    status: 'complete' | 'incomplete';
  };
  full_transcript: TranscriptTurn[];
  state: 'ended';
}

export interface TranscriptTurn {
  turn: number;
  role: 'system' | 'patient';
  text: string;
}

export interface LlmPauseResponse {
  session_id: string;
  state: 'paused';
  timeout_seconds: number;
}

export interface LlmResumeResponse {
  session_id: string;
  state: 'active';
  response_text: string;
}

export interface SynthesizeRequest {
  text: string;
  language: string;
  format?: string;
  sample_rate?: number;
}

export interface VisionExtractResponse {
  device_type: string;
  confidence: number;
  readings: VisionReading[];
  raw_text_detected: string;
}

export interface VisionReading {
  label: string;
  value: number;
  unit: string;
  bounding_box: { x: number; y: number; w: number; h: number };
}

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

export interface StreamingSttMessage {
  type: 'partial' | 'final';
  text: string;
  confidence?: number;
  duration_ms?: number;
}

/**
 * Open a streaming STT WebSocket, send audio chunks, return the final transcript.
 */
export function streamStt(
  wsUrl: string,
  audioChunks: Buffer[],
): Promise<StreamingSttMessage> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let finalResult: StreamingSttMessage | null = null;

    ws.on('open', () => {
      for (const chunk of audioChunks) {
        ws.send(chunk);
      }
      ws.send(JSON.stringify({ type: 'end' }));
    });

    ws.on('message', (data) => {
      const msg: StreamingSttMessage = JSON.parse(data.toString());
      if (msg.type === 'final') {
        finalResult = msg;
      }
    });

    ws.on('close', () => {
      if (finalResult) resolve(finalResult);
      else reject(new Error('WebSocket closed without final transcript'));
    });

    ws.on('error', reject);
  });
}

/**
 * Open a streaming TTS WebSocket, send text, collect audio chunks.
 */
export function streamTts(
  wsUrl: string,
  text: string,
  language: string,
): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const audioChunks: Buffer[] = [];

    ws.on('open', () => {
      ws.send(JSON.stringify({ text, language }));
    });

    ws.on('message', (data) => {
      if (Buffer.isBuffer(data)) {
        audioChunks.push(data);
      } else {
        // Could be a Buffer wrapped in a typed array
        audioChunks.push(Buffer.from(data as ArrayBuffer));
      }
    });

    ws.on('close', () => resolve(audioChunks));
    ws.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class MacMiniClient {
  private baseHost: string;
  private healthClient: AxiosInstance;
  private sttClient: AxiosInstance;
  private llmClient: AxiosInstance;
  private ttsClient: AxiosInstance;
  private visionClient: AxiosInstance;

  constructor(host: string = 'localhost') {
    this.baseHost = host;

    const makeClient = (port: number): AxiosInstance =>
      axios.create({ baseURL: `http://${host}:${port}`, timeout: 30_000 });

    this.healthClient = makeClient(8000);
    this.sttClient = makeClient(8001);
    this.llmClient = makeClient(8002);
    this.ttsClient = makeClient(8003);
    this.visionClient = makeClient(8004);
  }

  // ---- Health -------------------------------------------------------------

  async health(): Promise<HealthStatus> {
    const res = await this.healthClient.get<HealthStatus>('/health');
    return res.data;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const h = await this.health();
      return h.status === 'healthy';
    } catch {
      return false;
    }
  }

  // ---- STT ----------------------------------------------------------------

  /**
   * Batch transcribe: send raw PCM audio and get transcript back.
   */
  async transcribe(
    audio: Buffer,
    language: string = 'en',
    sampleRate: number = 16000,
  ): Promise<TranscribeResponse> {
    const res = await this.sttClient.post<TranscribeResponse>('/transcribe', audio, {
      headers: {
        'Content-Type': 'audio/pcm',
        'X-Sample-Rate': String(sampleRate),
        'X-Language': language,
      },
      maxBodyLength: Infinity,
    });
    return res.data;
  }

  /**
   * Get WebSocket URL for streaming STT.
   */
  sttStreamUrl(language: string = 'en', sampleRate: number = 16000): string {
    return `ws://${this.baseHost}:8001/transcribe/stream?language=${language}&sample_rate=${sampleRate}`;
  }

  // ---- LLM ----------------------------------------------------------------

  async createSession(body: LlmSessionCreateRequest): Promise<LlmSessionCreateResponse> {
    const res = await this.llmClient.post<LlmSessionCreateResponse>('/sessions', body);
    return res.data;
  }

  async sendUtterance(
    sessionId: string,
    body: LlmUtteranceRequest,
  ): Promise<LlmUtteranceResponse> {
    const res = await this.llmClient.post<LlmUtteranceResponse>(
      `/sessions/${sessionId}/utterance`,
      body,
    );
    return res.data;
  }

  async endSession(
    sessionId: string,
    reason: LlmEndSessionRequest['reason'] = 'user_stopped',
  ): Promise<LlmEndSessionResponse> {
    const res = await this.llmClient.post<LlmEndSessionResponse>(
      `/sessions/${sessionId}/end`,
      { reason },
    );
    return res.data;
  }

  async pauseSession(sessionId: string): Promise<LlmPauseResponse> {
    const res = await this.llmClient.post<LlmPauseResponse>(
      `/sessions/${sessionId}/pause`,
    );
    return res.data;
  }

  async resumeSession(sessionId: string): Promise<LlmResumeResponse> {
    const res = await this.llmClient.post<LlmResumeResponse>(
      `/sessions/${sessionId}/resume`,
    );
    return res.data;
  }

  // ---- TTS ----------------------------------------------------------------

  /**
   * Batch synthesize: returns raw PCM audio buffer.
   */
  async synthesize(body: SynthesizeRequest): Promise<{
    audio: Buffer;
    sampleRate: number;
    durationMs: number;
  }> {
    const res = await this.ttsClient.post('/synthesize', body, {
      responseType: 'arraybuffer',
    });
    return {
      audio: Buffer.from(res.data),
      sampleRate: parseInt(res.headers['x-sample-rate'] || '16000', 10),
      durationMs: parseInt(res.headers['x-duration-ms'] || '0', 10),
    };
  }

  /**
   * Get WebSocket URL for streaming TTS.
   */
  ttsStreamUrl(language: string = 'en', sampleRate: number = 16000): string {
    return `ws://${this.baseHost}:8003/synthesize/stream?language=${language}&sample_rate=${sampleRate}`;
  }

  // ---- Vision -------------------------------------------------------------

  async extractVision(
    image: Buffer,
    deviceHint?: string,
  ): Promise<VisionExtractResponse> {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('image', image, { filename: 'device_photo.jpg', contentType: 'image/jpeg' });
    if (deviceHint) form.append('device_hint', deviceHint);

    const res = await this.visionClient.post<VisionExtractResponse>('/extract', form, {
      headers: form.getHeaders(),
    });
    return res.data;
  }
}

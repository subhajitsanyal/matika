// Real handler for bedrock-vision Lambda. Replaces the scaffold.
//
// Pipeline:
//   1. Validate request (sessionId, patientId, photoS3Key, expectedParameter).
//   2. Load photo bytes from S3.
//   3. Invoke Claude Haiku vision (T2_VISION) with image + extraction prompt.
//   4. Parse, record telemetry.
//   5. If Haiku confidence >= 0.80: return result.
//   6. Else: invoke Claude Sonnet vision (T3_VISION). Parse + record.
//   7. Return Sonnet's result regardless of its confidence; client UI uses
//      the confidence to decide whether to confirm verbally with patient.
//   8. If both tiers produce parse errors, return 422.
//
// Closes T-V2-210 (real bedrock-vision impl) and T-V2-211 (vision telemetry).
// Owned by backend per AGENTS.md §3.1.

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import type { BedrockVisionInvoker } from './bedrock_client';
import type { PhotoLoader } from './s3_loader';
import type { PatientResolver } from './patient_resolver';
import { parseVisionOutput, VisionExtraction, VisionParseError } from './parser';
import {
  VisionModelCallRecorder,
  buildVisionModelCallRecord,
  VisionTier,
} from './telemetry';

// ---------- Public types ----------

export interface PhotoExtractRequest {
  sessionId: string;
  patientId: string;
  photoS3Key: string;
  expectedParameter: string;
  expectedUnit: string;
  deviceHint?: string;
  localOcrAttempt?: { rawText: string; confidence: number };
}

export interface PhotoExtractResponseBody {
  extractedValue: {
    parameter: string;
    value: number;
    unit: string;
    loincCode: string;
    confidence: number;
    source: string;
  };
  telemetry: {
    tier: VisionTier;
    haikuLatencyMs: number;
    sonnetLatencyMs?: number;
    sonnetUsed: boolean;
    inferenceRegion: string;
  };
}

export interface PhotoExtractResponse {
  statusCode: number;
  body: string;
}

// ---------- Configuration ----------

export interface VisionHandlerConfig {
  haikuModelId: string;
  sonnetModelId: string;
  guardrailId?: string;
  guardrailVersion?: string;
  inferenceRegion: string;
  maxTokens: number;
  promptPath: string; // resolved path to prompts/extract_value.md
  haikuConfidenceThreshold: number; // default 0.80 — escalates to Sonnet below this
}

export interface VisionHandlerDeps {
  bedrock: BedrockVisionInvoker;
  photoLoader: PhotoLoader;
  modelCallRecorder: VisionModelCallRecorder;
  patientResolver: PatientResolver;
  config: VisionHandlerConfig;
  now?: () => number;
}

// ---------- Errors ----------

export class VisionHandlerError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'VisionHandlerError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// LOINC code lookup. Mirrors the table in bedrock-router/prompts/system_v2.md.
const LOINC_BY_PARAMETER: Record<string, string> = {
  blood_pressure_systolic: '8480-6',
  blood_pressure_diastolic: '8462-4',
  blood_glucose: '2339-0',
  blood_glucose_fasting: '1558-6',
  blood_glucose_postprandial: '1521-4',
  body_temperature_c: '8310-5',
  body_temperature_f: '8310-5',
  spo2: '2708-6',
  heart_rate: '8867-4',
  body_weight: '29463-7',
};

// ---------- Orchestrator ----------

export async function handlePhotoExtract(
  event: PhotoExtractRequest,
  deps: VisionHandlerDeps,
): Promise<PhotoExtractResponse> {
  const now = deps.now ?? Date.now;
  validateRequest(event);

  const loincCode = LOINC_BY_PARAMETER[event.expectedParameter];
  if (!loincCode) {
    throw new VisionHandlerError(
      400,
      'unknown_parameter',
      `Unknown expectedParameter: ${event.expectedParameter}`,
    );
  }

  // Resolve cognito sub → internal patients.id once. The model_call FK
  // references patients.id, not the Cognito sub passed in via the API.
  // Same pattern as bedrock-router/src/handler.ts (PgPatientContextLoader).
  const internalPatientId = await deps.patientResolver.resolveInternalId(event.patientId);

  // Load photo bytes from S3.
  const { bytes, mediaType } = await deps.photoLoader.load(event.photoS3Key);

  // Build prompts.
  const systemPrompt = loadPrompt(deps.config.promptPath);
  const userText = renderUserText(event);

  // ---- Attempt 1: Haiku ----
  const haikuStart = now();
  const haikuResult = await deps.bedrock.invoke({
    modelId: deps.config.haikuModelId,
    systemPrompt,
    imageBytes: bytes,
    imageMediaType: mediaType,
    userText,
    guardrailId: deps.config.guardrailId,
    guardrailVersion: deps.config.guardrailVersion,
    configuredRegion: deps.config.inferenceRegion,
    maxTokens: deps.config.maxTokens,
  });
  const haikuLatencyMs = now() - haikuStart;

  let haikuExtraction: VisionExtraction | null = null;
  let haikuParseError: VisionParseError | null = null;
  try {
    haikuExtraction = parseVisionOutput(haikuResult.responseText);
  } catch (e) {
    if (e instanceof VisionParseError) {
      haikuParseError = e;
    } else {
      throw e;
    }
  }

  // Record Haiku telemetry regardless of outcome.
  const willEscalate =
    haikuExtraction === null ||
    haikuExtraction.confidence < deps.config.haikuConfidenceThreshold;

  await deps.modelCallRecorder.record(
    buildVisionModelCallRecord({
      sessionId: event.sessionId,
      patientId: internalPatientId,
      tier: 'T2_VISION',
      model: deps.config.haikuModelId,
      guardrailBlocked: haikuResult.guardrailBlocked,
      usage: {
        inputTokens: haikuResult.inputTokens,
        cachedInputTokens: haikuResult.cachedInputTokens,
        outputTokens: haikuResult.outputTokens,
      },
      latencyMs: haikuLatencyMs,
      inferenceRegion: haikuResult.inferenceRegion,
      escalationReason: willEscalate ? 'vision_low_confidence' : null,
    }),
  );

  if (haikuExtraction !== null && !willEscalate) {
    // Haiku confident enough — return its result.
    return successResponse(
      event,
      loincCode,
      haikuExtraction,
      'T2_VISION',
      deps.config.haikuModelId,
      haikuLatencyMs,
      undefined,
      false,
      haikuResult.inferenceRegion,
    );
  }

  // ---- Attempt 2: Sonnet ----
  const sonnetStart = now();
  const sonnetResult = await deps.bedrock.invoke({
    modelId: deps.config.sonnetModelId,
    systemPrompt,
    imageBytes: bytes,
    imageMediaType: mediaType,
    userText,
    guardrailId: deps.config.guardrailId,
    guardrailVersion: deps.config.guardrailVersion,
    configuredRegion: deps.config.inferenceRegion,
    maxTokens: deps.config.maxTokens,
  });
  const sonnetLatencyMs = now() - sonnetStart;

  let sonnetExtraction: VisionExtraction;
  try {
    sonnetExtraction = parseVisionOutput(sonnetResult.responseText);
  } catch (e) {
    // Both tiers failed to produce parseable output. Record the Sonnet attempt
    // with no escalation reason (it WAS the escalation), then return 422.
    await deps.modelCallRecorder.record(
      buildVisionModelCallRecord({
        sessionId: event.sessionId,
        patientId: event.patientId,
        tier: 'T3_VISION',
        model: deps.config.sonnetModelId,
        guardrailBlocked: sonnetResult.guardrailBlocked,
        usage: {
          inputTokens: sonnetResult.inputTokens,
          cachedInputTokens: sonnetResult.cachedInputTokens,
          outputTokens: sonnetResult.outputTokens,
        },
        latencyMs: sonnetLatencyMs,
        inferenceRegion: sonnetResult.inferenceRegion,
        escalationReason: null,
      }),
    );
    throw new VisionHandlerError(
      422,
      'vision_extraction_failed',
      `Vision extraction failed at both Haiku and Sonnet tiers. Haiku: ${
        haikuParseError?.message ?? 'low confidence'
      }. Sonnet: ${(e as Error).message}`,
    );
  }

  // Record Sonnet telemetry.
  await deps.modelCallRecorder.record(
    buildVisionModelCallRecord({
      sessionId: event.sessionId,
      patientId: internalPatientId,
      tier: 'T3_VISION',
      model: deps.config.sonnetModelId,
      guardrailBlocked: sonnetResult.guardrailBlocked,
      usage: {
        inputTokens: sonnetResult.inputTokens,
        cachedInputTokens: sonnetResult.cachedInputTokens,
        outputTokens: sonnetResult.outputTokens,
      },
      latencyMs: sonnetLatencyMs,
      inferenceRegion: sonnetResult.inferenceRegion,
      escalationReason: null,
    }),
  );

  return successResponse(
    event,
    loincCode,
    sonnetExtraction,
    'T3_VISION',
    deps.config.sonnetModelId,
    haikuLatencyMs,
    sonnetLatencyMs,
    true,
    sonnetResult.inferenceRegion,
  );
}

// ---------- Helpers ----------

function validateRequest(event: PhotoExtractRequest): void {
  if (!event.sessionId) throw new VisionHandlerError(400, 'invalid_request', 'sessionId is required');
  if (!event.patientId) throw new VisionHandlerError(400, 'invalid_request', 'patientId is required');
  if (!event.photoS3Key) throw new VisionHandlerError(400, 'invalid_request', 'photoS3Key is required');
  if (!event.expectedParameter) throw new VisionHandlerError(400, 'invalid_request', 'expectedParameter is required');
  if (!event.expectedUnit) throw new VisionHandlerError(400, 'invalid_request', 'expectedUnit is required');
}

let _cachedPrompt: { path: string; content: string } | null = null;
function loadPrompt(path: string): string {
  if (_cachedPrompt && _cachedPrompt.path === path) return _cachedPrompt.content;
  const content = readFileSync(resolvePath(path), 'utf-8');
  _cachedPrompt = { path, content };
  return content;
}

export function _resetPromptCache(): void {
  _cachedPrompt = null;
}

function renderUserText(event: PhotoExtractRequest): string {
  const lines = [
    `Expected parameter: ${event.expectedParameter}`,
    `Expected unit: ${event.expectedUnit}`,
  ];
  if (event.deviceHint) lines.push(`Device type hint: ${event.deviceHint}`);
  if (event.localOcrAttempt) {
    lines.push(
      `On-device OCR hint (informational only — verify against image): rawText="${event.localOcrAttempt.rawText}", confidence=${event.localOcrAttempt.confidence}`,
    );
  }
  return lines.join('\n');
}

function successResponse(
  event: PhotoExtractRequest,
  loincCode: string,
  extraction: VisionExtraction,
  tier: VisionTier,
  modelId: string,
  haikuLatencyMs: number,
  sonnetLatencyMs: number | undefined,
  sonnetUsed: boolean,
  inferenceRegion: string,
): PhotoExtractResponse {
  const body: PhotoExtractResponseBody = {
    extractedValue: {
      parameter: event.expectedParameter,
      value: extraction.value,
      unit: extraction.unit,
      loincCode,
      confidence: extraction.confidence,
      source: `${modelId}-vision`,
    },
    telemetry: {
      tier,
      haikuLatencyMs,
      sonnetLatencyMs,
      sonnetUsed,
      inferenceRegion,
    },
  };
  return { statusCode: 200, body: JSON.stringify(body) };
}

// Vision-specific telemetry — model_call row construction + DB recorder.
//
// Tier values in the model_call table are 'T2_VISION' / 'T3_VISION' per the
// V005 schema. Pricing constants mirror bedrock-router's HAIKU_VISION_PRICING /
// SONNET_VISION_PRICING (vision adds image-token charges that we approximate
// at the same per-MTok rates as text — fine for pilot scale; revisit when
// vision call volume justifies a separate pricing path).

export type VisionTier = 'T2_VISION' | 'T3_VISION';

export interface VisionPricing {
  inputPerMtok: number;
  cachedInputPerMtok: number;
  outputPerMtok: number;
}

// Match bedrock-router's pricing constants. Verify against AWS console at
// deploy time and bump if AWS revises prices.
export const HAIKU_VISION_PRICING: VisionPricing = {
  inputPerMtok: 1.0,
  cachedInputPerMtok: 0.1,
  outputPerMtok: 5.0,
};

export const SONNET_VISION_PRICING: VisionPricing = {
  inputPerMtok: 3.0,
  cachedInputPerMtok: 0.3,
  outputPerMtok: 15.0,
};

export function pricingForTier(tier: VisionTier): VisionPricing {
  return tier === 'T2_VISION' ? HAIKU_VISION_PRICING : SONNET_VISION_PRICING;
}

export interface VisionTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export function calculateCost(usage: VisionTokenUsage, pricing: VisionPricing): number {
  if (usage.inputTokens < 0 || usage.cachedInputTokens < 0 || usage.outputTokens < 0) {
    throw new Error('Token counts cannot be negative.');
  }
  if (usage.cachedInputTokens > usage.inputTokens) {
    throw new Error(
      `cachedInputTokens (${usage.cachedInputTokens}) cannot exceed inputTokens (${usage.inputTokens}).`,
    );
  }
  const nonCached = usage.inputTokens - usage.cachedInputTokens;
  const cost =
    (nonCached / 1_000_000) * pricing.inputPerMtok +
    (usage.cachedInputTokens / 1_000_000) * pricing.cachedInputPerMtok +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMtok;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function calculateCostForTier(usage: VisionTokenUsage, tier: VisionTier): number {
  return calculateCost(usage, pricingForTier(tier));
}

// model_call row shape — same columns as bedrock-router writes.
export interface VisionModelCallRecord {
  sessionId: string;
  patientId: string;
  tier: VisionTier;
  model: string;
  streamed: false;
  guardrailBlocked: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  inferenceRegion: string;
  escalationReason: 'vision_low_confidence' | null;
  costUsd: number;
}

export interface BuildVisionRecordInput {
  sessionId: string;
  patientId: string;
  tier: VisionTier;
  model: string;
  guardrailBlocked: boolean;
  usage: VisionTokenUsage;
  latencyMs: number;
  inferenceRegion: string;
  escalationReason: 'vision_low_confidence' | null;
}

export function buildVisionModelCallRecord(input: BuildVisionRecordInput): VisionModelCallRecord {
  return {
    sessionId: input.sessionId,
    patientId: input.patientId,
    tier: input.tier,
    model: input.model,
    streamed: false,
    guardrailBlocked: input.guardrailBlocked,
    inputTokens: input.usage.inputTokens,
    cachedInputTokens: input.usage.cachedInputTokens,
    outputTokens: input.usage.outputTokens,
    latencyMs: input.latencyMs,
    inferenceRegion: input.inferenceRegion,
    escalationReason: input.escalationReason,
    costUsd: calculateCostForTier(input.usage, input.tier),
  };
}

// Recorder: persists a vision model_call row to the same table as text calls.
export interface VisionModelCallRecorder {
  record(record: VisionModelCallRecord): Promise<void>;
}

export interface PgClient {
  query<R = unknown>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export class PgVisionModelCallRecorder implements VisionModelCallRecorder {
  constructor(private client: PgClient) {}

  async record(record: VisionModelCallRecord): Promise<void> {
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

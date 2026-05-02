// Telemetry — cost calculation + model_call record assembly.
// Pure functions. The DB write happens in db.ts (sub-increment 3b).
//
// Spec §5.1 / §14.4 — every Bedrock invocation produces a model_call row.
// Cost is computed at insert time using the pricing constants in pricing.ts.

import { Tier, pricingForTier, ModelPricing } from './pricing';
import type { EscalationSignal } from '../escalation/signal_detectors';

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

// Cost in USD computed from token usage and pricing.
//
// Formula:
//   cost = (input - cached) * inputRate + cached * cachedRate + output * outputRate
//
// Where rates are per-million-tokens. We round to 6 decimal places (NUMERIC(10,6)
// in the model_call table) at the boundary; intermediate math stays in JS doubles.
export function calculateCost(usage: TokenUsage, pricing: ModelPricing): number {
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

export function calculateCostForTier(usage: TokenUsage, tier: Tier): number {
  return calculateCost(usage, pricingForTier(tier));
}

// What gets inserted into the model_call table (matches V005 migration shape).
export interface ModelCallRecord {
  sessionId: string;
  patientId: string;
  tier: Tier;
  model: string;
  streamed: boolean;
  guardrailBlocked: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  inferenceRegion: string;
  escalationReason: EscalationSignal | null;
  costUsd: number;
}

export interface BuildRecordInput {
  sessionId: string;
  patientId: string;
  tier: Tier;
  model: string;
  streamed: boolean;
  guardrailBlocked: boolean;
  usage: TokenUsage;
  latencyMs: number;
  inferenceRegion: string;
  escalationReason: EscalationSignal | null;
}

// Pure factory — produces the row to insert. Doesn't write anything.
export function buildModelCallRecord(input: BuildRecordInput): ModelCallRecord {
  return {
    sessionId: input.sessionId,
    patientId: input.patientId,
    tier: input.tier,
    model: input.model,
    streamed: input.streamed,
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

// Computes cache hit rate as a fraction in [0, 1]. Used for dashboards.
export function cacheHitRate(usage: TokenUsage): number {
  if (usage.inputTokens === 0) return 0;
  return usage.cachedInputTokens / usage.inputTokens;
}

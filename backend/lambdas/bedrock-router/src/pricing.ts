// Bedrock pricing constants for cost telemetry.
//
// Prices are USD per million tokens (MTok). Source: AWS Bedrock pricing page
// for Anthropic models (cross-region inference, ap-southeast-1 / us-east-1).
//
// IMPORTANT: pricing changes. Verify against the AWS console before each
// deployment and bump these constants if AWS revises prices. The
// `cost_telemetry` table values are computed at insert time using these
// constants, so historic rows are not retroactively repriced.
//
// Cached input tokens are billed at ~10% of normal input cost on Anthropic's
// prompt cache; ~25% on Bedrock's at the time of writing — using 10% for
// conservative estimation. Tune after first month of pilot data.

export interface ModelPricing {
  inputPerMtok: number;
  cachedInputPerMtok: number;
  outputPerMtok: number;
}

// Verified 2026-05; revisit before each deploy.
export const HAIKU_4_5_PRICING: ModelPricing = {
  inputPerMtok: 1.0,
  cachedInputPerMtok: 0.1,
  outputPerMtok: 5.0,
};

export const SONNET_4_X_PRICING: ModelPricing = {
  inputPerMtok: 3.0,
  cachedInputPerMtok: 0.3,
  outputPerMtok: 15.0,
};

// Vision-tier pricing. Vision input tokens include image-per-token charges,
// which differ per model. Using same per-MTok rates here is an approximation —
// actual image charges will require a separate image-token counter when
// bedrock-vision wires up real Claude vision in P2.
export const HAIKU_VISION_PRICING: ModelPricing = HAIKU_4_5_PRICING;
export const SONNET_VISION_PRICING: ModelPricing = SONNET_4_X_PRICING;

export type Tier = 'T2' | 'T3' | 'T2_VISION' | 'T3_VISION';

export function pricingForTier(tier: Tier): ModelPricing {
  switch (tier) {
    case 'T2':
      return HAIKU_4_5_PRICING;
    case 'T3':
      return SONNET_4_X_PRICING;
    case 'T2_VISION':
      return HAIKU_VISION_PRICING;
    case 'T3_VISION':
      return SONNET_VISION_PRICING;
    default: {
      const _exhaustive: never = tier;
      throw new Error(`Unknown tier: ${String(_exhaustive)}`);
    }
  }
}

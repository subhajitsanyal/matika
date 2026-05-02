// Bedrock SDK wrapper. Owned by backend.
//
// Spec §7.1, §7.2 — wraps `BedrockRuntimeClient.send(InvokeModelCommand)` for
// the Anthropic-on-Bedrock path. Threads through Guardrails (per spec §11.5)
// and parses the response for token counts + region metadata that telemetry
// needs.
//
// NOT in this file (deferred):
// - Streaming via InvokeModelWithResponseStream (T-V2-110, increment 4)
// - Cross-region failover circuit breaker (post-pilot — needs telemetry first)

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type { BedrockBody } from './prompt_builder';

export interface InvokeInput {
  modelId: string;
  body: BedrockBody;
  guardrailId?: string;
  guardrailVersion?: string;
  configuredRegion: string; // for telemetry fallback when response metadata is sparse
}

export interface InvokeResult {
  responseText: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  guardrailBlocked: boolean;
  inferenceRegion: string;
  rawStopReason: string | null;
}

// Anthropic-on-Bedrock response body shape.
// Documented at:
// https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages.html
interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

// Minimal interface so tests can mock without depending on the AWS SDK.
export interface BedrockInvoker {
  invoke(input: InvokeInput): Promise<InvokeResult>;
}

export class AwsBedrockInvoker implements BedrockInvoker {
  constructor(private client: BedrockRuntimeClient) {}

  async invoke(input: InvokeInput): Promise<InvokeResult> {
    const command = new InvokeModelCommand({
      modelId: input.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(JSON.stringify(input.body)),
      ...(input.guardrailId
        ? {
            guardrailIdentifier: input.guardrailId,
            guardrailVersion: input.guardrailVersion ?? 'DRAFT',
          }
        : {}),
    });

    const response = await this.client.send(command);
    return parseInvokeOutput(response, input.configuredRegion);
  }
}

// Exported for tests — pure function over the SDK output shape.
export function parseInvokeOutput(
  output: InvokeModelCommandOutput,
  configuredRegion: string,
): InvokeResult {
  if (!output.body) {
    throw new Error('Bedrock response had no body.');
  }
  const decoded = new TextDecoder().decode(output.body);
  let parsed: AnthropicResponse;
  try {
    parsed = JSON.parse(decoded) as AnthropicResponse;
  } catch (e) {
    throw new Error(`Bedrock response was not valid JSON: ${(e as Error).message}`);
  }

  const responseText = parsed.content.map((c) => c.text).join('');
  const cacheCreation = parsed.usage.cache_creation_input_tokens ?? 0;
  const cacheRead = parsed.usage.cache_read_input_tokens ?? 0;
  const totalInput = parsed.usage.input_tokens + cacheCreation + cacheRead;

  // Guardrail-intervention indicator: stop_reason of 'guardrail_intervened'
  // (Bedrock convention) plus presence of guardrail trace metadata. We only
  // check the stop_reason here; trace inspection is operational tooling, not
  // routing.
  const guardrailBlocked = parsed.stop_reason === 'guardrail_intervened';

  // Inference region: prefer the response header if Bedrock supplied it,
  // else fall back to the configured region.
  const inferenceRegion =
    extractInferenceRegionHeader(output.$metadata?.httpStatusCode === 200 ? output : null) ??
    configuredRegion;

  return {
    responseText,
    inputTokens: totalInput,
    cachedInputTokens: cacheRead,
    outputTokens: parsed.usage.output_tokens,
    guardrailBlocked,
    inferenceRegion,
    rawStopReason: parsed.stop_reason,
  };
}

// Bedrock cross-region inference may return the region that actually served
// the request via a response header. Implementation is best-effort — the SDK
// surfaces httpHeaders inconsistently across versions.
function extractInferenceRegionHeader(output: InvokeModelCommandOutput | null): string | null {
  if (!output) return null;
  const headers = (output as { $metadata?: { httpHeaders?: Record<string, string> } }).$metadata
    ?.httpHeaders;
  if (!headers) return null;
  return headers['x-amzn-bedrock-inference-region'] ?? null;
}

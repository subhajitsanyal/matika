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
  InvokeModelWithResponseStreamCommand,
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

// ---------- Streaming types ----------

// Streaming chunks parsed from Bedrock's response-stream events. Mirrors
// Anthropic's content-block-delta shape, with usage metrics surfaced from
// message_stop.
export type StreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'message_stop'; usage: StreamUsage; stopReason: string | null };

export interface StreamUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
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
  // Bedrock decorates the response with this field when an associated
  // Guardrail intervenes on the *input* — the model never runs, `usage`
  // is absent, `stop_reason` is undefined, and `content[0].text` carries
  // the configured `blocked_input_messaging` copy verbatim. (F19)
  'amazon-bedrock-guardrailAction'?: 'INTERVENED' | string;
}

// Minimal interface so tests can mock without depending on the AWS SDK.
export interface BedrockInvoker {
  invoke(input: InvokeInput): Promise<InvokeResult>;
  invokeStream(input: InvokeInput): AsyncIterable<StreamChunk>;
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

  invokeStream(input: InvokeInput): AsyncIterable<StreamChunk> {
    const client = this.client;
    return (async function* () {
      const command = new InvokeModelWithResponseStreamCommand({
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
      const response = await client.send(command);
      if (!response.body) {
        throw new Error('Bedrock streaming response had no body.');
      }
      for await (const event of response.body) {
        if (!event.chunk?.bytes) continue;
        const decoded = new TextDecoder().decode(event.chunk.bytes);
        const chunk = parseStreamChunk(decoded);
        if (chunk) yield chunk;
      }
    })();
  }
}

// Exported for tests — pure parser over Anthropic-on-Bedrock SSE chunk JSON.
// Returns null for chunks we don't care about (message_start, ping, etc.).
export function parseStreamChunk(json: string): StreamChunk | null {
  let parsed: AnthropicStreamEvent;
  try {
    parsed = JSON.parse(json) as AnthropicStreamEvent;
  } catch {
    return null;
  }

  if (
    parsed.type === 'content_block_delta' &&
    parsed.delta?.type === 'text_delta' &&
    typeof parsed.delta.text === 'string'
  ) {
    return { type: 'text_delta', text: parsed.delta.text };
  }

  if (parsed.type === 'message_stop') {
    const metrics = parsed['amazon-bedrock-invocationMetrics'];
    if (!metrics) return null;
    const cacheRead = metrics.cacheReadInputTokenCount ?? 0;
    const cacheCreation = metrics.cacheWriteInputTokenCount ?? 0;
    return {
      type: 'message_stop',
      usage: {
        inputTokens: metrics.inputTokenCount + cacheCreation + cacheRead,
        cachedInputTokens: cacheRead,
        outputTokens: metrics.outputTokenCount,
      },
      stopReason: parsed['amazon-bedrock-stopReason'] ?? null,
    };
  }

  return null;
}

// Anthropic-on-Bedrock streaming event shapes.
interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
  'amazon-bedrock-invocationMetrics'?: {
    inputTokenCount: number;
    outputTokenCount: number;
    cacheReadInputTokenCount?: number;
    cacheWriteInputTokenCount?: number;
    invocationLatency?: number;
    firstByteLatency?: number;
  };
  'amazon-bedrock-stopReason'?: string;
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

  // Bedrock occasionally returns responses without a `usage` block —
  // guardrail-intervened responses, certain error payloads, and (observed
  // 2026-05-02) responses routed through global inference profiles in some
  // configurations. Default missing fields to 0 rather than crashing on the
  // common path; log the raw shape once so we can investigate offline.
  const responseText = (parsed.content ?? []).map((c) => c.text).join('');
  if (!parsed.usage) {
    console.warn('Bedrock response missing usage block', {
      stop_reason: parsed.stop_reason,
      content_blocks: parsed.content?.length ?? 0,
      keys: Object.keys(parsed),
    });
  }
  const usage = parsed.usage ?? { input_tokens: 0, output_tokens: 0 };
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const totalInput = (usage.input_tokens ?? 0) + cacheCreation + cacheRead;

  // Guardrail-intervention indicator. Bedrock signals this two ways:
  //   1. stop_reason === 'guardrail_intervened' — the model ran but the
  //      *output* was blocked.
  //   2. amazon-bedrock-guardrailAction === 'INTERVENED' — the *input*
  //      was blocked before the model ran. usage / stop_reason are
  //      absent in this case; content[0].text is the configured
  //      blocked_input_messaging copy. (F19)
  // Either way, the response carries the user-facing copy in
  // responseText and downstream callers must skip the structured-output
  // parser — neither variant emits the <output>...</output> envelope.
  const guardrailBlocked =
    parsed.stop_reason === 'guardrail_intervened' ||
    parsed['amazon-bedrock-guardrailAction'] === 'INTERVENED';

  // Inference region: prefer the response header if Bedrock supplied it,
  // else fall back to the configured region.
  const inferenceRegion =
    extractInferenceRegionHeader(output.$metadata?.httpStatusCode === 200 ? output : null) ??
    configuredRegion;

  return {
    responseText,
    inputTokens: totalInput,
    cachedInputTokens: cacheRead,
    outputTokens: usage.output_tokens ?? 0,
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

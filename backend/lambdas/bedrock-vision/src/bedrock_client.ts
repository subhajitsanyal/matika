// Bedrock vision SDK wrapper.
//
// Wraps `BedrockRuntimeClient.send(InvokeModelCommand)` for the Anthropic-on-
// Bedrock vision path. The body has a different shape than text-only:
// content blocks include both an image block (base64 bytes + media type) and
// a text block (the extraction prompt).
//
// Owned by backend.

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';

export interface VisionInvokeInput {
  modelId: string;
  systemPrompt: string;
  imageBytes: Uint8Array;
  imageMediaType: string;
  userText: string; // per-call instruction (expected parameter, device hint, OCR hint)
  guardrailId?: string;
  guardrailVersion?: string;
  configuredRegion: string;
  maxTokens: number;
}

export interface VisionInvokeResult {
  responseText: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  guardrailBlocked: boolean;
  inferenceRegion: string;
}

interface AnthropicVisionResponse {
  content: Array<{ type: 'text'; text: string }>;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface BedrockVisionInvoker {
  invoke(input: VisionInvokeInput): Promise<VisionInvokeResult>;
}

export class AwsBedrockVisionInvoker implements BedrockVisionInvoker {
  constructor(private client: BedrockRuntimeClient) {}

  async invoke(input: VisionInvokeInput): Promise<VisionInvokeResult> {
    const body = buildVisionBody(input);
    const command = new InvokeModelCommand({
      modelId: input.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(JSON.stringify(body)),
      ...(input.guardrailId
        ? {
            guardrailIdentifier: input.guardrailId,
            guardrailVersion: input.guardrailVersion ?? 'DRAFT',
          }
        : {}),
    });
    const response = await this.client.send(command);
    return parseVisionInvokeOutput(response, input.configuredRegion);
  }
}

// Exported for tests — pure function over the input shape.
export function buildVisionBody(input: VisionInvokeInput): object {
  return {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: input.maxTokens,
    system: [
      {
        type: 'text',
        text: input.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: input.imageMediaType,
              data: bytesToBase64(input.imageBytes),
            },
          },
          {
            type: 'text',
            text: input.userText,
          },
        ],
      },
    ],
  };
}

// Exported for tests — pure parser over the SDK output shape.
export function parseVisionInvokeOutput(
  output: InvokeModelCommandOutput,
  configuredRegion: string,
): VisionInvokeResult {
  if (!output.body) {
    throw new Error('Bedrock vision response had no body.');
  }
  const decoded = new TextDecoder().decode(output.body);
  let parsed: AnthropicVisionResponse;
  try {
    parsed = JSON.parse(decoded) as AnthropicVisionResponse;
  } catch (e) {
    throw new Error(`Bedrock vision response was not valid JSON: ${(e as Error).message}`);
  }

  const responseText = parsed.content.map((c) => c.text).join('');
  const cacheCreation = parsed.usage.cache_creation_input_tokens ?? 0;
  const cacheRead = parsed.usage.cache_read_input_tokens ?? 0;
  const totalInput = parsed.usage.input_tokens + cacheCreation + cacheRead;
  const guardrailBlocked = parsed.stop_reason === 'guardrail_intervened';

  return {
    responseText,
    inputTokens: totalInput,
    cachedInputTokens: cacheRead,
    outputTokens: parsed.usage.output_tokens,
    guardrailBlocked,
    inferenceRegion: configuredRegion,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

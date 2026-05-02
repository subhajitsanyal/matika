// Builds the Anthropic-on-Bedrock messages payload from the three prompt
// blocks (system, per-patient, per-turn).
//
// Spec §6.3 — system prompt and per-patient context get cache breakpoints
// (Anthropic prompt caching). Per-turn block is uncached and contains the
// most recent transcript. Owned by backend per AGENTS.md.
//
// The Bedrock InvokeModel body for Anthropic looks like:
//   {
//     "anthropic_version": "bedrock-2023-05-31",
//     "max_tokens": <int>,
//     "system": [{ "type": "text", "text": "...", "cache_control": {"type":"ephemeral"} }],
//     "messages": [
//       { "role": "user", "content": [
//         { "type": "text", "text": "<per-patient>", "cache_control": {"type":"ephemeral"} },
//         { "type": "text", "text": "<per-turn>" }
//       ] }
//     ]
//   }
//
// `cache_control` markers tell Bedrock where to split cache segments.

export interface ContentBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface UserMessage {
  role: 'user';
  content: ContentBlock[];
}

export interface BedrockBody {
  anthropic_version: 'bedrock-2023-05-31';
  max_tokens: number;
  system: SystemBlock[];
  messages: UserMessage[];
}

export interface BuildPromptInput {
  systemPrompt: string;
  perPatientBlock: string;
  perTurnBlock: string;
  maxTokens: number;
}

export function buildBedrockBody(input: BuildPromptInput): BedrockBody {
  if (!input.systemPrompt.trim()) {
    throw new Error('systemPrompt is empty');
  }
  if (!input.perTurnBlock.trim()) {
    throw new Error('perTurnBlock is empty');
  }
  if (input.maxTokens <= 0) {
    throw new Error(`maxTokens must be > 0, got ${input.maxTokens}`);
  }

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
            type: 'text',
            text: input.perPatientBlock,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: input.perTurnBlock,
          },
        ],
      },
    ],
  };
}

// Convenience: how many cache breakpoints does this body declare? Used for
// telemetry / debugging — Anthropic limits to 4 breakpoints per request.
export function countCacheBreakpoints(body: BedrockBody): number {
  let count = 0;
  for (const s of body.system) {
    if (s.cache_control) count++;
  }
  for (const m of body.messages) {
    for (const c of m.content) {
      if (c.cache_control) count++;
    }
  }
  return count;
}

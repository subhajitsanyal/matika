// Conversation summarization for sliding-window overflow.
//
// Spec §6.7 — when transcript_history exceeds the sliding-window size (6 turns
// per per_turn.ts), the oldest turns are compressed into a single summary
// string. Cheap Haiku call (~50–80 output tokens). Owned by backend; system
// prompt at prompts/summarize.md owned by inference-platform.

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import type { BedrockInvoker } from './bedrock_client';
import type { Turn } from './context/types';
import type { TokenUsage } from './telemetry';

export interface SummarizerInput {
  existingSummary: string | null;
  overflowTurns: Turn[];
}

export interface SummarizerResult {
  summary: string;
  usage: TokenUsage;
  latencyMs: number;
  guardrailBlocked: boolean;
  inferenceRegion: string;
}

export interface Summarizer {
  summarize(input: SummarizerInput): Promise<SummarizerResult>;
}

export class HaikuSummarizer implements Summarizer {
  constructor(
    private bedrock: BedrockInvoker,
    private modelId: string,
    private inferenceRegion: string,
    private promptPath: string,
    private maxTokens: number = 200,
    private now: () => number = Date.now,
  ) {}

  async summarize(input: SummarizerInput): Promise<SummarizerResult> {
    if (input.overflowTurns.length === 0) {
      throw new Error('summarize() called with no overflow turns');
    }

    const systemPrompt = loadSummarizerPrompt(this.promptPath);
    const userText = renderSummarizerInput(input);

    const start = this.now();
    const result = await this.bedrock.invoke({
      modelId: this.modelId,
      body: {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: this.maxTokens,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: userText }],
          },
        ],
      },
      configuredRegion: this.inferenceRegion,
    });
    const latencyMs = this.now() - start;

    return {
      summary: result.responseText.trim(),
      usage: {
        inputTokens: result.inputTokens,
        cachedInputTokens: result.cachedInputTokens,
        outputTokens: result.outputTokens,
      },
      latencyMs,
      guardrailBlocked: result.guardrailBlocked,
      inferenceRegion: result.inferenceRegion,
    };
  }
}

// Exported for tests.
export function renderSummarizerInput(input: SummarizerInput): string {
  const parts: string[] = [];
  parts.push(
    `[Existing summary]:\n${input.existingSummary?.trim() || '(none)'}`,
  );
  parts.push('');
  parts.push('[Older turns]:');
  for (const t of input.overflowTurns) {
    parts.push(`${t.role}: ${t.text}`);
  }
  return parts.join('\n');
}

// Cached prompt read — Lambda warm invocations reuse.
let _cachedPrompt: { path: string; content: string } | null = null;
function loadSummarizerPrompt(path: string): string {
  if (_cachedPrompt && _cachedPrompt.path === path) return _cachedPrompt.content;
  const content = readFileSync(resolvePath(path), 'utf-8');
  _cachedPrompt = { path, content };
  return content;
}

// Test-only escape hatch.
export function _resetSummarizerPromptCache(): void {
  _cachedPrompt = null;
}

// Server-Sent Events (SSE) types for the streaming turn endpoint.
//
// Spec §4.1 — POST /conversation/turn-stream returns text/event-stream with
// these named events. Owned by backend per AGENTS.md.
//
// Sub-increment 4b note: the streaming handler currently emits all
// content-bearing events (sentence/extracted/action) AFTER the `<output>`
// JSON has been fully received and parsed (Option B in the design notes).
// Real incremental sentence-by-sentence streaming requires a prompt-format
// change to move responseText outside the <output> block, deferred to a
// follow-up increment.

import type { ExtractedValue, StructuredOutput, Action } from './parser';
import type { Tier } from './pricing';
import type { EscalationSignal } from '../escalation/signal_detectors';
import type { FsmState } from './context/types';

export type SseEvent =
  | PreludeEvent
  | SentenceEvent
  | ExtractedEvent
  | ActionEvent
  | TelemetryEvent
  | DoneEvent
  | ErrorEvent;

export interface PreludeEvent {
  type: 'prelude';
  data: {
    sessionId: string;
    tier: Tier;
    model: string;
    streamId: string;
  };
}

export interface SentenceEvent {
  type: 'sentence';
  data: {
    text: string;
    sentenceIndex: number;
  };
}

export interface ExtractedEvent {
  type: 'extracted';
  data: ExtractedValue;
}

export interface ActionEvent {
  type: 'action';
  data: Action;
}

export interface TelemetryEvent {
  type: 'telemetry';
  data: {
    tier: Tier;
    model: string;
    latencyMs: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    guardrailBlocked: boolean;
    inferenceRegion: string;
    escalationReason: EscalationSignal | null;
  };
}

export interface DoneEvent {
  type: 'done';
  data: {
    sessionState: {
      capturedThisSession: ExtractedValue[];
      pendingConfirmation: ExtractedValue[];
      stillNeeded: string[];
      fsmState: FsmState;
    };
  };
}

export interface ErrorEvent {
  type: 'error';
  data: {
    code: string;
    message: string;
  };
}

// Pluggable emitter — tests collect into an array; production writes to the
// AWS Lambda streamifyResponse stream. Keeps the handler agnostic of the
// transport.
export interface SseEmitter {
  emit(event: SseEvent): Promise<void> | void;
  end(): Promise<void> | void;
}

// Test/library helper: collects events for assertion.
export class CollectingSseEmitter implements SseEmitter {
  public readonly events: SseEvent[] = [];
  public ended = false;

  emit(event: SseEvent): void {
    if (this.ended) throw new Error('Emit after end()');
    this.events.push(event);
  }

  end(): void {
    this.ended = true;
  }
}

// Wire-format helpers for production. The Lambda streaming-response writer
// will invoke `serializeEvent()` per event and pipe to the response stream.
//
// Format per the SSE spec: an event is `event: <name>\ndata: <payload>\n\n`.
export function serializeEvent(event: SseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

// Helpers to construct sentence/extracted/action events from a parsed
// StructuredOutput. Used by the streaming handler after `</output>` is seen.
export function emitParsedOutput(
  emitter: SseEmitter,
  parsed: StructuredOutput,
  startingSentenceIndex = 0,
): number {
  // Sentence: emit the full responseText as a single sentence event for now
  // (Option B). When the prompt format supports incremental streaming, this
  // becomes per-sentence-as-it-arrives.
  let sentenceIndex = startingSentenceIndex;
  if (parsed.responseText.trim().length > 0) {
    emitter.emit({
      type: 'sentence',
      data: { text: parsed.responseText, sentenceIndex },
    });
    sentenceIndex++;
  }

  for (const value of parsed.extractedValues) {
    emitter.emit({ type: 'extracted', data: value });
  }
  for (const action of parsed.actions) {
    emitter.emit({ type: 'action', data: action });
  }
  return sentenceIndex;
}

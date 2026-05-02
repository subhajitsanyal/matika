// Real handler for the Matika v2 bedrock-router Lambda.
// Orchestrates: load context → detect escalation → build prompt → invoke Bedrock
// → parse (with one retry on parse failure per spec §6.4) → apply state
// transition → persist session → record telemetry → respond.
//
// Two entry points:
//   - handleTurn(event, deps): non-streamed; returns TurnResponse.
//   - handleTurnStream(event, deps, emitter): streamed; emits SSE events.
//
// Closes T-V2-103 (Bedrock invocation), T-V2-105 (state machine), T-V2-107
// (telemetry), T-V2-110 (streaming endpoint), T-V2-111 (decision logic), and
// the parser-retry gap from T-V2-104.
//
// Owned by backend per AGENTS.md §3.1.

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  BedrockInvoker,
  StreamUsage,
} from './bedrock_client';
import type { AlertEnqueuer, AlertTrigger } from './alert_queue';
import { buildEmergencyAlert } from './alert_queue';
import type { ModelCallRecorder, SessionPersister } from './db';
import type { Summarizer } from './summarizer';
import type {
  PatientContextLoader,
  TurnContextLoader,
  PatientContext,
  SessionState,
  Turn,
} from './context/types';

import { detectEscalation, EscalationSignal, SessionContext as SignalSessionContext } from '../escalation/signal_detectors';
import { extractPreModelHints } from './pre_model_hints';
import { renderPatientContext } from './context/per_patient';
import { renderTurnContext, applySlidingWindow } from './context/per_turn';
import { buildBedrockBody, BedrockBody } from './prompt_builder';
import { parseStructuredOutput, ExtractedValue, StructuredOutput, StructuredOutputParseError } from './parser';
import { applyTransition } from './state_machine';
import { buildModelCallRecord } from './telemetry';
import type { Tier } from './pricing';
import { SseEmitter, emitParsedOutput } from './sse_events';

// ---------- Public types ----------

export interface TurnRequest {
  sessionId: string;
  patientId: string;
  transcript: string;
  language: 'en-IN' | 'hi-IN' | 'bn-IN';
  turnSequence: number;
  clientHints?: {
    preferStreaming?: boolean;
    deviceLatencyEstimateMs?: number;
  };
}

export interface TurnResponseBody {
  responseText: string;
  ttsHints: StructuredOutput['ttsHints'];
  extractedValues: ExtractedValue[];
  sessionState: {
    capturedThisSession: ExtractedValue[];
    pendingConfirmation: ExtractedValue[];
    stillNeeded: string[];
    fsmState: SessionState['fsmState'];
  };
  actions: StructuredOutput['actions'];
  telemetry: {
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

export interface TurnResponse {
  statusCode: number;
  body: string;
}

// ---------- Dependency container ----------

export interface HandlerConfig {
  haikuModelId: string;
  sonnetModelId: string;
  guardrailId?: string;
  guardrailVersion?: string;
  inferenceRegion: string;
  maxTokens: number;
  systemPromptPath: string; // resolved path to prompts/system_v2.md
  escalationSubpromptDir: string; // resolved path to escalation_subprompts/
}

export interface HandlerDeps {
  bedrock: BedrockInvoker;
  patientLoader: PatientContextLoader;
  turnLoader: TurnContextLoader;
  sessionPersister: SessionPersister;
  modelCallRecorder: ModelCallRecorder;
  alertEnqueuer?: AlertEnqueuer; // optional — handler still works without SQS
  summarizer?: Summarizer; // optional — overflow summarization is skipped if not provided
  config: HandlerConfig;
  // Pluggable clock for tests; defaults to Date.now
  now?: () => number;
}

// ---------- Orchestrator ----------

export async function handleTurn(event: TurnRequest, deps: HandlerDeps): Promise<TurnResponse> {
  const now = deps.now ?? Date.now;
  const t0 = now();

  validateRequest(event);

  // 1. Load contexts in parallel.
  const [patientCtx, turnCtx] = await Promise.all([
    deps.patientLoader.load(event.patientId),
    deps.turnLoader.load(event.sessionId, event.transcript),
  ]);

  // 2. Pre-model regex pass for plausibility short-circuiting.
  const preModelHints = extractPreModelHints(event.transcript);

  // 3. Detect escalation signals.
  const routing = detectEscalation({
    transcript: event.transcript,
    preModelHints,
    context: deriveSignalContext(turnCtx.sessionState, patientCtx),
  });

  // 4. Build prompt. If a routing escalation reason has a matching sub-prompt,
  //    prepend it to the per-turn block so the model gets a focused directive
  //    (challenge implausibility, handle emergency safety-first, etc.).
  const systemPrompt = loadSystemPrompt(deps.config.systemPromptPath);
  const perPatientBlock = renderPatientContext(patientCtx);
  const baseTurnBlock = renderTurnContext(turnCtx);
  const subprompt = routing.reason
    ? loadEscalationSubprompt(deps.config.escalationSubpromptDir, routing.reason)
    : null;
  const perTurnBlock = subprompt ? `${subprompt}\n\n${baseTurnBlock}` : baseTurnBlock;
  const body = buildBedrockBody({
    systemPrompt,
    perPatientBlock,
    perTurnBlock,
    maxTokens: deps.config.maxTokens,
  });

  // 5. Invoke Bedrock + parse with one retry on parse failure (spec §6.4).
  const tier: Tier = routing.tier;
  const modelId = tier === 'T3' ? deps.config.sonnetModelId : deps.config.haikuModelId;
  const invokeStart = now();
  const { parsed, meta: result } = await invokeWithRetry(body, async (b) => {
    const r = await deps.bedrock.invoke({
      modelId,
      body: b,
      guardrailId: deps.config.guardrailId,
      guardrailVersion: deps.config.guardrailVersion,
      configuredRegion: deps.config.inferenceRegion,
    });
    return { text: r.responseText, meta: r };
  });
  const latencyMs = now() - invokeStart;

  // 7. Apply state transition (validates FROM matches current state).
  const newFsmState = applyTransition(turnCtx.sessionState.fsmState, parsed.stateTransition);

  // 8. Compute updated session state.
  const mergedCaptured = mergeCaptured(turnCtx.sessionState.capturedThisSession, parsed.extractedValues);
  const newPending = parsed.extractedValues.filter((v) => v.status === 'pending_confirmation');
  const newStillNeeded = computeStillNeeded(turnCtx.sessionState.stillNeeded, mergedCaptured);
  const newHistory = appendToHistory(
    turnCtx.recentTurns,
    event.transcript,
    parsed.responseText,
    new Date(now()),
  );

  // 8b. Sliding-window summarization (spec §6.7). If history overflows the
  //     window AND a summarizer is wired up, compress the overflow into the
  //     conversationSummary and trim the persisted history to the window.
  const { trimmedHistory, newConversationSummary, summarizerTelemetry } =
    await maybeSummarizeOverflow(
      newHistory,
      turnCtx.conversationSummary,
      deps.summarizer,
    );

  // 9. Persist session, record telemetry, and (if emergency) enqueue caregiver
  //    alert — all in parallel.
  const emergencyTriggers = detectEmergencyTriggers(routing.reason, parsed.escalationReason, result.guardrailBlocked);
  const escalationsTriggered = routing.reason ? [routing.reason] : [];
  const alertPromise =
    emergencyTriggers.length > 0 && deps.alertEnqueuer
      ? deps.alertEnqueuer.enqueueEmergency(
          buildEmergencyAlert({
            patientId: event.patientId,
            sessionId: event.sessionId,
            triggers: emergencyTriggers,
            transcript: event.transcript,
            language: event.language,
            now: () => new Date(now()),
          }),
        )
      : Promise.resolve();

  await Promise.all([
    deps.sessionPersister.update(event.sessionId, {
      fsmState: newFsmState,
      capturedThisSession: mergedCaptured,
      pendingConfirmation: newPending,
      stillNeeded: newStillNeeded,
      transcriptHistory: trimmedHistory,
      escalationsTriggered,
      inferenceRegion: result.inferenceRegion,
      streamingUsed: false,
      conversationSummary: newConversationSummary,
    }),
    deps.modelCallRecorder.record(
      buildModelCallRecord({
        sessionId: event.sessionId,
        patientId: event.patientId,
        tier,
        model: modelId,
        streamed: false,
        guardrailBlocked: result.guardrailBlocked,
        usage: {
          inputTokens: result.inputTokens,
          cachedInputTokens: result.cachedInputTokens,
          outputTokens: result.outputTokens,
        },
        latencyMs,
        inferenceRegion: result.inferenceRegion,
        escalationReason: routing.reason,
      }),
    ),
    summarizerTelemetry
      ? deps.modelCallRecorder.record(
          buildModelCallRecord({
            sessionId: event.sessionId,
            patientId: event.patientId,
            tier: 'T2',
            model: deps.config.haikuModelId,
            streamed: false,
            guardrailBlocked: summarizerTelemetry.guardrailBlocked,
            usage: summarizerTelemetry.usage,
            latencyMs: summarizerTelemetry.latencyMs,
            inferenceRegion: summarizerTelemetry.inferenceRegion,
            escalationReason: 'summarizer_overflow',
          }),
        )
      : Promise.resolve(),
    alertPromise,
  ]);

  // 10. Build response.
  const responseBody: TurnResponseBody = {
    responseText: parsed.responseText,
    ttsHints: parsed.ttsHints,
    extractedValues: parsed.extractedValues,
    sessionState: {
      capturedThisSession: mergedCaptured,
      pendingConfirmation: newPending,
      stillNeeded: newStillNeeded,
      fsmState: newFsmState,
    },
    actions: parsed.actions,
    telemetry: {
      tier,
      model: modelId,
      latencyMs,
      inputTokens: result.inputTokens,
      cachedInputTokens: result.cachedInputTokens,
      outputTokens: result.outputTokens,
      guardrailBlocked: result.guardrailBlocked,
      inferenceRegion: result.inferenceRegion,
      escalationReason: routing.reason,
    },
  };

  // Record total turn latency in CloudWatch by stamping it in the response
  // body for now; in increment 4 we'll emit a proper CloudWatch metric.
  const _totalTurnLatencyMs = now() - t0;
  void _totalTurnLatencyMs;

  return {
    statusCode: 200,
    body: JSON.stringify(responseBody),
  };
}

// ---------- Helpers ----------

export class HandlerError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'HandlerError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const RETRIABLE_PARSE_FAILURES = new Set<StructuredOutputParseError['kind']>([
  'no_output_tags',
  'multiple_output_tags',
  'invalid_json',
  'schema_validation',
]);

const STRICTNESS_REMINDER =
  'SYSTEM REMINDER: Your previous response did not match the required format. ' +
  'You MUST emit your reply as a single valid JSON object inside <output></output> tags, ' +
  'with all required fields present and matching the schema exactly. ' +
  'Do not write any prose outside the tags. Do not emit multiple <output> blocks.';

// Wraps an invoker callback that returns { text, meta } and a body, attempts
// to parse the text, and retries once with a stricter prompt on retriable
// parse failures. On second failure, throws HandlerError(503).
//
// Generic over `meta` so both sync (InvokeResult) and streaming (aggregated
// StreamUsage) callers get type-safe results.
async function invokeWithRetry<R>(
  body: BedrockBody,
  invoke: (body: BedrockBody) => Promise<{ text: string; meta: R }>,
): Promise<{ parsed: StructuredOutput; meta: R }> {
  const first = await invoke(body);
  try {
    return { parsed: parseStructuredOutput(first.text), meta: first.meta };
  } catch (e) {
    if (!(e instanceof StructuredOutputParseError) || !RETRIABLE_PARSE_FAILURES.has(e.kind)) {
      throw e;
    }
    const stricterBody = appendStrictnessReminder(body);
    const retry = await invoke(stricterBody);
    try {
      return { parsed: parseStructuredOutput(retry.text), meta: retry.meta };
    } catch (e2) {
      const kind = e2 instanceof StructuredOutputParseError ? e2.kind : 'unknown';
      throw new HandlerError(
        503,
        `parse_failed_after_retry_${kind}`,
        `LLM response failed parsing after one retry: ${(e2 as Error).message}`,
      );
    }
  }
}

// Returns a copy of `body` with a strictness reminder appended to the per-turn
// (uncached) content block. We deliberately do NOT modify the cached blocks
// (system prompt, per-patient context) so prompt-cache hits are preserved.
function appendStrictnessReminder(body: BedrockBody): BedrockBody {
  const cloned: BedrockBody = {
    ...body,
    messages: body.messages.map((m) => ({
      ...m,
      content: m.content.map((c) => ({ ...c })),
    })),
  };
  const lastMessage = cloned.messages[cloned.messages.length - 1];
  const lastContent = lastMessage.content[lastMessage.content.length - 1];
  lastContent.text = `${lastContent.text}\n\n${STRICTNESS_REMINDER}`;
  return cloned;
}

function validateRequest(event: TurnRequest): void {
  if (!event.sessionId) throw new Error('sessionId is required');
  if (!event.patientId) throw new Error('patientId is required');
  if (!event.transcript || !event.transcript.trim()) throw new Error('transcript is required');
  if (!['en-IN', 'hi-IN', 'bn-IN'].includes(event.language)) {
    throw new Error(`Unsupported language: ${event.language}`);
  }
  if (!Number.isFinite(event.turnSequence) || event.turnSequence < 1) {
    throw new Error(`Invalid turnSequence: ${event.turnSequence}`);
  }
}

// Loads the system prompt from disk. Cached after first load — Lambda warm
// invocations reuse it. Cold-start pays the (tiny) read cost once.
let _cachedSystemPrompt: { path: string; content: string } | null = null;
function loadSystemPrompt(path: string): string {
  if (_cachedSystemPrompt && _cachedSystemPrompt.path === path) {
    return _cachedSystemPrompt.content;
  }
  const content = readFileSync(resolvePath(path), 'utf-8');
  _cachedSystemPrompt = { path, content };
  return content;
}

// Test-only escape hatch.
export function _resetSystemPromptCache(): void {
  _cachedSystemPrompt = null;
  _cachedEscalationSubprompts.clear();
}

// Loads an escalation-specific sub-prompt from disk, cached after first read.
// Returns null if no sub-prompt file exists for the given reason — that's
// intentional; only some escalation reasons (emergency, implausible_value)
// have authored sub-prompts. Others use the default system prompt only.
const _cachedEscalationSubprompts = new Map<string, string | null>();
function loadEscalationSubprompt(dir: string, reason: EscalationSignal): string | null {
  const cacheKey = `${dir}:${reason}`;
  if (_cachedEscalationSubprompts.has(cacheKey)) {
    return _cachedEscalationSubprompts.get(cacheKey)!;
  }
  // Map escalation signal names to filenames. Only the reasons we have
  // authored content for resolve to a filename; others return null.
  const filename = SUBPROMPT_FILENAME_BY_REASON[reason];
  if (!filename) {
    _cachedEscalationSubprompts.set(cacheKey, null);
    return null;
  }
  try {
    const content = readFileSync(resolvePath(dir, filename), 'utf-8');
    _cachedEscalationSubprompts.set(cacheKey, content);
    return content;
  } catch {
    // File missing is treated as "no sub-prompt" — not an error. Lets us add
    // sub-prompts incrementally without breaking handler when one is absent.
    _cachedEscalationSubprompts.set(cacheKey, null);
    return null;
  }
}

const SUBPROMPT_FILENAME_BY_REASON: Partial<Record<EscalationSignal, string>> = {
  emergency_keyword: 'emergency.md',
  implausible_value: 'implausible_value.md',
};

// Returns the list of emergency triggers that fired this turn. Conservative —
// any of three paths fires the alert. Empty array means no alert.
export function detectEmergencyTriggers(
  routingReason: EscalationSignal | null,
  llmEscalationReason: StructuredOutput['escalationReason'],
  guardrailBlocked: boolean,
): AlertTrigger[] {
  const triggers: AlertTrigger[] = [];
  if (routingReason === 'emergency_keyword') triggers.push('transcript_keyword');
  if (llmEscalationReason === 'emergency') triggers.push('llm_classification');
  if (guardrailBlocked) triggers.push('guardrail_block');
  return triggers;
}

function deriveSignalContext(state: SessionState, patient: PatientContext): SignalSessionContext {
  // T-V2-106 signals depend on session metadata + patient status. The fields
  // here are computed at handler time; richer signals can be plumbed in later.
  return {
    sessionType: state.sessionType,
    language: state.language,
    hasPendingRecommendationsRequiringIntroduction:
      patient.pendingRecommendations.some((r) => r.requiresGentleIntroduction),
    previousTurnLowestConfidence: lowestConfidence(state.pendingConfirmation),
    protocolDesignTurn: false, // future enhancement
    longResponseExpected: false, // future enhancement
  };
}

function lowestConfidence(values: ExtractedValue[]): number | null {
  if (values.length === 0) return null;
  return Math.min(...values.map((v) => v.confidence));
}

// Merge LLM-returned values into the session's captured set.
// Confirmed values overwrite any prior pending entry for the same parameter;
// pending values pass through unchanged into pendingConfirmation (that's the
// caller's job, not ours). Rejected values are dropped from the captured set.
function mergeCaptured(
  existing: ExtractedValue[],
  fromTurn: ExtractedValue[],
): ExtractedValue[] {
  const result = [...existing];
  for (const v of fromTurn) {
    if (v.status === 'rejected') {
      const idx = result.findIndex((e) => e.parameter === v.parameter);
      if (idx >= 0) result.splice(idx, 1);
      continue;
    }
    if (v.status === 'confirmed') {
      const idx = result.findIndex((e) => e.parameter === v.parameter);
      if (idx >= 0) result[idx] = v;
      else result.push(v);
    }
    // pending_confirmation values stay out of the captured set; they live
    // in pendingConfirmation until the next turn confirms them.
  }
  return result;
}

function computeStillNeeded(prior: string[], captured: ExtractedValue[]): string[] {
  const capturedNames = new Set<string>(captured.map((v) => v.parameter));
  return prior.filter((p) => !capturedNames.has(p));
}

function appendToHistory(
  prior: Turn[],
  patientTranscript: string,
  systemResponse: string,
  timestamp: Date,
): Turn[] {
  return [
    ...prior,
    { role: 'patient', text: patientTranscript, timestamp },
    { role: 'system', text: systemResponse, timestamp },
  ];
}

// Sliding-window overflow → summary. If the new history exceeds the window
// size and a summarizer is available, compress the overflow into the
// conversationSummary and trim the persisted history. Returns:
//   - trimmedHistory: what to write back to transcript_history
//   - newConversationSummary: what to write back to conversation_summary
//     (string when summarized, existing summary when not, null only if
//     existing was null and no summarization happened)
//   - summarizerTelemetry: token usage and latency from the summarizer call,
//     so the caller can record it as a model_call row
//
// If no summarizer is provided OR there's no overflow, this is a no-op
// pass-through.
async function maybeSummarizeOverflow(
  newHistory: Turn[],
  existingSummary: string | null,
  summarizer: Summarizer | undefined,
): Promise<{
  trimmedHistory: Turn[];
  newConversationSummary: string | null;
  summarizerTelemetry: {
    usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
    latencyMs: number;
    guardrailBlocked: boolean;
    inferenceRegion: string;
  } | null;
}> {
  const split = applySlidingWindow(newHistory);
  if (split.overflow.length === 0 || !summarizer) {
    return {
      trimmedHistory: newHistory,
      newConversationSummary: existingSummary,
      summarizerTelemetry: null,
    };
  }
  const result = await summarizer.summarize({
    existingSummary,
    overflowTurns: split.overflow,
  });
  return {
    trimmedHistory: split.window,
    newConversationSummary: result.summary,
    summarizerTelemetry: {
      usage: result.usage,
      latencyMs: result.latencyMs,
      guardrailBlocked: result.guardrailBlocked,
      inferenceRegion: result.inferenceRegion,
    },
  };
}

// ---------- Streaming handler ----------
//
// SSE-based variant. Architecture is in place; events emit AFTER the full
// `<output>` block has been received and parsed (Option B in the design
// notes). Real incremental sentence-by-sentence streaming requires a
// prompt-format change (move responseText outside the JSON block) — flagged
// as a follow-up.

export async function handleTurnStream(
  event: TurnRequest,
  deps: HandlerDeps,
  emitter: SseEmitter,
): Promise<void> {
  const now = deps.now ?? Date.now;

  try {
    validateRequest(event);

    const [patientCtx, turnCtx] = await Promise.all([
      deps.patientLoader.load(event.patientId),
      deps.turnLoader.load(event.sessionId, event.transcript),
    ]);

    const preModelHints = extractPreModelHints(event.transcript);
    const routing = detectEscalation({
      transcript: event.transcript,
      preModelHints,
      context: deriveSignalContext(turnCtx.sessionState, patientCtx),
    });

    const tier: Tier = routing.tier;
    const modelId = tier === 'T3' ? deps.config.sonnetModelId : deps.config.haikuModelId;
    const streamId = randomUUID();

    // Emit prelude immediately so the client can spin up its SSE consumer.
    emitter.emit({
      type: 'prelude',
      data: { sessionId: event.sessionId, tier, model: modelId, streamId },
    });

    const systemPrompt = loadSystemPrompt(deps.config.systemPromptPath);
    const perPatientBlock = renderPatientContext(patientCtx);
    const baseTurnBlock = renderTurnContext(turnCtx);
    const subprompt = routing.reason
      ? loadEscalationSubprompt(deps.config.escalationSubpromptDir, routing.reason)
      : null;
    const perTurnBlock = subprompt ? `${subprompt}\n\n${baseTurnBlock}` : baseTurnBlock;
    const body = buildBedrockBody({
      systemPrompt,
      perPatientBlock,
      perTurnBlock,
      maxTokens: deps.config.maxTokens,
    });

    const invokeStart = now();

    // Streaming aggregator — collects text deltas until message_stop, then
    // returns the full responseText plus usage stats.
    const aggregateStream = async (
      bodyToUse: BedrockBody,
    ): Promise<{ text: string; usage: StreamUsage; stopReason: string | null }> => {
      let buffer = '';
      let usage: StreamUsage | null = null;
      let stopReason: string | null = null;
      for await (const chunk of deps.bedrock.invokeStream({
        modelId,
        body: bodyToUse,
        guardrailId: deps.config.guardrailId,
        guardrailVersion: deps.config.guardrailVersion,
        configuredRegion: deps.config.inferenceRegion,
      })) {
        if (chunk.type === 'text_delta') {
          buffer += chunk.text;
        } else if (chunk.type === 'message_stop') {
          usage = chunk.usage;
          stopReason = chunk.stopReason;
        }
      }
      if (!usage) {
        // Some Bedrock streams don't emit message_stop with metrics; fall back
        // to zero-token estimates so the call still produces a model_call row.
        usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
      }
      return { text: buffer, usage, stopReason };
    };

    const { parsed, meta } = await invokeWithRetry(body, async (b) => {
      const r = await aggregateStream(b);
      return { text: r.text, meta: r };
    });

    const latencyMs = now() - invokeStart;

    // Apply state transition + persist + record telemetry, same as the sync
    // handler. Errors here surface as ErrorEvent rather than thrown — the
    // emitter has already started.
    const newFsmState = applyTransition(turnCtx.sessionState.fsmState, parsed.stateTransition);
    const mergedCaptured = mergeCaptured(turnCtx.sessionState.capturedThisSession, parsed.extractedValues);
    const newPending = parsed.extractedValues.filter((v) => v.status === 'pending_confirmation');
    const newStillNeeded = computeStillNeeded(turnCtx.sessionState.stillNeeded, mergedCaptured);
    const newHistory = appendToHistory(
      turnCtx.recentTurns,
      event.transcript,
      parsed.responseText,
      new Date(now()),
    );

    // Sliding-window summarization (spec §6.7) — same flow as handleTurn.
    const { trimmedHistory, newConversationSummary, summarizerTelemetry } =
      await maybeSummarizeOverflow(
        newHistory,
        turnCtx.conversationSummary,
        deps.summarizer,
      );

    const escalationsTriggered = routing.reason ? [routing.reason] : [];
    const guardrailBlocked = meta.stopReason === 'guardrail_intervened';
    const inferenceRegion = deps.config.inferenceRegion;
    const emergencyTriggers = detectEmergencyTriggers(routing.reason, parsed.escalationReason, guardrailBlocked);
    const alertPromise =
      emergencyTriggers.length > 0 && deps.alertEnqueuer
        ? deps.alertEnqueuer.enqueueEmergency(
            buildEmergencyAlert({
              patientId: event.patientId,
              sessionId: event.sessionId,
              triggers: emergencyTriggers,
              transcript: event.transcript,
              language: event.language,
              now: () => new Date(now()),
            }),
          )
        : Promise.resolve();

    await Promise.all([
      deps.sessionPersister.update(event.sessionId, {
        fsmState: newFsmState,
        capturedThisSession: mergedCaptured,
        pendingConfirmation: newPending,
        stillNeeded: newStillNeeded,
        transcriptHistory: trimmedHistory,
        escalationsTriggered,
        inferenceRegion,
        streamingUsed: true,
        conversationSummary: newConversationSummary,
      }),
      deps.modelCallRecorder.record(
        buildModelCallRecord({
          sessionId: event.sessionId,
          patientId: event.patientId,
          tier,
          model: modelId,
          streamed: true,
          guardrailBlocked,
          usage: meta.usage,
          latencyMs,
          inferenceRegion,
          escalationReason: routing.reason,
        }),
      ),
      summarizerTelemetry
        ? deps.modelCallRecorder.record(
            buildModelCallRecord({
              sessionId: event.sessionId,
              patientId: event.patientId,
              tier: 'T2',
              model: deps.config.haikuModelId,
              streamed: false,
              guardrailBlocked: summarizerTelemetry.guardrailBlocked,
              usage: summarizerTelemetry.usage,
              latencyMs: summarizerTelemetry.latencyMs,
              inferenceRegion: summarizerTelemetry.inferenceRegion,
              escalationReason: 'summarizer_overflow',
            }),
          )
        : Promise.resolve(),
      alertPromise,
    ]);

    // Emit content events (sentence + extracted + action), then telemetry,
    // then done. The emitParsedOutput helper handles the sentence/extracted/
    // action ordering.
    emitParsedOutput(emitter, parsed);

    emitter.emit({
      type: 'telemetry',
      data: {
        tier,
        model: modelId,
        latencyMs,
        inputTokens: meta.usage.inputTokens,
        cachedInputTokens: meta.usage.cachedInputTokens,
        outputTokens: meta.usage.outputTokens,
        guardrailBlocked,
        inferenceRegion,
        escalationReason: routing.reason,
      },
    });

    emitter.emit({
      type: 'done',
      data: {
        sessionState: {
          capturedThisSession: mergedCaptured,
          pendingConfirmation: newPending,
          stillNeeded: newStillNeeded,
          fsmState: newFsmState,
        },
      },
    });

    await emitter.end();
  } catch (e) {
    emitter.emit({
      type: 'error',
      data: {
        code: classifyErrorCode(e),
        message: (e as Error).message,
      },
    });
    await emitter.end();
    // Re-throw so the Lambda still surfaces the failure (CloudWatch + caller).
    throw e;
  }
}

function classifyErrorCode(e: unknown): string {
  if (e instanceof HandlerError) return e.code;
  if (e instanceof StructuredOutputParseError) return `parse_${e.kind}`;
  return 'internal_error';
}

// AWS Lambda entry point (with default deps wired in) lives in src/index.ts;
// it constructs Bedrock + pg + config and delegates to handleTurn(event, deps).
// Test harnesses import handleTurn directly with their own mocks.

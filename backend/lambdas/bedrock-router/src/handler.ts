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
import { buildEmergencyAlert, buildRateLimitAlert } from './alert_queue';
import type { ModelCallRecorder, SessionCreator, SessionPersister } from './db';
import type { Summarizer } from './summarizer';
import type { RateLimiter } from './rate_limiter';
import type {
  PatientContextLoader,
  TurnContextLoader,
  TurnContext,
  PatientContext,
  SessionState,
  SessionType,
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
import type { ProtocolExtractor } from './protocol_extractor';
import { ProtocolExtractionError } from './protocol_extractor';
import type { ProtocolPersister } from './protocol_persister';
import type { UserResolver } from './user_resolver';

// ---------- Public types ----------

export interface TurnRequest {
  sessionId: string;
  patientId: string;
  transcript: string;
  language: 'en-IN' | 'hi-IN' | 'bn-IN';
  turnSequence: number;
  // Determines which conversation prompt + session-state machine variant
  // is loaded when the session is first created. Defaults to
  // 'patient_logging' for backwards compatibility — clients that haven't
  // been updated to the v2 caregiver flow continue to work.
  // Ignored on subsequent turns: a session's type is fixed at creation.
  sessionType?: SessionType;
  // Cognito sub of the user actually making the call. For patient_logging
  // sessions this equals patientId (the patient is logging their own
  // vitals). For caregiver_* sessions this is the caregiver's sub, used
  // to populate parameter_configs.threshold_set_by when the protocol-
  // extraction pass runs at session close (T-V2-303).
  // Optional for now — only populates threshold_set_by when present.
  actorCognitoSub?: string;
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
    softCapReached: boolean; // true when rate limit's soft cap reached (warn but allow)
  };
  // Present only on caregiver_onboarding turns that triggered the protocol
  // extraction pass (T-V2-302). `extracted: false` means extraction ran but
  // failed — see `error`. Absent on every other turn.
  protocol?: {
    extracted: boolean;
    parametersConfigured: number;
    topicsConfigured: number;
    topicsSkipped: string[];
    error: string | null;
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
  systemPromptPath: string; // resolved path to prompts/system_v2.md (default for patient_logging + caregiver_config)
  caregiverOnboardingPromptPath?: string; // optional — resolved path to prompts/system_v2_caregiver_onboarding.md
  escalationSubpromptDir: string; // resolved path to escalation_subprompts/
  hardRateLimitPerPatient: number; // surfaced into RateLimitAlertMessage
}

export interface HandlerDeps {
  bedrock: BedrockInvoker;
  patientLoader: PatientContextLoader;
  turnLoader: TurnContextLoader;
  sessionCreator: SessionCreator; // INSERTs an interaction_sessions row on first turn
  sessionPersister: SessionPersister;
  modelCallRecorder: ModelCallRecorder;
  alertEnqueuer?: AlertEnqueuer; // optional — handler still works without SQS
  summarizer?: Summarizer; // optional — overflow summarization is skipped if not provided
  rateLimiter?: RateLimiter; // optional — rate limit is skipped if not provided
  // Caregiver-onboarding protocol extraction (T-V2-302). Runs only when a
  // caregiver_onboarding session emits a `complete_session` action. Both
  // are required for the extraction to fire; if either is missing, the
  // handler logs a warning and skips, leaving the session lossy (matches
  // pre-T-V2-302 behavior).
  protocolExtractor?: ProtocolExtractor;
  protocolPersister?: ProtocolPersister;
  // Caregiver attribution (T-V2-303). Resolves event.actorCognitoSub to a
  // users.id UUID so the protocol persister can populate
  // parameter_configs.threshold_set_by. Optional — when not provided,
  // threshold_set_by stays null and protocols are still persisted.
  userResolver?: UserResolver;
  config: HandlerConfig;
  // Pluggable clock for tests; defaults to Date.now
  now?: () => number;
}

// ---------- Orchestrator ----------

export async function handleTurn(event: TurnRequest, deps: HandlerDeps): Promise<TurnResponse> {
  const now = deps.now ?? Date.now;
  const t0 = now();

  validateRequest(event);

  // 0.5. Rate limit check (spec §11.6) — fail fast before any expensive work.
  const softCapReached = await checkRateLimit(event.patientId, deps, now);

  // 1. Load patient context, then try to load turn context. If the session
  //    doesn't exist yet (first turn), INSERT a fresh interaction_sessions
  //    row and use empty defaults. Sequential rather than parallel so a
  //    rejecting turn-load promise can't escape unhandled while we await
  //    the patient load (Node treats those as fatal exits).
  const patientCtx = await deps.patientLoader.load(event.patientId);
  const turnCtx = await loadOrCreateTurnContext(event, patientCtx, deps);

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
  const systemPrompt = loadSystemPrompt(
    selectSystemPromptPath(turnCtx.sessionState.sessionType, deps.config),
  );
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

  // 8c. Caregiver-onboarding protocol extraction (T-V2-302). Fires only on
  //     caregiver_onboarding sessions when the model emits complete_session.
  //     Synchronous so failures and telemetry land in this turn's response;
  //     adds ~3-5s tail latency, which is acceptable for the close-out turn.
  const protocolResult = await maybeExtractAndPersistProtocol({
    sessionType: turnCtx.sessionState.sessionType,
    actions: parsed.actions,
    transcriptHistory: newHistory,
    patientId: patientCtx.patient.id,
    actorCognitoSub: event.actorCognitoSub,
    deps,
  });

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
        patientId: patientCtx.patient.id, // internal patients.id UUID (FK target)
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
            patientId: patientCtx.patient.id, // internal UUID (FK target)
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
    protocolResult?.telemetry
      ? deps.modelCallRecorder.record(
          buildModelCallRecord({
            sessionId: event.sessionId,
            patientId: patientCtx.patient.id,
            tier: 'T3',
            model: deps.config.sonnetModelId,
            streamed: false,
            guardrailBlocked: protocolResult.telemetry.guardrailBlocked,
            usage: protocolResult.telemetry.usage,
            latencyMs: protocolResult.telemetry.latencyMs,
            inferenceRegion: protocolResult.telemetry.inferenceRegion,
            escalationReason: 'caregiver_protocol_design',
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
      softCapReached,
    },
    ...(protocolResult
      ? {
          protocol: {
            extracted: protocolResult.persisted !== null,
            parametersConfigured: protocolResult.persisted?.parametersConfigured ?? 0,
            topicsConfigured: protocolResult.persisted?.topicsConfigured ?? 0,
            topicsSkipped: protocolResult.persisted?.topicsSkipped ?? [],
            error: protocolResult.error ?? null,
          },
        }
      : {}),
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

// Loads the TurnContext for this session. If the session row doesn't exist
// yet (= first turn of a fresh session), INSERTs a fresh interaction_sessions
// row and returns a default empty TurnContext. Other errors propagate.
async function loadOrCreateTurnContext(
  event: TurnRequest,
  patientCtx: PatientContext,
  deps: HandlerDeps,
): Promise<TurnContext> {
  try {
    return await deps.turnLoader.load(event.sessionId, event.transcript);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/No interaction_sessions row/.test(message)) throw err;

    // First turn — create the session row using the resolved internal IDs.
    // Honor sessionType from the request (caregiver_onboarding,
    // caregiver_config) and default to patient_logging when unset.
    const sessionType: SessionType = event.sessionType ?? 'patient_logging';
    await deps.sessionCreator.create({
      sessionId: event.sessionId,
      patientId: patientCtx.patient.id,
      userId: patientCtx.userId,
      sessionType,
      language: event.language,
    });
    return {
      sessionState: {
        sessionId: event.sessionId,
        sessionType,
        language: event.language,
        fsmState: 'CREATED',
        capturedThisSession: [],
        pendingConfirmation: [],
        stillNeeded: [],
      },
      recentTurns: [],
      conversationSummary: null,
      currentTranscript: event.transcript,
    };
  }
}

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
    console.warn('parse_failed_first_attempt', {
      kind: e.kind,
      rawSnippet: first.text.slice(0, 800),
    });
    const stricterBody = appendStrictnessReminder(body);
    const retry = await invoke(stricterBody);
    try {
      return { parsed: parseStructuredOutput(retry.text), meta: retry.meta };
    } catch (e2) {
      const kind = e2 instanceof StructuredOutputParseError ? e2.kind : 'unknown';
      console.warn('parse_failed_after_retry', {
        kind,
        rawSnippet: retry.text.slice(0, 800),
      });
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
  if (
    event.sessionType !== undefined &&
    !['patient_logging', 'caregiver_config', 'caregiver_onboarding'].includes(event.sessionType)
  ) {
    throw new Error(`Invalid sessionType: ${event.sessionType}`);
  }
  if (event.actorCognitoSub !== undefined && typeof event.actorCognitoSub !== 'string') {
    throw new Error(`Invalid actorCognitoSub: must be a string`);
  }
  if (typeof event.actorCognitoSub === 'string' && event.actorCognitoSub.trim() === '') {
    throw new Error(`Invalid actorCognitoSub: empty string`);
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

// Picks the right system prompt for this turn's session type. Caregiver
// onboarding gets a dedicated prompt (T-V2-301) when configured; everything
// else falls back to the default system_v2.md (which has a "Caregiver mode"
// section that handles caregiver_config sessions adequately for pilot —
// caregiver_config gets its own dedicated prompt in a future increment).
function selectSystemPromptPath(
  sessionType: SessionType,
  config: HandlerConfig,
): string {
  if (sessionType === 'caregiver_onboarding' && config.caregiverOnboardingPromptPath) {
    return config.caregiverOnboardingPromptPath;
  }
  return config.systemPromptPath;
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

// Rate limit check (spec §11.6). On hard-cap reached: enqueues caregiver
// alert (best-effort) and throws HandlerError(429). On soft cap reached:
// returns true so the caller can flag softCapReached in response telemetry.
// On allowed-and-under-soft: returns false. No-op (returns false) if no
// rate limiter is wired in deps.
async function checkRateLimit(
  patientId: string,
  deps: HandlerDeps,
  now: () => number,
): Promise<boolean> {
  if (!deps.rateLimiter) return false;
  const decision = await deps.rateLimiter.check(patientId);
  if (!decision.allowed) {
    if (deps.alertEnqueuer) {
      await deps.alertEnqueuer.enqueueRateLimit(
        buildRateLimitAlert({
          patientId,
          callsToday: decision.callsToday,
          hardLimit: deps.config.hardRateLimitPerPatient,
          now: () => new Date(now()),
        }),
      );
    }
    throw new HandlerError(
      429,
      'rate_limit_exceeded',
      `Patient has reached daily call limit (${decision.callsToday} of ${deps.config.hardRateLimitPerPatient}). Lock will release at next UTC midnight.`,
    );
  }
  return decision.softCapReached;
}

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

// Caregiver-onboarding protocol extraction helper (T-V2-302).
//
// Fires only when ALL of the following hold:
//   - sessionType === 'caregiver_onboarding'
//   - parsed actions include a `complete_session`
//   - both protocolExtractor and protocolPersister are wired in deps
//
// Errors here NEVER throw out — a failed extraction is reported as
// `extracted: false` in the response and logged to CloudWatch, but the
// parent turn still returns 200. The transcript stays preserved in
// interaction_sessions.transcript_history so the extraction can be
// re-attempted post-hoc against the same conversation if needed.
async function maybeExtractAndPersistProtocol(args: {
  sessionType: SessionType;
  actions: StructuredOutput['actions'];
  transcriptHistory: Turn[];
  patientId: string; // internal patients.id UUID
  actorCognitoSub: string | undefined;
  deps: HandlerDeps;
}): Promise<{
  persisted: { parametersConfigured: number; topicsConfigured: number; topicsSkipped: string[] } | null;
  error: string | null;
  telemetry: {
    usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
    latencyMs: number;
    guardrailBlocked: boolean;
    inferenceRegion: string;
  } | null;
} | null> {
  if (args.sessionType !== 'caregiver_onboarding') return null;
  const completes = args.actions.some((a) => a.type === 'complete_session');
  if (!completes) return null;
  if (!args.deps.protocolExtractor || !args.deps.protocolPersister) {
    console.warn('protocol_extraction_skipped', {
      reason: 'extractor_or_persister_missing_from_deps',
      patientId: args.patientId,
    });
    return null;
  }

  // Resolve the caregiver's users.id from their Cognito sub (T-V2-303).
  // If actorCognitoSub is missing OR the resolver isn't wired OR the
  // cognito sub doesn't match a users row, threshold_set_by stays null —
  // not an error condition; just an audit-trail gap that downstream
  // tooling already tolerates (the column is nullable).
  let caregiverUserId: string | null = null;
  if (args.actorCognitoSub && args.deps.userResolver) {
    try {
      caregiverUserId = await args.deps.userResolver.resolveInternalId(args.actorCognitoSub);
      if (caregiverUserId === null) {
        console.warn('protocol_actor_unresolved', {
          actorCognitoSub: args.actorCognitoSub,
          patientId: args.patientId,
        });
      }
    } catch (e) {
      console.warn('protocol_actor_resolve_failed', {
        message: e instanceof Error ? e.message : String(e),
      });
      // Fall through with null — better to record the protocol with a
      // missing attribution than to fail the whole turn.
    }
  }

  const now = args.deps.now ?? Date.now;
  const start = now();
  try {
    const { draft, meta } = await args.deps.protocolExtractor.extract(args.transcriptHistory);
    const persisted = await args.deps.protocolPersister.persist(
      args.patientId,
      caregiverUserId,
      draft,
    );
    return {
      persisted,
      error: null,
      telemetry: {
        usage: {
          inputTokens: meta.inputTokens,
          cachedInputTokens: meta.cachedInputTokens,
          outputTokens: meta.outputTokens,
        },
        latencyMs: now() - start,
        guardrailBlocked: meta.guardrailBlocked,
        inferenceRegion: meta.inferenceRegion,
      },
    };
  } catch (e) {
    const code =
      e instanceof ProtocolExtractionError ? `extraction_${e.kind}` : 'persist_or_unknown_error';
    console.error('protocol_extraction_failed', {
      code,
      message: e instanceof Error ? e.message : String(e),
      patientId: args.patientId,
    });
    return {
      persisted: null,
      error: code,
      telemetry: null,
    };
  }
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

    // Rate limit check before context load — same as handleTurn.
    const softCapReached = await checkRateLimit(event.patientId, deps, now);

    // Same sequential get-or-create flow as handleTurn.
    const patientCtx = await deps.patientLoader.load(event.patientId);
    const turnCtx = await loadOrCreateTurnContext(event, patientCtx, deps);

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

    const systemPrompt = loadSystemPrompt(
      selectSystemPromptPath(turnCtx.sessionState.sessionType, deps.config),
    );
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

    // Caregiver-onboarding protocol extraction — same flow as handleTurn.
    const protocolResult = await maybeExtractAndPersistProtocol({
      sessionType: turnCtx.sessionState.sessionType,
      actions: parsed.actions,
      transcriptHistory: newHistory,
      patientId: patientCtx.patient.id,
      actorCognitoSub: event.actorCognitoSub,
      deps,
    });

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
          patientId: patientCtx.patient.id, // internal patients.id UUID (FK target)
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
              patientId: patientCtx.patient.id, // internal UUID
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
      protocolResult?.telemetry
        ? deps.modelCallRecorder.record(
            buildModelCallRecord({
              sessionId: event.sessionId,
              patientId: patientCtx.patient.id,
              tier: 'T3',
              model: deps.config.sonnetModelId,
              streamed: false,
              guardrailBlocked: protocolResult.telemetry.guardrailBlocked,
              usage: protocolResult.telemetry.usage,
              latencyMs: protocolResult.telemetry.latencyMs,
              inferenceRegion: protocolResult.telemetry.inferenceRegion,
              escalationReason: 'caregiver_protocol_design',
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
        softCapReached,
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

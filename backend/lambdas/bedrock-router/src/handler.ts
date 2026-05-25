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
  InvokeResult,
  StreamUsage,
} from './bedrock_client';
import type { AlertEnqueuer, AlertTrigger } from './alert_queue';
import { buildEmergencyAlert, buildRateLimitAlert } from './alert_queue';
import type {
  ModelCallRecorder,
  PivotedPatientLookup,
  SessionCreator,
  SessionPersister,
  SessionUpdate,
} from './db';
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

import { detectEscalation, EscalationSignal, SessionContext as SignalSessionContext, RoutingDecision } from '../escalation/signal_detectors';
import { extractPreModelHints } from './pre_model_hints';
import { renderPatientContext } from './context/per_patient';
import { renderTurnContext, applySlidingWindow } from './context/per_turn';
import { buildBedrockBody, BedrockBody } from './prompt_builder';
import { parseStructuredOutputDetailed, ExtractedValue, StructuredOutput, StructuredOutputParseError } from './parser';
import { applyTransition } from './state_machine';
import { buildModelCallRecord } from './telemetry';
import type { Tier } from './pricing';
import { SseEmitter, emitParsedOutput } from './sse_events';
import type { ProtocolExtractor } from './protocol_extractor';
import { ProtocolExtractionError } from './protocol_extractor';
import type { ProtocolPersister } from './protocol_persister';
import type { UserResolver } from './user_resolver';
import type { ObservationWriter } from './observation_writer';
import type {
  PatientFromVoiceCreator,
  CreatePatientFromVoiceInput,
} from './patient_from_voice';
import { CreatePatientFromVoiceError } from './patient_from_voice';

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
  // F23 — caregiver-supplied patient credentials collected via the
  // form modal that fires when the LLM emits pause_session with
  // reason='awaiting_patient_credentials'. Client sends these on every
  // turn after collection so the handler has them when the pivot turn
  // (complete_session in PROFILE_CONFIRMED) fires create-patient-from-voice.
  // Never persisted server-side — passed straight through to the
  // create-patient-from-voice Lambda invocation.
  patientCredentials?: {
    email: string;
    phone: string;
  };
  clientHints?: {
    preferStreaming?: boolean;
    deviceLatencyEstimateMs?: number;
  };
}

// F23 — sentinel patientId prefix that marks "no patient row exists
// yet, this is a caregiver_onboarding session in profile-extraction
// phase." The bedrock-router resolves this against the placeholder
// session row (NULL patient_id allowed by V008 migration). After the
// mid-session pivot the caregiver_onboarding session's patient_id
// column is UPDATEd to the real UUID, so the same pending-<sessionId>
// patientId on subsequent turns transparently resolves to the real
// patient context.
export const PENDING_PATIENT_ID_PREFIX = 'pending-';

export function isPendingPatientId(patientId: string): boolean {
  return patientId.startsWith(PENDING_PATIENT_ID_PREFIX);
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
  // Present only on turns that confirmed at least one extracted value
  // (T-V2-304 — confirmed-value → FHIR Observation bridge). Absent
  // when no values were confirmed this turn.
  observations?: {
    written: number;
    failed: number;
    s3Keys: string[];
    errors: string[];
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
  caregiverOnboardingPromptPath?: string; // optional — resolved path to prompts/system_v2_caregiver_onboarding.md (post-pivot protocol-extraction phase)
  // F23 — profile-extraction prompt for the pre-pivot phase of a
  // caregiver_onboarding session. Selected when fsmState is one of
  // {EXTRACTING_PROFILE, AWAITING_PROFILE_CONFIRMATION}. After the
  // mid-session pivot (PROFILE_CONFIRMED → EXTRACTING transition),
  // the existing caregiverOnboardingPromptPath takes over for the
  // protocol-extraction half of the session.
  caregiverOnboardingProfilePromptPath?: string;
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
  // Confirmed-value → FHIR Observation bridge (T-V2-304). Each
  // extractedValue with status='confirmed' becomes a FHIR R4
  // Observation in S3 at the same key convention v1 sync-observation
  // uses. Optional — when missing the writes are skipped and the
  // transcript remains the source of truth.
  observationWriter?: ObservationWriter;
  // F23 — voice-extracted patient creation. Invoked when a
  // caregiver_onboarding session emits complete_session in the
  // profile-extraction phase. Optional — when missing, the handler
  // surfaces an internal_error to the caller and the session stays
  // in AWAITING_PROFILE_CONFIRMATION (caregiver can retry or bail).
  patientFromVoiceCreator?: PatientFromVoiceCreator;
  // F23 — post-pivot patient resolution. Lets the handler transparently
  // switch from the placeholder PatientContext stub to the real one
  // once `interaction_sessions.patient_id` has been UPDATEd by
  // create-patient-from-voice. Optional — when missing, placeholder
  // sessions stay in placeholder mode forever (acceptable for tests,
  // not for prod).
  pivotedPatientLookup?: PivotedPatientLookup;
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
  //
  // F23 — placeholder bootstrap. caregiver_onboarding sessions whose
  // patientId is the `pending-<sessionId>` sentinel get a synthetic
  // PatientContext stub instead of a real DB lookup. The stub stays
  // in effect until the mid-session pivot, after which subsequent
  // turns resolve via the session row's now-non-NULL patient_id.
  // `let` rather than `const` because the F23 mid-session pivot
  // refreshes this in place when create-patient-from-voice succeeds.
  let patientCtx = await loadPatientContextOrPlaceholder(event, deps);
  const turnCtx = await loadOrCreateTurnContext(event, patientCtx, deps);

  // F42 (2026-05-17): credentials-arrived auto-resume.
  //
  // The caregiver_onboarding profile prompt instructs the LLM to
  // pause_session with reason='awaiting_patient_credentials' between
  // Stages 6 and 8 — `fsmState` lands at PAUSED. The Android client
  // surfaces a form modal, caches the credentials, and attaches them
  // to the NEXT TurnRequest as the structural `patientCredentials`
  // field. But the transcript on that next turn ("I'm done", "yes",
  // "please continue") carries no signal that credentials were
  // collected, and the LLM has no way to read the structural field,
  // so it proposes PAUSED -> PAUSED and applyTransition rejects with
  // StateTransitionError. Without this short-circuit the session
  // wedges (see 2026-05-17 voice bench, RequestId
  // 33b4d5b8-b9b4-44ef-b8fa-f7e5efdcbed0).
  //
  // Fix: when we see credentials on the wire AND we're sitting in
  // PAUSED on a placeholder caregiver_onboarding session, hot-rotate
  // fsmState to EXTRACTING_PROFILE in-memory (an allowed PAUSED
  // successor per state_machine.ts) and prepend a directive so the
  // LLM resumes profile collection toward the Stage 8 readback.
  const credentialsJustArrived =
    event.patientCredentials !== undefined &&
    turnCtx.sessionState.fsmState === 'PAUSED' &&
    isCaregiverSession(turnCtx.sessionState.sessionType) &&
    (patientCtx.placeholder ?? false);
  if (credentialsJustArrived) {
    console.info('credentials_received_auto_resume', {
      sessionId: event.sessionId,
      priorFsmState: turnCtx.sessionState.fsmState,
      hotRotatedTo: 'EXTRACTING_PROFILE',
    });
    turnCtx.sessionState.fsmState = 'EXTRACTING_PROFILE';
  }

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
    selectSystemPromptPath(turnCtx.sessionState.sessionType, turnCtx.sessionState.fsmState, deps.config, patientCtx.placeholder ?? false),
  );
  const perPatientBlock = renderPatientContext(patientCtx);
  const baseTurnBlock = renderTurnContext(turnCtx);
  const subprompt = routing.reason
    ? loadEscalationSubprompt(deps.config.escalationSubpromptDir, routing.reason)
    : null;
  // F42 — directive when credentials just arrived. Tells the LLM the
  // structural field is now populated and to move toward Stage 8
  // readback. Without this the model often parrots the pause prompt.
  const credentialsResumeDirective = credentialsJustArrived
    ? [
        '## Patient credentials just arrived',
        '',
        'The caregiver completed the email/phone form modal you triggered with `pause_session`. The structural `patientCredentials` payload is now populated. Resume profile collection where you left off:',
        '- Do NOT propose `PAUSED -> PAUSED` and do NOT re-pause with `awaiting_patient_credentials`.',
        '- Proceed to Stage 8 — deliver the final readback ("To confirm: <name>, <age> years, <gender>, with <conditions>. Email <email>, phone <phone>. Should I create the profile?") and propose `EXTRACTING_PROFILE -> AWAITING_PROFILE_CONFIRMATION`.',
        '- If any required profile fields are still missing, ask for those first and stay in `EXTRACTING_PROFILE`.',
      ].join('\n')
    : null;
  const turnBlockWithCredentials = credentialsResumeDirective
    ? `${credentialsResumeDirective}\n\n${baseTurnBlock}`
    : baseTurnBlock;
  const perTurnBlock = subprompt ? `${subprompt}\n\n${turnBlockWithCredentials}` : turnBlockWithCredentials;
  const body = buildBedrockBody({
    systemPrompt,
    perPatientBlock,
    perTurnBlock,
    maxTokens: deps.config.maxTokens,
  });

  // 5. Invoke Bedrock + parse with one retry on parse failure (spec §6.4).
  const tier: Tier = routing.tier;
  const modelId = tier === 'T3' ? deps.config.sonnetModelId : deps.config.haikuModelId;
  // Guardrail policy is targeted at patient-logging interactions —
  // medical-diagnosis-or-prescription topics fire fuzzily on caregivers
  // describing a patient's existing regimen ("he takes Amlodipine 5mg
  // every morning"), which is a necessary part of caregiver onboarding.
  // The caregiver system prompt already forbids vital-logging or
  // prescriptive output, so dropping the Guardrail here doesn't widen
  // any meaningful threat surface for v2.0.
  const guardrailId = isCaregiverSession(turnCtx.sessionState.sessionType)
    ? undefined
    : deps.config.guardrailId;
  const guardrailVersion = isCaregiverSession(turnCtx.sessionState.sessionType)
    ? undefined
    : deps.config.guardrailVersion;
  const invokeStart = now();
  const { parsed, meta: result, guardrailBlocked: guardrailShortCircuited } = await invokeWithRetry(
    body,
    async (b) => {
      const r = await deps.bedrock.invoke({
        modelId,
        body: b,
        guardrailId,
        guardrailVersion,
        configuredRegion: deps.config.inferenceRegion,
      });
      return { text: r.responseText, meta: r };
    },
    turnCtx.sessionState.language,
  );
  const latencyMs = now() - invokeStart;

  // F19 — Bedrock Guardrail intervention short-circuits the structured-
  // output flow. parsed.responseText carries the configured
  // blocked_input_messaging copy; FSM state, captured values, and
  // observation writes all stay frozen for this turn (the user's input
  // was rejected — there is nothing to advance). Telemetry + alert path
  // still fire so the model_call row marks guardrail_blocked=true and
  // the caregiver gets the standard guardrail_block alert.
  if (guardrailShortCircuited) {
    return await respondGuardrailBlocked({
      event,
      patientCtx,
      turnCtx,
      tier,
      modelId,
      latencyMs,
      result,
      routing,
      blockedResponseText: parsed.responseText,
      softCapReached,
      deps,
      now,
    });
  }

  // 7. Apply state transition (validates FROM matches current state).
  // `let` rather than `const` — the F57 patient-logging guard below
  // may rewrite parsed.stateTransition (and therefore the resolved
  // newFsmState) after suppressing a premature complete_session.
  let newFsmState = applyTransition(turnCtx.sessionState.fsmState, parsed.stateTransition);

  // 7a. F23 — caregiver_onboarding mid-session pivot. When the LLM
  //     finishes the profile readback and emits complete_session,
  //     invoke create-patient-from-voice and refresh patientCtx with
  //     the real post-pivot patient. The downstream logic (model_call
  //     record, session persister, protocol extraction) then runs
  //     against the real patient.
  //
  //     We DELIBERATELY do NOT require newFsmState === PROFILE_CONFIRMED
  //     here. Haiku's stateTransition declaration is unreliable on the
  //     readback turn — empirically (2026-05-10 smoke run, session
  //     ffb3d390) it emits complete_session while still declaring
  //     EXTRACTING_PROFILE or AWAITING_PROFILE_CONFIRMATION, which
  //     would skip the pivot and fall through to protocol-extraction
  //     with patientId='' (placeholder), failing with
  //     `invalid input syntax for type uuid: ""`. The action itself
  //     (complete_session on a placeholder session) is the real signal
  //     of intent to finalize — trust it. patientProfile + credentials
  //     completeness is validated by the pivot input checks below;
  //     create-patient-from-voice rejects empty name etc. on its end.
  let pivotedThisTurn = false;
  // F23 — if the LLM emits complete_session on a placeholder session but
  // forgets the patientProfile block (Haiku flake; the prompt requires
  // patientProfile on every post-turn-1 response, but empirically it
  // sometimes drops the block on the closing turn — session 4ef3f90b on
  // 2026-05-10 was the live repro), don't throw. Strip complete_session
  // from actions and overwrite responseText with a recovery prompt so the
  // conversation continues. The caregiver re-confirms; the LLM gets a
  // second chance to include patientProfile. Without this fix the session
  // is permanently wedged (fsm_state advances post-PROFILE_CONFIRMED but
  // patient_id stays NULL forever).
  const wantsPivotButNoProfile =
    patientCtx.placeholder &&
    parsed.actions.some((a) => a.type === 'complete_session') &&
    !parsed.patientProfile;
  if (wantsPivotButNoProfile) {
    console.warn('placeholder_complete_session_missing_patientProfile_recovery', {
      sessionId: event.sessionId,
      llmResponseText: parsed.responseText?.slice(0, 200),
      llmActions: parsed.actions.map((a) => a.type),
    });
    parsed.actions = parsed.actions.filter((a) => a.type !== 'complete_session');
    parsed.responseText =
      "I'm sorry — I lost the profile details just then. Could you say her name and age one more time so I can confirm and save?";
  }

  // F57 handler-side guard — for patient_logging sessions, suppress
  // `complete_session` if any active parameter in the patient's
  // monitoring protocol has no confirmed value captured yet in this
  // session. Prompt-side fix alone (system_v2.md rule 12) is unreliable
  // because Haiku tends to wrap up after a single confirm; this
  // programmatic guard ensures the session walks the full protocol.
  // Computed from `patientCtx.protocol` (active configured set) +
  // session capturedThisSession + this turn's parsed.extractedValues.
  if (
    turnCtx.sessionState.sessionType === 'patient_logging' &&
    parsed.actions.some((a) => a.type === 'complete_session') &&
    patientCtx.protocol &&
    patientCtx.protocol.length > 0
  ) {
    const activeParams = patientCtx.protocol
      .filter((p) => p.active)
      .map((p) => p.parameterName);
    const confirmedThisSession = new Set<string>([
      ...turnCtx.sessionState.capturedThisSession
        .filter((v) => v.status === 'confirmed')
        .map((v) => v.parameter),
      ...parsed.extractedValues
        .filter((v) => v.status === 'confirmed')
        .map((v) => v.parameter),
    ]);
    const stillUnlogged = activeParams.filter(
      (p) => !confirmedThisSession.has(p),
    );
    if (stillUnlogged.length > 0) {
      console.warn('patient_logging_premature_complete_session_suppressed', {
        sessionId: event.sessionId,
        activeParams,
        confirmedThisSession: Array.from(confirmedThisSession),
        stillUnlogged,
        llmResponseText: parsed.responseText?.slice(0, 200),
      });
      parsed.actions = parsed.actions.filter(
        (a) => a.type !== 'complete_session',
      );
      // Replace the LLM's close-out response with a prompt for the next
      // unlogged vital. Use the first remaining parameter as the prompt
      // target — the LLM will refine wording on the next turn.
      const nextParam = stillUnlogged[0];
      const friendly = nextParam.replace(/_/g, ' ');
      parsed.responseText = `Saved. Next, what is your ${friendly}?`;
      // Rewrite stateTransition so the client FSM badge doesn't render
      // "COMPLETE" while the session is actually continuing. Drop to
      // EXTRACTING — the next user utterance will move it back through
      // PENDING_CONFIRMATION naturally. Recompute newFsmState so the
      // override actually lands on what gets persisted + returned to the
      // client (without this, the badge still showed COMPLETE because
      // newFsmState was locked in at step 7 above).
      parsed.stateTransition = `${turnCtx.sessionState.fsmState} -> EXTRACTING`;
      newFsmState = applyTransition(turnCtx.sessionState.fsmState, parsed.stateTransition);
    }
  }

  const isPivotTurn =
    patientCtx.placeholder &&
    parsed.actions.some((a) => a.type === 'complete_session');
  if (isPivotTurn) {
    if (!parsed.patientProfile) {
      // Defense in depth — the recovery above should have caught this.
      throw new HandlerError(
        500,
        'profile_pivot_missing_patientProfile',
        'caregiver_onboarding pivot turn produced no patientProfile in structured output',
      );
    }
    if (!event.patientCredentials) {
      throw new HandlerError(
        400,
        'profile_pivot_missing_credentials',
        'patientCredentials (email + phone) required on the caregiver_onboarding pivot turn',
      );
    }
    if (!event.actorCognitoSub) {
      throw new HandlerError(
        400,
        'profile_pivot_missing_actor',
        'actorCognitoSub required on caregiver_onboarding turns',
      );
    }
    if (!deps.patientFromVoiceCreator) {
      throw new HandlerError(
        500,
        'profile_pivot_creator_not_wired',
        'patientFromVoiceCreator dependency not configured',
      );
    }
    const pivotInput: CreatePatientFromVoiceInput = {
      sessionId: event.sessionId,
      caregiverCognitoSub: event.actorCognitoSub,
      patientProfile: parsed.patientProfile,
      patientCredentials: event.patientCredentials,
    };
    try {
      const pivotResult = await deps.patientFromVoiceCreator.create(pivotInput);
      console.log('caregiver_onboarding pivot ok', {
        sessionId: event.sessionId,
        patientCognitoSub: pivotResult.patientCognitoSub,
        patientShortId: pivotResult.patientShortId,
      });
      // Refresh context with the real patient. Subsequent code paths
      // get a real id + userId; placeholder=false naturally because
      // patientLoader.load doesn't set the flag.
      patientCtx = await deps.patientLoader.load(pivotResult.patientCognitoSub);
      pivotedThisTurn = true;
    } catch (err) {
      // CreatePatientFromVoiceError carries a typed kind. The handler
      // surfaces it as a HandlerError with the kind embedded in the
      // code so the client can distinguish disambiguation flows
      // (e.g., 409 patient_already_exists prompts re-asking the
      // caregiver) from hard failures.
      if (err instanceof CreatePatientFromVoiceError) {
        throw new HandlerError(
          err.statusCode,
          `profile_pivot_${err.kind}`,
          err.message,
        );
      }
      throw err;
    }
  }

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
  //
  //     F23 — skip on the pivot turn. The pivot turn ALSO emits
  //     complete_session (closing the profile-extraction phase), but
  //     protocol extraction belongs to the FINAL complete_session
  //     that closes the protocol-extraction phase. Without this gate,
  //     T-V2-302 would fire against an empty post-profile transcript
  //     and persist a malformed (empty) protocol.
  const protocolResult = pivotedThisTurn
    ? null
    : await maybeExtractAndPersistProtocol({
        sessionType: turnCtx.sessionState.sessionType,
        actions: parsed.actions,
        transcriptHistory: newHistory,
        patientId: patientCtx.patient.id,
        actorCognitoSub: event.actorCognitoSub,
        deps,
      });

  // 8d. Confirmed values → FHIR Observations (S3). Per-value try/catch
  //     so a single bad write doesn't fail the whole turn — the
  //     transcript still has the data and the bridge can re-run later
  //     post-hoc.
  const observationResult = await maybeWriteFhirObservations({
    extractedValues: parsed.extractedValues,
    patientCognitoSub: event.patientId,
    patientInternalId: patientCtx.patient.id,
    sessionId: event.sessionId,
    observedAt: new Date(now()),
    writer: deps.observationWriter,
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

  // F2 — derive lifecycle terminus from this turn's actions. The LLM
  // emits `complete_session` when the protocol is done, and we treat
  // any emergency-triggered turn as terminal-incomplete (the session
  // is supposed to end at that point per spec §6.5). Otherwise leave
  // status/ended_at untouched and the row stays 'in_progress'.
  const sessionTerminus = computeSessionTerminus({
    actions: parsed.actions,
    emergencyTriggered: emergencyTriggers.length > 0,
    now: () => new Date(now()),
  });

  // F23 — model_call.patient_id is NOT NULL FK; on placeholder turns
  // (caregiver_onboarding profile-extraction, before pivot) we have
  // no real patient row to reference. Skip the telemetry recording
  // for those turns. The 5-10 turn telemetry gap during profile
  // extraction is acceptable; full coverage resumes post-pivot.
  const skipPatientBoundTelemetry = patientCtx.placeholder;

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
      status: sessionTerminus.status,
      endedAt: sessionTerminus.endedAt,
    }),
    skipPatientBoundTelemetry
      ? Promise.resolve()
      : deps.modelCallRecorder.record(
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
    summarizerTelemetry && !skipPatientBoundTelemetry
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
    protocolResult?.telemetry && !skipPatientBoundTelemetry
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
    ...(observationResult.written > 0 || observationResult.failed > 0
      ? { observations: observationResult }
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

// F19 — Build the 200 response when Bedrock's Guardrail intervened on
// the user's input. The blocked-input copy comes from
// `blockedResponseText` (Bedrock inlines the configured
// `blocked_input_messaging` into the response). FSM state, captured
// values, pending confirmations, and stillNeeded are all returned
// unchanged from `turnCtx.sessionState`. We still:
//   - record a model_call row with guardrail_blocked=true (cost &
//     audit trail);
//   - enqueue a guardrail_block emergency alert (per spec §11.5).
// We do NOT call sessionPersister.update — the FSM didn't move, no
// transcript was appended, no pending values changed. The session row
// stays in the same shape it was before this turn.
async function respondGuardrailBlocked(args: {
  event: TurnRequest;
  patientCtx: PatientContext;
  turnCtx: TurnContext;
  tier: Tier;
  modelId: string;
  latencyMs: number;
  result: InvokeResult;
  routing: RoutingDecision;
  blockedResponseText: string;
  softCapReached: boolean;
  deps: HandlerDeps;
  now: () => number;
}): Promise<TurnResponse> {
  const { event, patientCtx, turnCtx, tier, modelId, latencyMs, result, routing, blockedResponseText, softCapReached, deps, now } = args;

  // Guardrail block always raises the guardrail_block trigger;
  // detectEmergencyTriggers also folds in routing reason (e.g. an
  // emergency keyword in the same blocked utterance).
  const emergencyTriggers = detectEmergencyTriggers(routing.reason, null, true);
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
    deps.modelCallRecorder.record(
      buildModelCallRecord({
        sessionId: event.sessionId,
        patientId: patientCtx.patient.id, // internal patients.id UUID (FK target)
        tier,
        model: modelId,
        streamed: false,
        guardrailBlocked: true,
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
    alertPromise,
  ]);

  const responseBody: TurnResponseBody = {
    responseText: blockedResponseText,
    ttsHints: { language: turnCtx.sessionState.language, spellOutNumbers: false },
    extractedValues: [],
    sessionState: {
      capturedThisSession: turnCtx.sessionState.capturedThisSession,
      pendingConfirmation: turnCtx.sessionState.pendingConfirmation,
      stillNeeded: turnCtx.sessionState.stillNeeded,
      fsmState: turnCtx.sessionState.fsmState,
    },
    actions: [],
    telemetry: {
      tier,
      model: modelId,
      latencyMs,
      inputTokens: result.inputTokens,
      cachedInputTokens: result.cachedInputTokens,
      outputTokens: result.outputTokens,
      guardrailBlocked: true,
      inferenceRegion: result.inferenceRegion,
      escalationReason: routing.reason,
      softCapReached,
    },
  };

  return { statusCode: 200, body: JSON.stringify(responseBody) };
}

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
    // F23 — placeholder context bootstrap. patient_id is NULL until
    // create-patient-from-voice fires the mid-session pivot. V008
    // migration's CHECK constraint enforces that NULL is only valid
    // for caregiver_onboarding session_type at the database layer.
    const patientIdForInsert: string | null = patientCtx.placeholder
      ? null
      : patientCtx.patient.id;
    await deps.sessionCreator.create({
      sessionId: event.sessionId,
      patientId: patientIdForInsert,
      userId: patientCtx.userId,
      sessionType,
      language: event.language,
    });
    return {
      sessionState: {
        sessionId: event.sessionId,
        sessionType,
        language: event.language,
        // F23 — caregiver_onboarding placeholder sessions start in
        // EXTRACTING_PROFILE so the first LLM turn picks the profile-
        // extraction prompt. All other sessions start in CREATED.
        fsmState: patientCtx.placeholder ? 'EXTRACTING_PROFILE' : 'CREATED',
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

// F23 — picks between a real patientLoader.load() and a synthetic
// placeholder PatientContext stub for caregiver_onboarding sessions
// before create-patient-from-voice has fired the mid-session pivot.
//
// The placeholder fires when:
//   - sessionType === 'caregiver_onboarding'
//   - AND patientId starts with the `pending-` sentinel prefix
//
// On the FIRST turn, the session row doesn't exist yet, so the stub
// is the only path. On SUBSEQUENT turns we re-check via the session
// row's patient_id column — if it's been UPDATEd by the pivot, we
// load the real patient now (transparent to the client, which keeps
// sending pending-<sessionId>).
async function loadPatientContextOrPlaceholder(
  event: TurnRequest,
  deps: HandlerDeps,
): Promise<PatientContext> {
  // F23 — the `pending-<sessionId>` sentinel itself is the placeholder
  // signal. It can never be a real cognito_sub, so its presence alone
  // is unambiguous. Don't gate on sessionType — the Android state
  // machine sends sessionType only on turn 1 (turns 2+ omit it so the
  // server doesn't think the session-type is mutable), which would
  // break the placeholder path for every turn after the first.
  const isPendingSentinel = isPendingPatientId(event.patientId);

  if (!isPendingSentinel) {
    return await deps.patientLoader.load(event.patientId);
  }

  // Pending sentinel on a caregiver_onboarding session. Try to load
  // the session row first — if its patient_id has been pivoted to a
  // real UUID, load that patient instead of returning the stub.
  // Reuse the turn loader's session lookup for this; it returns a
  // structured error when the session row is missing.
  const realPatientCognitoSub = await tryReadPivotedPatientCognitoSub(event.sessionId, deps);
  if (realPatientCognitoSub) {
    return await deps.patientLoader.load(realPatientCognitoSub);
  }

  // F23 — placeholder session row needs a real users.id for the
  // user_id column (V008 only relaxed patient_id, not user_id).
  // Resolve the caregiver's actorCognitoSub now so the synthetic
  // PatientContext carries it through to loadOrCreateTurnContext's
  // INSERT. Throws if unresolvable — placeholder sessions cannot
  // proceed without an attributable caregiver.
  if (!event.actorCognitoSub) {
    throw new HandlerError(
      400,
      'invalid_request',
      'caregiver_onboarding placeholder session requires actorCognitoSub',
    );
  }
  if (!deps.userResolver) {
    throw new HandlerError(
      500,
      'internal_error',
      'caregiver_onboarding placeholder session requires userResolver in deps',
    );
  }
  const caregiverUserId = await deps.userResolver.resolveInternalId(event.actorCognitoSub);
  if (!caregiverUserId) {
    throw new HandlerError(
      404,
      'caregiver_not_found',
      `No users row for actorCognitoSub=${event.actorCognitoSub}`,
    );
  }

  return buildPlaceholderPatientContext(event, caregiverUserId);
}

// Helper extracted so tests can stub the lookup. Returns null if the
// session row doesn't exist OR its patient_id is still NULL (pre-pivot).
// Returns the patient's cognito_sub when post-pivot.
async function tryReadPivotedPatientCognitoSub(
  sessionId: string,
  deps: HandlerDeps,
): Promise<string | null> {
  if (!deps.pivotedPatientLookup) return null;
  return await deps.pivotedPatientLookup.lookup(sessionId);
}

// F23 — synthetic PatientContext used while the placeholder
// caregiver_onboarding session is in profile-extraction phase.
// patient.id is empty (sentinel — patient row doesn't exist yet);
// userId is the caregiver's internal users.id so the placeholder
// interaction_sessions row's user_id FK points somewhere real.
// PatientContext.placeholder = true is the load-bearing flag
// downstream code keys off of.
//
// The patient's profile-fields-as-they're-being-captured live in the
// LLM's structured-output `patientProfile` block on the WIRE, not in
// this context. The handler doesn't accumulate them here — it only
// reads patientProfile from the closing turn (PROFILE_CONFIRMED +
// complete_session) and forwards to create-patient-from-voice.
function buildPlaceholderPatientContext(
  event: TurnRequest,
  caregiverUserId: string,
): PatientContext {
  return {
    patient: {
      id: '',
      name: 'New patient',
      age: 0,
      gender: 'other',
      primaryLanguage: event.language,
      conditions: [],
      medicalHistorySummary: null,
    },
    userId: caregiverUserId,
    protocol: [],
    topics: [],
    recentSessions: [],
    pendingRecommendations: [],
    placeholder: true,
  };
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
//
// F19 — when Bedrock's Guardrail intervenes, the response carries the
// configured `blocked_input_messaging` copy verbatim (no `<output>`
// envelope, no `usage`). The parser would fail and `invokeWithRetry`
// would surface a 503 to the caller. We detect this from the meta
// (`guardrailBlocked` for non-streaming, `stopReason` ===
// 'guardrail_intervened' for streaming), short-circuit the parser, and
// return a synthetic StructuredOutput. The caller sees
// `guardrailBlocked: true` in the result and is responsible for
// skipping FSM transition + capture/observation merges (none of which
// apply when the user's input was rejected).
async function invokeWithRetry<R>(
  body: BedrockBody,
  invoke: (body: BedrockBody) => Promise<{ text: string; meta: R }>,
  language: SessionState['language'],
): Promise<{ parsed: StructuredOutput; meta: R; guardrailBlocked: boolean }> {
  const first = await invoke(body);
  if (isGuardrailBlockedMeta(first.meta)) {
    console.warn('guardrail_blocked_short_circuit', {
      rawSnippet: first.text.slice(0, 400),
    });
    return {
      parsed: buildGuardrailBlockedStub(first.text, language),
      meta: first.meta,
      guardrailBlocked: true,
    };
  }
  try {
    const detailed = parseStructuredOutputDetailed(first.text);
    if (detailed.source === 'recovered_bare_json') {
      // The model dropped the <output> envelope but the body was a
      // valid JSON object that matched the schema. Invisible recovery
      // for the user; flag for telemetry so we can track drift rate.
      console.warn('parse_recovered_bare_json', {
        rawSnippet: first.text.slice(0, 400),
      });
    }
    return { parsed: detailed.parsed, meta: first.meta, guardrailBlocked: false };
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
    if (isGuardrailBlockedMeta(retry.meta)) {
      // Same input → guardrail almost always blocks again on retry.
      // Short-circuit here too rather than throwing parse_failed_after_retry.
      console.warn('guardrail_blocked_short_circuit_on_retry', {
        rawSnippet: retry.text.slice(0, 400),
      });
      return {
        parsed: buildGuardrailBlockedStub(retry.text, language),
        meta: retry.meta,
        guardrailBlocked: true,
      };
    }
    try {
      const detailed = parseStructuredOutputDetailed(retry.text);
      if (detailed.source === 'recovered_bare_json') {
        console.warn('parse_recovered_bare_json_on_retry', {
          rawSnippet: retry.text.slice(0, 400),
        });
      }
      return { parsed: detailed.parsed, meta: retry.meta, guardrailBlocked: false };
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

// Sentinel emitted by buildGuardrailBlockedStub. The handler must
// detect `result.guardrailBlocked === true` BEFORE applyTransition;
// applyTransition will throw on this string, which is the intended
// failure mode if anyone wires the stub through the FSM by mistake.
export const GUARDRAIL_NOOP_TRANSITION = '__GUARDRAIL_NOOP__';

// Detects "Bedrock's guardrail intervened" via either of the two
// signals the SDK / streaming protocol expose. Used by both the
// sync-invoke meta (`guardrailBlocked: true`) and the streaming meta
// (`stopReason === 'guardrail_intervened'`).
function isGuardrailBlockedMeta<R>(meta: R): boolean {
  if (typeof meta !== 'object' || meta === null) return false;
  const m = meta as { guardrailBlocked?: boolean; stopReason?: string | null };
  return m.guardrailBlocked === true || m.stopReason === 'guardrail_intervened';
}

// Synthesizes a StructuredOutput from a guardrail-blocked Bedrock
// response. The blocked-input copy lives in `responseText` (Bedrock
// inlines the configured blocked_input_messaging there). FSM /
// extracted-values / actions are all empty — the user's input was
// rejected, so nothing in this turn should advance state.
function buildGuardrailBlockedStub(
  blockedMessageText: string,
  language: SessionState['language'],
): StructuredOutput {
  return {
    responseText: blockedMessageText,
    ttsHints: { language, spellOutNumbers: false },
    extractedValues: [],
    actions: [],
    stateTransition: GUARDRAIL_NOOP_TRANSITION,
    escalationReason: null,
  };
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
  fsmState: SessionState['fsmState'],
  config: HandlerConfig,
  isPlaceholderCtx: boolean,
): string {
  if (sessionType === 'caregiver_onboarding') {
    // F23 — the placeholder PatientContext is the load-bearing signal
    // for "pre-pivot profile-extraction phase". Pin the profile prompt
    // for every turn while placeholder is in effect, regardless of the
    // fsmState the LLM happens to have declared. Empirically Haiku
    // drifts the fsmState to PAUSED (after pause_session) or
    // EXTRACTING (after a too-eager state transition) while we're
    // still in the pre-pivot phase — that would have switched the
    // prompt to the protocol-extraction one, the LLM would have
    // followed THAT prompt's stages, and the pivot would never fire.
    // Repro: 2026-05-10 session 72f34a82 — fsmState went PAUSED →
    // EXTRACTING → PENDING_CONFIRMATION → COMPLETE while patient_id
    // stayed NULL.
    if (isPlaceholderCtx && config.caregiverOnboardingProfilePromptPath) {
      return config.caregiverOnboardingProfilePromptPath;
    }
    // Fallback to fsmState-based selection (kept for the post-pivot
    // turn that may still come through this function with a stale
    // closure on the now-real patientCtx).
    const isProfilePhase =
      fsmState === 'EXTRACTING_PROFILE' ||
      fsmState === 'AWAITING_PROFILE_CONFIRMATION';
    if (isProfilePhase && config.caregiverOnboardingProfilePromptPath) {
      return config.caregiverOnboardingProfilePromptPath;
    }
    if (config.caregiverOnboardingPromptPath) {
      return config.caregiverOnboardingPromptPath;
    }
  }
  return config.systemPromptPath;
}

// Caregiver sessions skip the Guardrail (see comment on the call site in
// handleTurn). Both caregiver_onboarding and caregiver_config qualify
// because both are setup conversations, not patient-facing health advice.
function isCaregiverSession(sessionType: SessionType): boolean {
  return sessionType === 'caregiver_onboarding' || sessionType === 'caregiver_config';
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

// F2 — derive interaction_sessions.{status, ended_at} from this turn's
// outcome. Returns nulls when the session should stay open; the
// PgSessionPersister's COALESCE then preserves existing column values.
//
// Mapping:
//   complete_session action       → status='complete'
//   any emergency trigger fired   → status='incomplete' (per spec §6.5
//                                   "session ends immediately")
//   pause_session                 → status='paused'
//   anything else                 → status=null (= leave 'in_progress')
//
// 'incomplete' is the existing CHECK enum from V004 — covers both
// emergency-terminated and idle-timeout. We don't introduce a new
// 'terminal_emergency' status to avoid a migration; the
// escalations_triggered JSONB already carries the emergency reason.
export function computeSessionTerminus(args: {
  actions: StructuredOutput['actions'];
  emergencyTriggered: boolean;
  now: () => Date;
}): { status: SessionUpdate['status']; endedAt: Date | null } {
  const completes = args.actions.some((a) => a.type === 'complete_session');
  const pauses = args.actions.some((a) => a.type === 'pause_session');
  if (args.emergencyTriggered) return { status: 'incomplete', endedAt: args.now() };
  if (completes) return { status: 'complete', endedAt: args.now() };
  if (pauses) return { status: 'paused', endedAt: null };
  return { status: null, endedAt: null };
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

// Confirmed-value → FHIR Observation bridge (T-V2-304).
//
// For each extractedValue with status='confirmed' on this turn, write a
// FHIR R4 Observation to S3. Per-value try/catch: a single S3 hiccup
// fails its own write but doesn't break the turn — the transcript still
// contains the data and the bridge can re-run later.
//
// Skip entirely when:
//   - no observationWriter is wired (deps optional for backwards-compat
//     and tests)
//   - the turn produced zero confirmed values
async function maybeWriteFhirObservations(args: {
  extractedValues: ExtractedValue[];
  patientCognitoSub: string;
  patientInternalId: string;
  sessionId: string;
  observedAt: Date;
  writer: ObservationWriter | undefined;
}): Promise<{
  written: number;
  failed: number;
  s3Keys: string[];
  errors: string[];
}> {
  const empty = { written: 0, failed: 0, s3Keys: [] as string[], errors: [] as string[] };
  if (!args.writer) return empty;
  const confirmed = args.extractedValues.filter((v) => v.status === 'confirmed');
  if (confirmed.length === 0) return empty;

  const result = { ...empty };
  for (const value of confirmed) {
    try {
      const { s3Key } = await args.writer.write({
        patientCognitoSub: args.patientCognitoSub,
        patientInternalId: args.patientInternalId,
        sessionId: args.sessionId,
        value,
        observedAt: args.observedAt,
      });
      result.written++;
      result.s3Keys.push(s3Key);
    } catch (e) {
      result.failed++;
      const message = e instanceof Error ? e.message : String(e);
      result.errors.push(`${value.parameter}: ${message}`);
      console.error('fhir_observation_write_failed', {
        parameter: value.parameter,
        sessionId: args.sessionId,
        patientCognitoSub: args.patientCognitoSub,
        message,
      });
    }
  }
  return result;
}

// ---------- Streaming handler ----------
//
// SSE-based variant. Architecture is in place; events emit AFTER the full
// `<output>` block has been received and parsed (Option B in the design
// notes). Real incremental sentence-by-sentence streaming requires a
// prompt-format change (move responseText outside the JSON block) — flagged
// as a follow-up.
//
// F23 follow-up: this streaming handler does NOT implement the
// caregiver_onboarding mid-session pivot (PROFILE_CONFIRMED +
// complete_session → invoke create-patient-from-voice + refresh
// patientCtx). Android clients routing caregiver_onboarding turns
// through this path will see HandlerError on the pivot turn. For now
// the Android voice-onboarding flow uses the non-streaming
// /conversation/turn endpoint exclusively. Mirror the pivot logic
// from handleTurn here when streaming for caregiver_onboarding is
// added.

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
    const patientCtx = await loadPatientContextOrPlaceholder(event, deps);
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
      selectSystemPromptPath(turnCtx.sessionState.sessionType, turnCtx.sessionState.fsmState, deps.config, patientCtx.placeholder ?? false),
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

    // Same caregiver-session bypass as handleTurn — see comment there.
    const guardrailId = isCaregiverSession(turnCtx.sessionState.sessionType)
      ? undefined
      : deps.config.guardrailId;
    const guardrailVersion = isCaregiverSession(turnCtx.sessionState.sessionType)
      ? undefined
      : deps.config.guardrailVersion;

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
        guardrailId,
        guardrailVersion,
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

    const { parsed, meta, guardrailBlocked: guardrailShortCircuited } = await invokeWithRetry(
      body,
      async (b) => {
        const r = await aggregateStream(b);
        return { text: r.text, meta: r };
      },
      turnCtx.sessionState.language,
    );

    const latencyMs = now() - invokeStart;

    // F19 — same short-circuit as the non-streaming path. Emit the
    // blocked-message text as a single sentence event, record telemetry
    // (guardrail_blocked=true) + enqueue alert, then close the stream.
    // No FSM transition, no transcript append, no observation writes.
    if (guardrailShortCircuited) {
      const inferenceRegion = deps.config.inferenceRegion;
      const emergencyTriggers = detectEmergencyTriggers(routing.reason, null, true);
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
        deps.modelCallRecorder.record(
          buildModelCallRecord({
            sessionId: event.sessionId,
            patientId: patientCtx.patient.id,
            tier,
            model: modelId,
            streamed: true,
            guardrailBlocked: true,
            usage: meta.usage,
            latencyMs,
            inferenceRegion,
            escalationReason: routing.reason,
          }),
        ),
        alertPromise,
      ]);

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
          guardrailBlocked: true,
          inferenceRegion,
          escalationReason: routing.reason,
          softCapReached,
        },
      });
      emitter.emit({
        type: 'done',
        data: {
          sessionState: {
            capturedThisSession: turnCtx.sessionState.capturedThisSession,
            pendingConfirmation: turnCtx.sessionState.pendingConfirmation,
            stillNeeded: turnCtx.sessionState.stillNeeded,
            fsmState: turnCtx.sessionState.fsmState,
          },
        },
      });
      await emitter.end();
      return;
    }

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

    // FHIR observation writes — same flow as handleTurn (T-V2-304).
    // Note: not surfaced as a streaming SSE event today; clients can
    // query interaction_sessions or fetch observations directly.
    await maybeWriteFhirObservations({
      extractedValues: parsed.extractedValues,
      patientCognitoSub: event.patientId,
      patientInternalId: patientCtx.patient.id,
      sessionId: event.sessionId,
      observedAt: new Date(now()),
      writer: deps.observationWriter,
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

    // F2 — same lifecycle terminus computation as the non-streaming path.
    const sessionTerminus = computeSessionTerminus({
      actions: parsed.actions,
      emergencyTriggered: emergencyTriggers.length > 0,
      now: () => new Date(now()),
    });

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
        status: sessionTerminus.status,
        endedAt: sessionTerminus.endedAt,
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

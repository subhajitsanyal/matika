import { resolve } from 'node:path';
import {
  handleTurn,
  handleTurnStream,
  HandlerDeps,
  HandlerError,
  TurnRequest,
  _resetSystemPromptCache,
} from '../src/handler';
import { CollectingSseEmitter } from '../src/sse_events';
import type { AlertEnqueuer, EmergencyAlertMessage, RateLimitAlertMessage } from '../src/alert_queue';
import type { BedrockInvoker, InvokeInput, InvokeResult, StreamChunk } from '../src/bedrock_client';
import type {
  PatientContextLoader,
  TurnContextLoader,
  PatientContext,
  TurnContext,
} from '../src/context/types';
import type { SessionPersister, ModelCallRecorder, SessionUpdate } from '../src/db';
import type { ModelCallRecord } from '../src/telemetry';

const SYSTEM_PROMPT_PATH = resolve(__dirname, '..', 'prompts', 'system_v2.md');
const ESCALATION_SUBPROMPT_DIR = resolve(__dirname, '..', 'escalation_subprompts');

// ---------- Test fixtures ----------

function basePatientCtx(): PatientContext {
  return {
    patient: {
      id: 'patient-1',
      name: 'Ramesh Sharma',
      age: 72,
      gender: 'male',
      primaryLanguage: 'hi-IN',
      conditions: ['hypertension'],
      medicalHistorySummary: null,
    },
    protocol: [
      {
        parameterName: 'blood_pressure_systolic',
        loincCode: '8480-6',
        unit: 'mmHg',
        frequencyDays: 1,
        dailyDeadline: '18:00',
        timezone: 'Asia/Kolkata',
        thresholdMin: 90,
        thresholdMax: 140,
        thresholdSetBy: 'doctor',
        active: true,
      },
    ],
    topics: [],
    recentSessions: [],
    pendingRecommendations: [],
  };
}

function baseTurnCtx(): TurnContext {
  return {
    sessionState: {
      sessionId: 'session-1',
      sessionType: 'patient_logging',
      language: 'en-IN',
      fsmState: 'EXTRACTING',
      capturedThisSession: [],
      pendingConfirmation: [],
      stillNeeded: ['blood_pressure_systolic', 'blood_pressure_diastolic', 'blood_glucose'],
    },
    recentTurns: [],
    conversationSummary: null,
    currentTranscript: 'BP is 130 over 85.',
  };
}

// Default stream chunks reconstruct the canonical happy-path responseText
// in two text_delta chunks, then a message_stop with usage matching the
// non-streamed makeInvokeResult() defaults.
function defaultStreamChunks(invokeResult?: InvokeResult): StreamChunk[] {
  const r = invokeResult ?? makeInvokeResult();
  const half = Math.floor(r.responseText.length / 2);
  return [
    { type: 'text_delta', text: r.responseText.slice(0, half) },
    { type: 'text_delta', text: r.responseText.slice(half) },
    {
      type: 'message_stop',
      usage: {
        inputTokens: r.inputTokens,
        cachedInputTokens: r.cachedInputTokens,
        outputTokens: r.outputTokens,
      },
      stopReason: r.rawStopReason,
    },
  ];
}

function makeInvokeResult(overrides: Partial<InvokeResult> = {}): InvokeResult {
  return {
    responseText: `<output>
{
  "responseText": "I heard one thirty over eighty five. Is that correct?",
  "ttsHints": { "language": "en-IN", "spellOutNumbers": false },
  "extractedValues": [
    { "parameter": "blood_pressure_systolic", "value": 130, "unit": "mmHg", "loincCode": "8480-6", "status": "pending_confirmation", "confidence": 0.94 },
    { "parameter": "blood_pressure_diastolic", "value": 85, "unit": "mmHg", "loincCode": "8462-4", "status": "pending_confirmation", "confidence": 0.94 }
  ],
  "actions": [],
  "stateTransition": "EXTRACTING -> PENDING_CONFIRMATION",
  "escalationReason": null
}
</output>`,
    inputTokens: 1840,
    cachedInputTokens: 1420,
    outputTokens: 28,
    guardrailBlocked: false,
    inferenceRegion: 'ap-southeast-1',
    rawStopReason: 'end_turn',
    ...overrides,
  };
}

// ---------- Test deps factory ----------

interface CapturedCalls {
  invokeCalls: InvokeInput[];
  patientLoadCalls: string[];
  turnLoadCalls: Array<{ sessionId: string; transcript: string }>;
  persisterUpdates: Array<{ sessionId: string; patch: SessionUpdate }>;
  modelCallRecords: ModelCallRecord[];
  alertsEnqueued: EmergencyAlertMessage[];
  rateLimitAlertsEnqueued: RateLimitAlertMessage[];
}

function makeDeps(opts: {
  patientCtx?: PatientContext;
  turnCtx?: TurnContext;
  invokeResult?: InvokeResult;
  invokeError?: Error;
  streamChunks?: StreamChunk[];
  patientLoadError?: Error;
  turnLoadError?: Error;
  nowSequence?: number[];
  withAlertEnqueuer?: boolean; // defaults to true
} = {}): { deps: HandlerDeps; calls: CapturedCalls } {
  const calls: CapturedCalls = {
    invokeCalls: [],
    patientLoadCalls: [],
    turnLoadCalls: [],
    persisterUpdates: [],
    modelCallRecords: [],
    alertsEnqueued: [],
    rateLimitAlertsEnqueued: [],
  };

  const bedrock: BedrockInvoker = {
    async invoke(input: InvokeInput): Promise<InvokeResult> {
      calls.invokeCalls.push(input);
      if (opts.invokeError) throw opts.invokeError;
      return opts.invokeResult ?? makeInvokeResult();
    },
    invokeStream(input: InvokeInput): AsyncIterable<StreamChunk> {
      calls.invokeCalls.push(input);
      const error = opts.invokeError;
      const streamChunks = opts.streamChunks ?? defaultStreamChunks(opts.invokeResult);
      return (async function* () {
        if (error) throw error;
        for (const chunk of streamChunks) yield chunk;
      })();
    },
  };
  const patientLoader: PatientContextLoader = {
    async load(patientId: string) {
      calls.patientLoadCalls.push(patientId);
      if (opts.patientLoadError) throw opts.patientLoadError;
      return opts.patientCtx ?? basePatientCtx();
    },
  };
  const turnLoader: TurnContextLoader = {
    async load(sessionId: string, transcript: string) {
      calls.turnLoadCalls.push({ sessionId, transcript });
      if (opts.turnLoadError) throw opts.turnLoadError;
      return opts.turnCtx ?? baseTurnCtx();
    },
  };
  const sessionPersister: SessionPersister = {
    async update(sessionId, patch) {
      calls.persisterUpdates.push({ sessionId, patch });
    },
  };
  const modelCallRecorder: ModelCallRecorder = {
    async record(record) {
      calls.modelCallRecords.push(record);
    },
  };
  const alertEnqueuer: AlertEnqueuer | undefined =
    opts.withAlertEnqueuer === false
      ? undefined
      : {
          async enqueueEmergency(message) {
            calls.alertsEnqueued.push(message);
          },
          async enqueueRateLimit(message) {
            calls.rateLimitAlertsEnqueued.push(message);
          },
        };

  let nowIdx = 0;
  const nowSeq = opts.nowSequence;
  const now = nowSeq
    ? () => nowSeq[Math.min(nowIdx++, nowSeq.length - 1)]
    : (() => {
        let counter = 1_000_000;
        return () => (counter += 100);
      })();

  return {
    deps: {
      bedrock,
      patientLoader,
      turnLoader,
      sessionPersister,
      modelCallRecorder,
      alertEnqueuer,
      config: {
        haikuModelId: 'apac.anthropic.claude-haiku-4-5-v1:0',
        sonnetModelId: 'apac.anthropic.claude-sonnet-4-x-v1:0',
        guardrailId: 'matika-test-guardrail',
        guardrailVersion: 'DRAFT',
        inferenceRegion: 'ap-southeast-1',
        maxTokens: 1024,
        systemPromptPath: SYSTEM_PROMPT_PATH,
        escalationSubpromptDir: ESCALATION_SUBPROMPT_DIR,
        hardRateLimitPerPatient: 500,
      },
      now,
    },
    calls,
  };
}

const baseRequest: TurnRequest = {
  sessionId: 'session-1',
  patientId: 'patient-1',
  transcript: 'BP is 130 over 85.',
  language: 'en-IN',
  turnSequence: 1,
};

// ---------- Tests ----------

beforeEach(() => {
  _resetSystemPromptCache();
});

describe('handleTurn — happy path (T2)', () => {
  it('returns 200 with response shape per spec §4.1', async () => {
    const { deps, calls } = makeDeps();
    const result = await handleTurn(baseRequest, deps);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.responseText).toContain('one thirty');
    expect(body.extractedValues).toHaveLength(2);
    expect(body.sessionState.fsmState).toBe('PENDING_CONFIRMATION');
    expect(body.sessionState.capturedThisSession).toEqual([]); // pending values not yet captured
    expect(body.sessionState.pendingConfirmation).toHaveLength(2);
    expect(body.telemetry.tier).toBe('T2');
    expect(body.telemetry.model).toBe('apac.anthropic.claude-haiku-4-5-v1:0');
    expect(body.telemetry.guardrailBlocked).toBe(false);

    expect(calls.invokeCalls).toHaveLength(1);
    expect(calls.invokeCalls[0].modelId).toBe('apac.anthropic.claude-haiku-4-5-v1:0');
    expect(calls.invokeCalls[0].guardrailId).toBe('matika-test-guardrail');
  });

  it('loads patient + turn context in parallel', async () => {
    const { deps, calls } = makeDeps();
    await handleTurn(baseRequest, deps);
    expect(calls.patientLoadCalls).toEqual(['patient-1']);
    expect(calls.turnLoadCalls).toEqual([
      { sessionId: 'session-1', transcript: 'BP is 130 over 85.' },
    ]);
  });

  it('persists session update with new FSM state and transcript history', async () => {
    const { deps, calls } = makeDeps();
    await handleTurn(baseRequest, deps);
    expect(calls.persisterUpdates).toHaveLength(1);
    const { sessionId, patch } = calls.persisterUpdates[0];
    expect(sessionId).toBe('session-1');
    expect(patch.fsmState).toBe('PENDING_CONFIRMATION');
    expect(patch.transcriptHistory).toHaveLength(2); // patient + system
    expect(patch.transcriptHistory[0].role).toBe('patient');
    expect(patch.transcriptHistory[0].text).toBe('BP is 130 over 85.');
    expect(patch.transcriptHistory[1].role).toBe('system');
    expect(patch.streamingUsed).toBe(false);
  });

  it('records a model_call telemetry row with correct cost and tier', async () => {
    const { deps, calls } = makeDeps();
    await handleTurn(baseRequest, deps);
    expect(calls.modelCallRecords).toHaveLength(1);
    const record = calls.modelCallRecords[0];
    expect(record.tier).toBe('T2');
    expect(record.model).toBe('apac.anthropic.claude-haiku-4-5-v1:0');
    expect(record.inputTokens).toBe(1840);
    expect(record.cachedInputTokens).toBe(1420);
    expect(record.outputTokens).toBe(28);
    expect(record.guardrailBlocked).toBe(false);
    expect(record.escalationReason).toBeNull();
    expect(record.costUsd).toBeCloseTo(0.000702, 6);
  });
});

describe('handleTurn — escalation routing', () => {
  it('routes implausible BP to Sonnet (T3)', async () => {
    const turnCtx = baseTurnCtx();
    const { deps, calls } = makeDeps({
      turnCtx,
      invokeResult: makeInvokeResult({
        responseText: `<output>
{
  "responseText": "रमेश जी, यह तो बहुत ज्यादा लग रहा है।",
  "ttsHints": { "language": "hi-IN", "spellOutNumbers": true },
  "extractedValues": [],
  "actions": [],
  "stateTransition": "EXTRACTING -> PLAUSIBILITY_CHALLENGE",
  "escalationReason": "implausible_value"
}
</output>`,
      }),
    });

    const result = await handleTurn(
      { ...baseRequest, transcript: 'My BP is 350 over 200', language: 'hi-IN' },
      deps,
    );

    const body = JSON.parse(result.body);
    expect(body.telemetry.tier).toBe('T3');
    expect(body.telemetry.model).toBe('apac.anthropic.claude-sonnet-4-x-v1:0');
    expect(body.telemetry.escalationReason).toBe('implausible_value');
    expect(body.sessionState.fsmState).toBe('PLAUSIBILITY_CHALLENGE');

    expect(calls.invokeCalls[0].modelId).toBe('apac.anthropic.claude-sonnet-4-x-v1:0');
    expect(calls.persisterUpdates[0].patch.escalationsTriggered).toEqual(['implausible_value']);
  });

  it('routes emergency keyword to Sonnet (T3) with emergency escalation reason', async () => {
    const { deps } = makeDeps({
      invokeResult: makeInvokeResult({
        responseText: `<output>
{
  "responseText": "Please contact your caregiver right away.",
  "ttsHints": { "language": "en-IN", "spellOutNumbers": false },
  "extractedValues": [],
  "actions": [{ "type": "escalate_emergency", "reason": "chest_pain_keyword" }],
  "stateTransition": "EXTRACTING -> EMERGENCY",
  "escalationReason": "emergency"
}
</output>`,
      }),
    });
    const result = await handleTurn(
      { ...baseRequest, transcript: 'I have chest pain' },
      deps,
    );
    const body = JSON.parse(result.body);
    expect(body.telemetry.tier).toBe('T3');
    expect(body.telemetry.escalationReason).toBe('emergency_keyword');
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0].type).toBe('escalate_emergency');
    expect(body.sessionState.fsmState).toBe('EMERGENCY');
  });
});

describe('handleTurn — captured value merging', () => {
  it('merges confirmed values into capturedThisSession', async () => {
    const turnCtx = baseTurnCtx();
    turnCtx.sessionState.capturedThisSession = []; // start empty
    const { deps } = makeDeps({
      turnCtx,
      invokeResult: makeInvokeResult({
        responseText: `<output>
{
  "responseText": "Got it.",
  "ttsHints": { "language": "en-IN", "spellOutNumbers": false },
  "extractedValues": [
    { "parameter": "blood_pressure_systolic", "value": 130, "unit": "mmHg", "loincCode": "8480-6", "status": "confirmed", "confidence": 0.95 }
  ],
  "actions": [],
  "stateTransition": "PENDING_CONFIRMATION -> EXTRACTING",
  "escalationReason": null
}
</output>`,
      }),
    });
    turnCtx.sessionState.fsmState = 'PENDING_CONFIRMATION';

    const result = await handleTurn(baseRequest, deps);
    const body = JSON.parse(result.body);
    expect(body.sessionState.capturedThisSession).toHaveLength(1);
    expect(body.sessionState.capturedThisSession[0].status).toBe('confirmed');
    expect(body.sessionState.stillNeeded).not.toContain('blood_pressure_systolic');
  });

  it('drops rejected values from capturedThisSession', async () => {
    const turnCtx = baseTurnCtx();
    turnCtx.sessionState.capturedThisSession = [
      { parameter: 'blood_pressure_systolic', value: 130, unit: 'mmHg', loincCode: '8480-6', status: 'confirmed', confidence: 0.95 },
    ];
    turnCtx.sessionState.fsmState = 'PENDING_CONFIRMATION';
    const { deps } = makeDeps({
      turnCtx,
      invokeResult: makeInvokeResult({
        responseText: `<output>
{
  "responseText": "Sorry, let's redo that.",
  "ttsHints": { "language": "en-IN", "spellOutNumbers": false },
  "extractedValues": [
    { "parameter": "blood_pressure_systolic", "value": 130, "unit": "mmHg", "loincCode": "8480-6", "status": "rejected", "confidence": 0.95 }
  ],
  "actions": [],
  "stateTransition": "PENDING_CONFIRMATION -> EXTRACTING",
  "escalationReason": null
}
</output>`,
      }),
    });
    const body = JSON.parse((await handleTurn(baseRequest, deps)).body);
    expect(body.sessionState.capturedThisSession).toEqual([]);
  });
});

describe('handleTurn — input validation', () => {
  it('throws on empty transcript', async () => {
    const { deps } = makeDeps();
    await expect(handleTurn({ ...baseRequest, transcript: '   ' }, deps)).rejects.toThrow(/transcript/);
  });

  it('throws on unsupported language', async () => {
    const { deps } = makeDeps();
    await expect(
      handleTurn({ ...baseRequest, language: 'fr-FR' as TurnRequest['language'] }, deps),
    ).rejects.toThrow(/language/);
  });

  it('throws on missing patientId', async () => {
    const { deps } = makeDeps();
    await expect(handleTurn({ ...baseRequest, patientId: '' }, deps)).rejects.toThrow(/patientId/);
  });
});

describe('handleTurn — error propagation', () => {
  it('propagates patient loader errors', async () => {
    const { deps } = makeDeps({ patientLoadError: new Error('DB down') });
    await expect(handleTurn(baseRequest, deps)).rejects.toThrow(/DB down/);
  });

  it('propagates Bedrock errors', async () => {
    const { deps } = makeDeps({ invokeError: new Error('Bedrock 503') });
    await expect(handleTurn(baseRequest, deps)).rejects.toThrow(/Bedrock 503/);
  });

  it('propagates invalid LLM output (no <output> tags)', async () => {
    const { deps } = makeDeps({
      invokeResult: makeInvokeResult({
        responseText: 'Just some prose, no tags.',
      }),
    });
    await expect(handleTurn(baseRequest, deps)).rejects.toThrow(/<output>/);
  });

  it('propagates state-machine from-mismatch (LLM returns wrong FROM)', async () => {
    const turnCtx = baseTurnCtx();
    turnCtx.sessionState.fsmState = 'EXTRACTING';
    const { deps } = makeDeps({
      turnCtx,
      invokeResult: makeInvokeResult({
        responseText: `<output>
{
  "responseText": "ok",
  "ttsHints": { "language": "en-IN", "spellOutNumbers": false },
  "extractedValues": [],
  "actions": [],
  "stateTransition": "GREETING -> EXTRACTING",
  "escalationReason": null
}
</output>`,
      }),
    });
    await expect(handleTurn(baseRequest, deps)).rejects.toThrow(/FROM/);
  });
});

describe('handleTurn — Bedrock invocation shape', () => {
  it('invokes Bedrock with three-block prompt (system + per-patient + per-turn)', async () => {
    const { deps, calls } = makeDeps();
    await handleTurn(baseRequest, deps);
    const body = calls.invokeCalls[0].body;
    expect(body.system).toHaveLength(1);
    expect(body.system[0].text.length).toBeGreaterThan(1000); // system prompt is real
    expect(body.messages[0].content).toHaveLength(2);
    // First user content is per-patient (cached), second is per-turn (uncached)
    expect(body.messages[0].content[0].cache_control).toBeDefined();
    expect(body.messages[0].content[1].cache_control).toBeUndefined();
  });

  it('passes Guardrails identifier when configured', async () => {
    const { deps, calls } = makeDeps();
    await handleTurn(baseRequest, deps);
    expect(calls.invokeCalls[0].guardrailId).toBe('matika-test-guardrail');
    expect(calls.invokeCalls[0].guardrailVersion).toBe('DRAFT');
  });
});

// ---------- Parser retry (handleTurn) ----------

describe('handleTurn — parser retry on parse failure', () => {
  const malformedResponse = makeInvokeResult({ responseText: 'No tags here, just prose.' });
  const validRetry = makeInvokeResult();

  function makeRetryingDeps(opts: { firstResult: InvokeResult; secondResult?: InvokeResult; secondError?: Error }) {
    const calls: CapturedCalls = {
      invokeCalls: [],
      patientLoadCalls: [],
      turnLoadCalls: [],
      persisterUpdates: [],
      modelCallRecords: [],
      alertsEnqueued: [],
      rateLimitAlertsEnqueued: [],
    };
    let invokeCount = 0;
    const bedrock: BedrockInvoker = {
      async invoke(input) {
        calls.invokeCalls.push(input);
        invokeCount++;
        if (invokeCount === 1) return opts.firstResult;
        if (opts.secondError) throw opts.secondError;
        return opts.secondResult ?? validRetry;
      },
      invokeStream() {
        throw new Error('not used in this test');
      },
    };
    const deps: HandlerDeps = {
      bedrock,
      patientLoader: {
        async load(id) { calls.patientLoadCalls.push(id); return basePatientCtx(); },
      },
      turnLoader: {
        async load(sessionId, transcript) {
          calls.turnLoadCalls.push({ sessionId, transcript });
          return baseTurnCtx();
        },
      },
      sessionPersister: { async update(sessionId, patch) { calls.persisterUpdates.push({ sessionId, patch }); } },
      modelCallRecorder: { async record(record) { calls.modelCallRecords.push(record); } },
      config: {
        haikuModelId: 'apac.anthropic.claude-haiku-4-5-v1:0',
        sonnetModelId: 'apac.anthropic.claude-sonnet-4-x-v1:0',
        guardrailId: 'matika-test-guardrail',
        guardrailVersion: 'DRAFT',
        inferenceRegion: 'ap-southeast-1',
        maxTokens: 1024,
        systemPromptPath: SYSTEM_PROMPT_PATH,
        escalationSubpromptDir: ESCALATION_SUBPROMPT_DIR,
        hardRateLimitPerPatient: 500,
      },
    };
    return { deps, calls };
  }

  it('retries once with stricter prompt when first response has no <output> tags', async () => {
    const { deps, calls } = makeRetryingDeps({ firstResult: malformedResponse });
    const result = await handleTurn(baseRequest, deps);
    expect(result.statusCode).toBe(200);
    expect(calls.invokeCalls).toHaveLength(2);
    // Second invoke should have the strictness reminder appended to the
    // per-turn (last) content block
    const secondBody = calls.invokeCalls[1].body;
    const lastContent = secondBody.messages[0].content[secondBody.messages[0].content.length - 1];
    expect(lastContent.text).toContain('SYSTEM REMINDER');
  });

  it('retries on invalid JSON inside <output> tags', async () => {
    const malformed = makeInvokeResult({
      responseText: '<output>{ broken json</output>',
    });
    const { deps, calls } = makeRetryingDeps({ firstResult: malformed });
    const result = await handleTurn(baseRequest, deps);
    expect(result.statusCode).toBe(200);
    expect(calls.invokeCalls).toHaveLength(2);
  });

  it('retries on schema validation failure', async () => {
    const missingField = makeInvokeResult({
      responseText: `<output>
{"responseText":"ok","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[],"stateTransition":"EXTRACTING -> EXTRACTING"}
</output>`,
    });
    const { deps, calls } = makeRetryingDeps({ firstResult: missingField });
    const result = await handleTurn(baseRequest, deps);
    expect(result.statusCode).toBe(200);
    expect(calls.invokeCalls).toHaveLength(2);
  });

  it('throws HandlerError(503) when retry also fails to parse', async () => {
    const { deps, calls } = makeRetryingDeps({
      firstResult: malformedResponse,
      secondResult: malformedResponse, // same garbage, retry also fails
    });
    await expect(handleTurn(baseRequest, deps)).rejects.toThrow(HandlerError);
    expect(calls.invokeCalls).toHaveLength(2);
    try {
      await handleTurn(baseRequest, deps);
    } catch (e) {
      if (e instanceof HandlerError) {
        expect(e.statusCode).toBe(503);
        expect(e.code).toMatch(/^parse_failed_after_retry/);
      }
    }
  });

  it('does NOT retry on non-retriable errors (e.g. state-machine from-mismatch)', async () => {
    const wrongTransition = makeInvokeResult({
      responseText: `<output>
{"responseText":"ok","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[],"stateTransition":"GREETING -> EXTRACTING","escalationReason":null}
</output>`,
    });
    const { deps, calls } = makeRetryingDeps({ firstResult: wrongTransition });
    await expect(handleTurn(baseRequest, deps)).rejects.toThrow(/FROM/);
    // FROM-mismatch happens AFTER parse, so only one invoke
    expect(calls.invokeCalls).toHaveLength(1);
  });
});

// ---------- handleTurnStream ----------

describe('handleTurnStream', () => {
  it('emits prelude → sentence → extracted → telemetry → done in order', async () => {
    const { deps } = makeDeps();
    const emitter = new CollectingSseEmitter();
    await handleTurnStream(baseRequest, deps, emitter);

    const types = emitter.events.map((e) => e.type);
    expect(types[0]).toBe('prelude');
    // Sentence + extracted appear after prelude, before telemetry/done
    expect(types).toContain('sentence');
    expect(types).toContain('extracted');
    expect(types).toContain('telemetry');
    expect(types[types.length - 1]).toBe('done');
    expect(emitter.ended).toBe(true);
  });

  it('prelude carries tier and model', async () => {
    const { deps } = makeDeps();
    const emitter = new CollectingSseEmitter();
    await handleTurnStream(baseRequest, deps, emitter);
    const prelude = emitter.events[0];
    expect(prelude.type).toBe('prelude');
    if (prelude.type === 'prelude') {
      expect(prelude.data.sessionId).toBe('session-1');
      expect(prelude.data.tier).toBe('T2');
      expect(prelude.data.model).toBe('apac.anthropic.claude-haiku-4-5-v1:0');
      expect(prelude.data.streamId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('streamed=true is recorded in model_call telemetry', async () => {
    const { deps, calls } = makeDeps();
    await handleTurnStream(baseRequest, deps, new CollectingSseEmitter());
    expect(calls.modelCallRecords).toHaveLength(1);
    expect(calls.modelCallRecords[0].streamed).toBe(true);
  });

  it('streamingUsed=true is recorded in session update', async () => {
    const { deps, calls } = makeDeps();
    await handleTurnStream(baseRequest, deps, new CollectingSseEmitter());
    expect(calls.persisterUpdates[0].patch.streamingUsed).toBe(true);
  });

  it('routes T3 escalation to Sonnet streaming', async () => {
    // Use streamChunks that produce a T3 (Sonnet) response after escalation
    const sonnetResponse = `<output>
{"responseText":"That seems unusually high.","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[],"stateTransition":"EXTRACTING -> PLAUSIBILITY_CHALLENGE","escalationReason":"implausible_value"}
</output>`;
    const { deps, calls } = makeDeps({
      streamChunks: [
        { type: 'text_delta', text: sonnetResponse },
        {
          type: 'message_stop',
          usage: { inputTokens: 2100, cachedInputTokens: 1420, outputTokens: 85 },
          stopReason: 'end_turn',
        },
      ],
    });
    const emitter = new CollectingSseEmitter();
    await handleTurnStream(
      { ...baseRequest, transcript: 'My BP is 350 over 200' },
      deps,
      emitter,
    );

    expect(calls.invokeCalls[0].modelId).toBe('apac.anthropic.claude-sonnet-4-x-v1:0');
    const telemetry = emitter.events.find((e) => e.type === 'telemetry');
    expect(telemetry?.type).toBe('telemetry');
    if (telemetry?.type === 'telemetry') {
      expect(telemetry.data.tier).toBe('T3');
      expect(telemetry.data.escalationReason).toBe('implausible_value');
    }
  });

  it('emits error event on Bedrock failure and ends emitter', async () => {
    const { deps } = makeDeps({ invokeError: new Error('Bedrock down') });
    const emitter = new CollectingSseEmitter();
    await expect(handleTurnStream(baseRequest, deps, emitter)).rejects.toThrow('Bedrock down');
    const errorEvent = emitter.events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(emitter.ended).toBe(true);
  });

  it('emits error event on validation failure (empty transcript)', async () => {
    const { deps } = makeDeps();
    const emitter = new CollectingSseEmitter();
    await expect(
      handleTurnStream({ ...baseRequest, transcript: '   ' }, deps, emitter),
    ).rejects.toThrow(/transcript/);
    const errorEvent = emitter.events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
  });

  it('done event carries final session state', async () => {
    const { deps } = makeDeps();
    const emitter = new CollectingSseEmitter();
    await handleTurnStream(baseRequest, deps, emitter);
    const done = emitter.events[emitter.events.length - 1];
    expect(done.type).toBe('done');
    if (done.type === 'done') {
      expect(done.data.sessionState.fsmState).toBe('PENDING_CONFIRMATION');
      expect(done.data.sessionState.pendingConfirmation).toHaveLength(2);
    }
  });

  it('aggregates multi-chunk text_delta into one parsed output', async () => {
    // Same content split across many chunks
    const fullText = makeInvokeResult().responseText;
    const chunks: StreamChunk[] = [];
    for (let i = 0; i < fullText.length; i += 50) {
      chunks.push({ type: 'text_delta', text: fullText.slice(i, i + 50) });
    }
    chunks.push({
      type: 'message_stop',
      usage: { inputTokens: 1840, cachedInputTokens: 1420, outputTokens: 28 },
      stopReason: 'end_turn',
    });

    const { deps } = makeDeps({ streamChunks: chunks });
    const emitter = new CollectingSseEmitter();
    await handleTurnStream(baseRequest, deps, emitter);

    // Should have parsed correctly and emitted full content
    const sentence = emitter.events.find((e) => e.type === 'sentence');
    expect(sentence).toBeDefined();
    if (sentence?.type === 'sentence') {
      expect(sentence.data.text).toContain('one thirty');
    }
  });
});

// ---------- Emergency alert enqueueing ----------

describe('handleTurn — emergency alert (T-V2-222)', () => {
  it('enqueues an alert when emergency_keyword routing reason fires', async () => {
    const { deps, calls } = makeDeps({
      invokeResult: makeInvokeResult({
        responseText: `<output>
{"responseText":"Please contact your caregiver immediately.","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[{"type":"escalate_emergency","reason":"chest_pain"}],"stateTransition":"EXTRACTING -> EMERGENCY","escalationReason":"emergency"}
</output>`,
      }),
    });
    await handleTurn({ ...baseRequest, transcript: 'I have chest pain' }, deps);
    expect(calls.alertsEnqueued).toHaveLength(1);
    const alert = calls.alertsEnqueued[0];
    expect(alert.alertType).toBe('emergency');
    expect(alert.patientId).toBe('patient-1');
    expect(alert.sessionId).toBe('session-1');
    expect(alert.transcript).toBe('I have chest pain');
    expect(alert.language).toBe('en-IN');
    // Both transcript_keyword (router-side) and llm_classification (LLM
    // returned escalationReason: emergency) fire on this turn.
    expect(alert.triggers).toEqual(expect.arrayContaining(['transcript_keyword', 'llm_classification']));
  });

  it('enqueues an alert with only llm_classification when LLM flags emergency unprompted', async () => {
    const { deps, calls } = makeDeps({
      invokeResult: makeInvokeResult({
        responseText: `<output>
{"responseText":"Something seems off — please call.","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[],"stateTransition":"EXTRACTING -> EMERGENCY","escalationReason":"emergency"}
</output>`,
      }),
    });
    // Transcript has no emergency keyword
    await handleTurn({ ...baseRequest, transcript: 'I feel a bit tired today' }, deps);
    expect(calls.alertsEnqueued).toHaveLength(1);
    expect(calls.alertsEnqueued[0].triggers).toEqual(['llm_classification']);
  });

  it('enqueues an alert with guardrail_block when Guardrails fires', async () => {
    const { deps, calls } = makeDeps({
      invokeResult: makeInvokeResult({
        responseText: `<output>
{"responseText":"I cannot help with that. Please reach out to your caregiver.","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[],"stateTransition":"EXTRACTING -> EXTRACTING","escalationReason":null}
</output>`,
        guardrailBlocked: true,
      }),
    });
    await handleTurn(baseRequest, deps);
    expect(calls.alertsEnqueued).toHaveLength(1);
    expect(calls.alertsEnqueued[0].triggers).toEqual(['guardrail_block']);
  });

  it('combines multiple triggers in a single alert when several fire', async () => {
    const { deps, calls } = makeDeps({
      invokeResult: makeInvokeResult({
        responseText: `<output>
{"responseText":"Please contact your caregiver immediately.","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[],"stateTransition":"EXTRACTING -> EMERGENCY","escalationReason":"emergency"}
</output>`,
        guardrailBlocked: true,
      }),
    });
    await handleTurn({ ...baseRequest, transcript: 'I have chest pain' }, deps);
    expect(calls.alertsEnqueued).toHaveLength(1);
    expect(calls.alertsEnqueued[0].triggers).toEqual(
      expect.arrayContaining(['transcript_keyword', 'llm_classification', 'guardrail_block']),
    );
  });

  it('does NOT enqueue an alert on a non-emergency turn', async () => {
    const { deps, calls } = makeDeps();
    await handleTurn(baseRequest, deps);
    expect(calls.alertsEnqueued).toEqual([]);
  });

  it('does NOT enqueue an alert when implausible_value escalation fires (not an emergency)', async () => {
    const { deps, calls } = makeDeps({
      invokeResult: makeInvokeResult({
        responseText: `<output>
{"responseText":"That seems unusual.","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[],"stateTransition":"EXTRACTING -> PLAUSIBILITY_CHALLENGE","escalationReason":"implausible_value"}
</output>`,
      }),
    });
    await handleTurn({ ...baseRequest, transcript: 'My BP is 350 over 200' }, deps);
    expect(calls.alertsEnqueued).toEqual([]);
  });

  it('still works when alertEnqueuer is undefined (graceful no-op)', async () => {
    const { deps, calls } = makeDeps({
      withAlertEnqueuer: false,
      invokeResult: makeInvokeResult({
        responseText: `<output>
{"responseText":"Please contact your caregiver immediately.","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[],"stateTransition":"EXTRACTING -> EMERGENCY","escalationReason":"emergency"}
</output>`,
      }),
    });
    const result = await handleTurn({ ...baseRequest, transcript: 'I have chest pain' }, deps);
    expect(result.statusCode).toBe(200); // Still succeeds
    expect(calls.alertsEnqueued).toEqual([]); // Nothing enqueued
  });
});

// ---------- Escalation sub-prompt loading (T-V2-220) ----------

describe('handleTurn — escalation sub-prompts', () => {
  it('prepends the implausible_value sub-prompt when that signal fires', async () => {
    const { deps, calls } = makeDeps({
      invokeResult: makeInvokeResult({
        responseText: `<output>
{"responseText":"That seems unusual.","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[],"stateTransition":"EXTRACTING -> PLAUSIBILITY_CHALLENGE","escalationReason":"implausible_value"}
</output>`,
      }),
    });
    await handleTurn({ ...baseRequest, transcript: 'My BP is 350 over 200' }, deps);
    const body = calls.invokeCalls[0].body;
    const lastContent = body.messages[0].content[body.messages[0].content.length - 1];
    expect(lastContent.text).toContain('PLAUSIBILITY CHALLENGE');
    expect(lastContent.text).toContain('outside the physiological hard range');
  });

  it('prepends the emergency sub-prompt when emergency_keyword fires', async () => {
    const { deps, calls } = makeDeps({
      invokeResult: makeInvokeResult({
        responseText: `<output>
{"responseText":"Please call your caregiver.","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[],"stateTransition":"EXTRACTING -> EMERGENCY","escalationReason":"emergency"}
</output>`,
      }),
    });
    await handleTurn({ ...baseRequest, transcript: 'I have chest pain' }, deps);
    const body = calls.invokeCalls[0].body;
    const lastContent = body.messages[0].content[body.messages[0].content.length - 1];
    expect(lastContent.text).toContain('SAFETY ESCALATION');
    expect(lastContent.text).toContain('possible medical emergency');
  });

  it('does NOT prepend a sub-prompt when no escalation reason set', async () => {
    const { deps, calls } = makeDeps();
    await handleTurn(baseRequest, deps);
    const body = calls.invokeCalls[0].body;
    const lastContent = body.messages[0].content[body.messages[0].content.length - 1];
    expect(lastContent.text).not.toContain('PLAUSIBILITY CHALLENGE');
    expect(lastContent.text).not.toContain('SAFETY ESCALATION');
  });

  it('does NOT prepend when escalation reason has no sub-prompt file (e.g. low_confidence)', async () => {
    // Set up a turn where low_confidence_extraction fires (previous turn's
    // confidence was low). The signal exists but no sub-prompt file is
    // authored for it; handler should silently proceed without prepending.
    const turnCtx = baseTurnCtx();
    turnCtx.sessionState.pendingConfirmation = [
      { parameter: 'blood_pressure_systolic', value: 130, unit: 'mmHg', loincCode: '8480-6', status: 'pending_confirmation', confidence: 0.55 },
    ];
    const { deps, calls } = makeDeps({ turnCtx });
    await handleTurn(baseRequest, deps);
    const body = calls.invokeCalls[0].body;
    const lastContent = body.messages[0].content[body.messages[0].content.length - 1];
    expect(lastContent.text).not.toContain('PLAUSIBILITY CHALLENGE');
    expect(lastContent.text).not.toContain('SAFETY ESCALATION');
  });

  it('preserves the per-turn block content (sub-prompt is prepended, not replaced)', async () => {
    const { deps, calls } = makeDeps({
      invokeResult: makeInvokeResult({
        responseText: `<output>
{"responseText":"Please call.","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[],"stateTransition":"EXTRACTING -> EMERGENCY","escalationReason":"emergency"}
</output>`,
      }),
    });
    await handleTurn({ ...baseRequest, transcript: 'I have chest pain' }, deps);
    const body = calls.invokeCalls[0].body;
    const lastContent = body.messages[0].content[body.messages[0].content.length - 1];
    // Sub-prompt content is present
    expect(lastContent.text).toContain('SAFETY ESCALATION');
    // And the original per-turn content (Current session state, etc.) is also present
    expect(lastContent.text).toContain('Current session state');
    expect(lastContent.text).toContain('Current transcript');
  });
});

// ---------- detectEmergencyTriggers (pure helper) ----------

describe('detectEmergencyTriggers', () => {
  // Re-import to test the exported helper directly.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { detectEmergencyTriggers } = require('../src/handler');

  it('returns empty for a clean turn', () => {
    expect(detectEmergencyTriggers(null, null, false)).toEqual([]);
  });

  it('detects transcript_keyword from routing reason', () => {
    expect(detectEmergencyTriggers('emergency_keyword', null, false)).toEqual(['transcript_keyword']);
  });

  it('detects llm_classification from LLM-returned escalation', () => {
    expect(detectEmergencyTriggers(null, 'emergency', false)).toEqual(['llm_classification']);
  });

  it('detects guardrail_block', () => {
    expect(detectEmergencyTriggers(null, null, true)).toEqual(['guardrail_block']);
  });

  it('returns multiple triggers in order when several fire', () => {
    expect(detectEmergencyTriggers('emergency_keyword', 'emergency', true)).toEqual([
      'transcript_keyword',
      'llm_classification',
      'guardrail_block',
    ]);
  });

  it('does NOT trigger on non-emergency routing reasons', () => {
    expect(detectEmergencyTriggers('implausible_value', null, false)).toEqual([]);
    expect(detectEmergencyTriggers('caregiver_protocol_design', null, false)).toEqual([]);
    expect(detectEmergencyTriggers('low_confidence_extraction', null, false)).toEqual([]);
  });

  it('does NOT trigger on non-emergency LLM escalation reasons', () => {
    expect(detectEmergencyTriggers(null, 'implausible_value', false)).toEqual([]);
    expect(detectEmergencyTriggers(null, 'long_response_expected', false)).toEqual([]);
  });
});

// ---------- handleTurnStream emergency alert ----------

describe('handleTurnStream — emergency alert', () => {
  it('enqueues an alert on emergency turns', async () => {
    const sonnetEmergency = `<output>
{"responseText":"Please contact your caregiver.","ttsHints":{"language":"en-IN","spellOutNumbers":false},"extractedValues":[],"actions":[],"stateTransition":"EXTRACTING -> EMERGENCY","escalationReason":"emergency"}
</output>`;
    const { deps, calls } = makeDeps({
      streamChunks: [
        { type: 'text_delta', text: sonnetEmergency },
        {
          type: 'message_stop',
          usage: { inputTokens: 2100, cachedInputTokens: 1420, outputTokens: 30 },
          stopReason: 'end_turn',
        },
      ],
    });
    const emitter = new CollectingSseEmitter();
    await handleTurnStream({ ...baseRequest, transcript: 'I have chest pain' }, deps, emitter);

    expect(calls.alertsEnqueued).toHaveLength(1);
    expect(calls.alertsEnqueued[0].triggers).toEqual(
      expect.arrayContaining(['transcript_keyword', 'llm_classification']),
    );
  });

  it('does not enqueue alert on a clean stream', async () => {
    const { deps, calls } = makeDeps();
    await handleTurnStream(baseRequest, deps, new CollectingSseEmitter());
    expect(calls.alertsEnqueued).toEqual([]);
  });
});

// ---------- Sliding-window summarization (T-V2-102 follow-on) ----------

describe('handleTurn — sliding window summarization', () => {
  function manyTurns(n: number): Array<{ role: 'patient' | 'system'; text: string; timestamp: Date }> {
    const turns: Array<{ role: 'patient' | 'system'; text: string; timestamp: Date }> = [];
    for (let i = 0; i < n; i++) {
      turns.push({
        role: i % 2 === 0 ? 'patient' : 'system',
        text: `turn ${i}`,
        timestamp: new Date(2026, 4, 2, 10, i, 0),
      });
    }
    return turns;
  }

  it('does NOT call summarizer when history fits in the window', async () => {
    let summarizerCalls = 0;
    const turnCtx = baseTurnCtx();
    turnCtx.recentTurns = manyTurns(2); // small history
    const { deps } = makeDeps({ turnCtx });
    deps.summarizer = {
      async summarize() {
        summarizerCalls++;
        return {
          summary: 'should not be called',
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
          latencyMs: 0,
          guardrailBlocked: false,
          inferenceRegion: 'ap-southeast-1',
        };
      },
    };
    await handleTurn(baseRequest, deps);
    expect(summarizerCalls).toBe(0);
  });

  it('calls summarizer when history overflows the window', async () => {
    let summarizerCalls = 0;
    let observedOverflowCount = 0;
    let observedExistingSummary: string | null = null;
    const turnCtx = baseTurnCtx();
    turnCtx.recentTurns = manyTurns(8); // >6, will overflow when we append 2 new turns
    turnCtx.conversationSummary = 'Earlier: patient confirmed BP 132/84.';
    const { deps, calls } = makeDeps({ turnCtx });
    deps.summarizer = {
      async summarize(input) {
        summarizerCalls++;
        observedOverflowCount = input.overflowTurns.length;
        observedExistingSummary = input.existingSummary;
        return {
          summary: 'Patient confirmed multiple readings; deferred glucose check.',
          usage: { inputTokens: 320, cachedInputTokens: 250, outputTokens: 14 },
          latencyMs: 200,
          guardrailBlocked: false,
          inferenceRegion: 'ap-southeast-1',
        };
      },
    };
    await handleTurn(baseRequest, deps);
    expect(summarizerCalls).toBe(1);
    expect(observedOverflowCount).toBeGreaterThan(0);
    expect(observedExistingSummary).toBe('Earlier: patient confirmed BP 132/84.');

    // Persisted history should be trimmed to window size
    expect(calls.persisterUpdates).toHaveLength(1);
    expect(calls.persisterUpdates[0].patch.transcriptHistory).toHaveLength(6);
    // New summary persisted
    expect(calls.persisterUpdates[0].patch.conversationSummary).toBe(
      'Patient confirmed multiple readings; deferred glucose check.',
    );
  });

  it('passes existing conversationSummary through when no overflow occurs', async () => {
    const turnCtx = baseTurnCtx();
    turnCtx.recentTurns = manyTurns(2);
    turnCtx.conversationSummary = 'Existing summary value.';
    const { deps, calls } = makeDeps({ turnCtx });
    await handleTurn(baseRequest, deps);
    // Summary is unchanged (passes through)
    expect(calls.persisterUpdates[0].patch.conversationSummary).toBe('Existing summary value.');
  });

  it('is a no-op when summarizer is undefined (graceful degradation)', async () => {
    const turnCtx = baseTurnCtx();
    turnCtx.recentTurns = manyTurns(8); // would overflow
    turnCtx.conversationSummary = 'pre-existing';
    const { deps, calls } = makeDeps({ turnCtx });
    deps.summarizer = undefined;
    const result = await handleTurn(baseRequest, deps);
    expect(result.statusCode).toBe(200); // still succeeds
    // History is NOT trimmed (no summarizer to compress overflow)
    expect(calls.persisterUpdates[0].patch.transcriptHistory.length).toBeGreaterThan(6);
    // Summary unchanged
    expect(calls.persisterUpdates[0].patch.conversationSummary).toBe('pre-existing');
  });

  it('records a model_call telemetry row for the summarizer call', async () => {
    const turnCtx = baseTurnCtx();
    turnCtx.recentTurns = manyTurns(8);
    const { deps, calls } = makeDeps({ turnCtx });
    deps.summarizer = {
      async summarize() {
        return {
          summary: 'summarized',
          usage: { inputTokens: 320, cachedInputTokens: 250, outputTokens: 14 },
          latencyMs: 200,
          guardrailBlocked: false,
          inferenceRegion: 'ap-southeast-1',
        };
      },
    };
    await handleTurn(baseRequest, deps);
    // Two model_call records: one for the conversational invocation, one for
    // the summarizer.
    expect(calls.modelCallRecords).toHaveLength(2);
    const summarizerRecord = calls.modelCallRecords.find(
      (r) => r.escalationReason === 'summarizer_overflow',
    );
    expect(summarizerRecord).toBeDefined();
    expect(summarizerRecord!.tier).toBe('T2');
    expect(summarizerRecord!.streamed).toBe(false);
    expect(summarizerRecord!.inputTokens).toBe(320);
    expect(summarizerRecord!.cachedInputTokens).toBe(250);
    expect(summarizerRecord!.outputTokens).toBe(14);
    expect(summarizerRecord!.latencyMs).toBe(200);
  });

  it('does NOT record summarizer telemetry when no overflow occurred', async () => {
    const turnCtx = baseTurnCtx();
    turnCtx.recentTurns = manyTurns(2);
    const { deps, calls } = makeDeps({ turnCtx });
    deps.summarizer = {
      async summarize() {
        throw new Error('should not be called');
      },
    };
    await handleTurn(baseRequest, deps);
    // Only the conversational model_call, no summarizer record
    expect(calls.modelCallRecords).toHaveLength(1);
    expect(calls.modelCallRecords[0].escalationReason).not.toBe('summarizer_overflow');
  });
});

// ---------- Per-patient rate limit (spec §11.6) ----------

describe('handleTurn — per-patient rate limit', () => {
  function rateLimitDeps(
    decision: {
      allowed: boolean;
      softCapReached: boolean;
      callsToday: number;
      remainingHard: number;
    },
  ): { deps: HandlerDeps; calls: CapturedCalls; rateLimiterCalls: string[] } {
    const built = makeDeps();
    const rateLimiterCalls: string[] = [];
    built.deps.rateLimiter = {
      async check(patientId) {
        rateLimiterCalls.push(patientId);
        return decision;
      },
    };
    return { ...built, rateLimiterCalls };
  }

  it('proceeds normally when under soft cap', async () => {
    const { deps, calls, rateLimiterCalls } = rateLimitDeps({
      allowed: true,
      softCapReached: false,
      callsToday: 50,
      remainingHard: 450,
    });
    const result = await handleTurn(baseRequest, deps);
    expect(result.statusCode).toBe(200);
    expect(rateLimiterCalls).toEqual(['patient-1']);
    const body = JSON.parse(result.body);
    expect(body.telemetry.softCapReached).toBe(false);
    expect(calls.rateLimitAlertsEnqueued).toEqual([]);
  });

  it('proceeds with softCapReached=true in telemetry between soft and hard', async () => {
    const { deps, calls } = rateLimitDeps({
      allowed: true,
      softCapReached: true,
      callsToday: 250,
      remainingHard: 250,
    });
    const result = await handleTurn(baseRequest, deps);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.telemetry.softCapReached).toBe(true);
    expect(calls.rateLimitAlertsEnqueued).toEqual([]); // no alert until hard cap
  });

  it('throws HandlerError(429) at hard cap', async () => {
    const { deps } = rateLimitDeps({
      allowed: false,
      softCapReached: true,
      callsToday: 500,
      remainingHard: 0,
    });
    await expect(handleTurn(baseRequest, deps)).rejects.toThrow(HandlerError);
    try {
      await handleTurn(baseRequest, deps);
    } catch (e) {
      if (e instanceof HandlerError) {
        expect(e.statusCode).toBe(429);
        expect(e.code).toBe('rate_limit_exceeded');
      }
    }
  });

  it('enqueues a rate_limit alert at hard cap', async () => {
    const { deps, calls } = rateLimitDeps({
      allowed: false,
      softCapReached: true,
      callsToday: 500,
      remainingHard: 0,
    });
    await expect(handleTurn(baseRequest, deps)).rejects.toThrow(HandlerError);
    expect(calls.rateLimitAlertsEnqueued).toHaveLength(1);
    const alert = calls.rateLimitAlertsEnqueued[0];
    expect(alert.alertType).toBe('rate_limit');
    expect(alert.patientId).toBe('patient-1');
    expect(alert.callsToday).toBe(500);
    expect(alert.hardLimit).toBe(500);
  });

  it('skips Bedrock invocation entirely on hard-cap rejection', async () => {
    const { deps, calls } = rateLimitDeps({
      allowed: false,
      softCapReached: true,
      callsToday: 600,
      remainingHard: 0,
    });
    await expect(handleTurn(baseRequest, deps)).rejects.toThrow(HandlerError);
    expect(calls.invokeCalls).toEqual([]);
    expect(calls.modelCallRecords).toEqual([]);
    // Not even patient/turn context loaded
    expect(calls.patientLoadCalls).toEqual([]);
  });

  it('handles missing rateLimiter as graceful no-op (allowed)', async () => {
    const { deps } = makeDeps();
    deps.rateLimiter = undefined;
    const result = await handleTurn(baseRequest, deps);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.telemetry.softCapReached).toBe(false);
  });

  it('still throws 429 even when alertEnqueuer is undefined (no silent acceptance)', async () => {
    const { deps } = rateLimitDeps({
      allowed: false,
      softCapReached: true,
      callsToday: 500,
      remainingHard: 0,
    });
    deps.alertEnqueuer = undefined;
    await expect(handleTurn(baseRequest, deps)).rejects.toThrow(HandlerError);
  });
});

describe('handleTurnStream — per-patient rate limit', () => {
  it('emits error event and throws on hard-cap rejection', async () => {
    const { deps } = makeDeps();
    deps.rateLimiter = {
      async check() {
        return { allowed: false, softCapReached: true, callsToday: 500, remainingHard: 0 };
      },
    };
    const emitter = new CollectingSseEmitter();
    await expect(handleTurnStream(baseRequest, deps, emitter)).rejects.toThrow(HandlerError);
    const errorEvent = emitter.events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === 'error') {
      expect(errorEvent.data.code).toBe('rate_limit_exceeded');
    }
  });

  it('telemetry event carries softCapReached=true between soft and hard', async () => {
    const { deps } = makeDeps();
    deps.rateLimiter = {
      async check() {
        return { allowed: true, softCapReached: true, callsToday: 250, remainingHard: 250 };
      },
    };
    const emitter = new CollectingSseEmitter();
    await handleTurnStream(baseRequest, deps, emitter);
    const telemetry = emitter.events.find((e) => e.type === 'telemetry');
    expect(telemetry).toBeDefined();
    if (telemetry && telemetry.type === 'telemetry') {
      expect(telemetry.data.softCapReached).toBe(true);
    }
  });
});

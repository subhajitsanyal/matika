import { resolve } from 'node:path';
import { handleTurn, HandlerDeps, TurnRequest, _resetSystemPromptCache } from '../src/handler';
import type { BedrockInvoker, InvokeInput, InvokeResult } from '../src/bedrock_client';
import type {
  PatientContextLoader,
  TurnContextLoader,
  PatientContext,
  TurnContext,
} from '../src/context/types';
import type { SessionPersister, ModelCallRecorder, SessionUpdate } from '../src/db';
import type { ModelCallRecord } from '../src/telemetry';

const SYSTEM_PROMPT_PATH = resolve(__dirname, '..', 'prompts', 'system_v2.md');

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
}

function makeDeps(opts: {
  patientCtx?: PatientContext;
  turnCtx?: TurnContext;
  invokeResult?: InvokeResult;
  invokeError?: Error;
  patientLoadError?: Error;
  turnLoadError?: Error;
  nowSequence?: number[];
} = {}): { deps: HandlerDeps; calls: CapturedCalls } {
  const calls: CapturedCalls = {
    invokeCalls: [],
    patientLoadCalls: [],
    turnLoadCalls: [],
    persisterUpdates: [],
    modelCallRecords: [],
  };

  const bedrock: BedrockInvoker = {
    async invoke(input: InvokeInput): Promise<InvokeResult> {
      calls.invokeCalls.push(input);
      if (opts.invokeError) throw opts.invokeError;
      return opts.invokeResult ?? makeInvokeResult();
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
      config: {
        haikuModelId: 'apac.anthropic.claude-haiku-4-5-v1:0',
        sonnetModelId: 'apac.anthropic.claude-sonnet-4-x-v1:0',
        guardrailId: 'matika-test-guardrail',
        guardrailVersion: 'DRAFT',
        inferenceRegion: 'ap-southeast-1',
        maxTokens: 1024,
        systemPromptPath: SYSTEM_PROMPT_PATH,
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

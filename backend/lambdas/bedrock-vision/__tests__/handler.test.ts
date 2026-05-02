import { resolve } from 'node:path';
import {
  handlePhotoExtract,
  PhotoExtractRequest,
  VisionHandlerDeps,
  VisionHandlerError,
  _resetPromptCache,
} from '../src/handler';
import type { BedrockVisionInvoker, VisionInvokeInput, VisionInvokeResult } from '../src/bedrock_client';
import type { PhotoLoader } from '../src/s3_loader';
import type { VisionModelCallRecord, VisionModelCallRecorder } from '../src/telemetry';

const PROMPT_PATH = resolve(__dirname, '..', 'prompts', 'extract_value.md');

function makeInvokeResult(overrides: Partial<VisionInvokeResult> = {}): VisionInvokeResult {
  return {
    responseText: '<output>{"value":142,"unit":"mg/dL","confidence":0.96,"rationale":"clear"}</output>',
    inputTokens: 1500,
    cachedInputTokens: 1200,
    outputTokens: 30,
    guardrailBlocked: false,
    inferenceRegion: 'ap-southeast-1',
    ...overrides,
  };
}

interface CapturedCalls {
  photoLoadCalls: string[];
  invokeCalls: VisionInvokeInput[];
  modelCallRecords: VisionModelCallRecord[];
}

function makeDeps(opts: {
  invokeResults?: VisionInvokeResult[]; // sequential — first call returns [0], second returns [1]
  invokeError?: Error;
  photoLoadError?: Error;
  haikuConfidenceThreshold?: number;
} = {}): { deps: VisionHandlerDeps; calls: CapturedCalls } {
  const calls: CapturedCalls = { photoLoadCalls: [], invokeCalls: [], modelCallRecords: [] };
  let invokeIdx = 0;
  const bedrock: BedrockVisionInvoker = {
    async invoke(input) {
      calls.invokeCalls.push(input);
      if (opts.invokeError) throw opts.invokeError;
      const idx = invokeIdx++;
      const result = opts.invokeResults?.[idx] ?? makeInvokeResult();
      return result;
    },
  };
  const photoLoader: PhotoLoader = {
    async load(key) {
      calls.photoLoadCalls.push(key);
      if (opts.photoLoadError) throw opts.photoLoadError;
      return { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mediaType: 'image/jpeg' };
    },
  };
  const modelCallRecorder: VisionModelCallRecorder = {
    async record(record) {
      calls.modelCallRecords.push(record);
    },
  };

  let counter = 1_000_000;
  const now = () => (counter += 100);

  return {
    deps: {
      bedrock,
      photoLoader,
      modelCallRecorder,
      config: {
        haikuModelId: 'apac.anthropic.claude-haiku-4-5-v1:0',
        sonnetModelId: 'apac.anthropic.claude-sonnet-4-x-v1:0',
        guardrailId: 'matika-test-guardrail',
        guardrailVersion: 'DRAFT',
        inferenceRegion: 'ap-southeast-1',
        maxTokens: 512,
        promptPath: PROMPT_PATH,
        haikuConfidenceThreshold: opts.haikuConfidenceThreshold ?? 0.8,
      },
      now,
    },
    calls,
  };
}

const baseRequest: PhotoExtractRequest = {
  sessionId: 'session-1',
  patientId: 'patient-1',
  photoS3Key: 'interactions/p1/2026/05/02/s1/photos/uuid.jpg',
  expectedParameter: 'blood_glucose',
  expectedUnit: 'mg/dL',
  deviceHint: 'glucometer',
};

beforeEach(() => {
  _resetPromptCache();
});

describe('handlePhotoExtract — Haiku confident (no escalation)', () => {
  it('returns 200 with extracted value at T2_VISION', async () => {
    const { deps, calls } = makeDeps();
    const result = await handlePhotoExtract(baseRequest, deps);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.extractedValue).toEqual({
      parameter: 'blood_glucose',
      value: 142,
      unit: 'mg/dL',
      loincCode: '2339-0',
      confidence: 0.96,
      source: 'apac.anthropic.claude-haiku-4-5-v1:0-vision',
    });
    expect(body.telemetry.tier).toBe('T2_VISION');
    expect(body.telemetry.sonnetUsed).toBe(false);
    expect(body.telemetry.sonnetLatencyMs).toBeUndefined();

    expect(calls.invokeCalls).toHaveLength(1);
    expect(calls.modelCallRecords).toHaveLength(1);
    expect(calls.modelCallRecords[0].tier).toBe('T2_VISION');
    expect(calls.modelCallRecords[0].escalationReason).toBeNull();
  });

  it('loads photo from S3 with the supplied key', async () => {
    const { deps, calls } = makeDeps();
    await handlePhotoExtract(baseRequest, deps);
    expect(calls.photoLoadCalls).toEqual([
      'interactions/p1/2026/05/02/s1/photos/uuid.jpg',
    ]);
  });

  it('passes the image bytes and media type to Bedrock', async () => {
    const { deps, calls } = makeDeps();
    await handlePhotoExtract(baseRequest, deps);
    expect(calls.invokeCalls[0].imageMediaType).toBe('image/jpeg');
    expect(calls.invokeCalls[0].imageBytes).toBeInstanceOf(Uint8Array);
  });

  it('renders userText with expected parameter, unit, device hint', async () => {
    const { deps, calls } = makeDeps();
    await handlePhotoExtract(baseRequest, deps);
    const userText = calls.invokeCalls[0].userText;
    expect(userText).toContain('Expected parameter: blood_glucose');
    expect(userText).toContain('Expected unit: mg/dL');
    expect(userText).toContain('Device type hint: glucometer');
  });

  it('includes localOcrAttempt hint when provided', async () => {
    const { deps, calls } = makeDeps();
    await handlePhotoExtract(
      { ...baseRequest, localOcrAttempt: { rawText: '142', confidence: 0.62 } },
      deps,
    );
    const userText = calls.invokeCalls[0].userText;
    expect(userText).toContain('rawText="142"');
    expect(userText).toContain('confidence=0.62');
  });

  it('uses the system prompt from disk', async () => {
    const { deps, calls } = makeDeps();
    await handlePhotoExtract(baseRequest, deps);
    const systemPrompt = calls.invokeCalls[0].systemPrompt;
    expect(systemPrompt.length).toBeGreaterThan(500);
    expect(systemPrompt).toContain('medical-device-display reader');
  });
});

describe('handlePhotoExtract — Haiku low confidence escalates to Sonnet', () => {
  it('routes to Sonnet when Haiku confidence < threshold', async () => {
    const lowConfidenceHaiku = makeInvokeResult({
      responseText: '<output>{"value":140,"unit":"mg/dL","confidence":0.55,"rationale":"glare"}</output>',
    });
    const sonnetClear = makeInvokeResult({
      responseText: '<output>{"value":142,"unit":"mg/dL","confidence":0.92,"rationale":"clearer view after re-analysis"}</output>',
      inputTokens: 2000,
      outputTokens: 50,
    });
    const { deps, calls } = makeDeps({ invokeResults: [lowConfidenceHaiku, sonnetClear] });
    const result = await handlePhotoExtract(baseRequest, deps);

    expect(calls.invokeCalls).toHaveLength(2);
    expect(calls.invokeCalls[0].modelId).toBe('apac.anthropic.claude-haiku-4-5-v1:0');
    expect(calls.invokeCalls[1].modelId).toBe('apac.anthropic.claude-sonnet-4-x-v1:0');

    expect(calls.modelCallRecords).toHaveLength(2);
    expect(calls.modelCallRecords[0].tier).toBe('T2_VISION');
    expect(calls.modelCallRecords[0].escalationReason).toBe('vision_low_confidence');
    expect(calls.modelCallRecords[1].tier).toBe('T3_VISION');
    expect(calls.modelCallRecords[1].escalationReason).toBeNull();

    const body = JSON.parse(result.body);
    expect(body.telemetry.tier).toBe('T3_VISION');
    expect(body.telemetry.sonnetUsed).toBe(true);
    expect(body.telemetry.sonnetLatencyMs).toBeDefined();
    expect(body.extractedValue.value).toBe(142); // Sonnet's reading wins
  });

  it('escalates when Haiku response fails to parse', async () => {
    const haikuMalformed = makeInvokeResult({ responseText: 'no output tags' });
    const sonnetGood = makeInvokeResult({
      responseText: '<output>{"value":142,"unit":"mg/dL","confidence":0.85,"rationale":"sonnet read"}</output>',
    });
    const { deps, calls } = makeDeps({ invokeResults: [haikuMalformed, sonnetGood] });
    const result = await handlePhotoExtract(baseRequest, deps);

    expect(calls.invokeCalls).toHaveLength(2);
    expect(calls.modelCallRecords[0].escalationReason).toBe('vision_low_confidence');
    expect(JSON.parse(result.body).telemetry.sonnetUsed).toBe(true);
  });

  it('returns Sonnet result even when Sonnet confidence is low', async () => {
    const lowHaiku = makeInvokeResult({
      responseText: '<output>{"value":140,"unit":"mg/dL","confidence":0.4,"rationale":"glare"}</output>',
    });
    const stillLowSonnet = makeInvokeResult({
      responseText: '<output>{"value":142,"unit":"mg/dL","confidence":0.6,"rationale":"sonnet uncertain too"}</output>',
    });
    const { deps } = makeDeps({ invokeResults: [lowHaiku, stillLowSonnet] });
    const result = await handlePhotoExtract(baseRequest, deps);
    const body = JSON.parse(result.body);
    expect(body.telemetry.tier).toBe('T3_VISION');
    expect(body.extractedValue.confidence).toBe(0.6);
  });

  it('respects custom confidence threshold', async () => {
    const okAtDefault = makeInvokeResult({
      responseText: '<output>{"value":142,"unit":"mg/dL","confidence":0.85,"rationale":"ok"}</output>',
    });
    const sonnetClear = makeInvokeResult({
      responseText: '<output>{"value":142,"unit":"mg/dL","confidence":0.97,"rationale":"clearer"}</output>',
    });
    const { deps, calls } = makeDeps({
      invokeResults: [okAtDefault, sonnetClear],
      haikuConfidenceThreshold: 0.95,
    });
    await handlePhotoExtract(baseRequest, deps);
    expect(calls.invokeCalls).toHaveLength(2); // 0.85 < 0.95 → escalate
  });
});

describe('handlePhotoExtract — extraction failure (422)', () => {
  it('throws VisionHandlerError(422) when both tiers fail to parse', async () => {
    const haikuMalformed = makeInvokeResult({ responseText: 'no tags' });
    const sonnetMalformed = makeInvokeResult({ responseText: 'still no tags' });
    const { deps, calls } = makeDeps({ invokeResults: [haikuMalformed, sonnetMalformed] });
    await expect(handlePhotoExtract(baseRequest, deps)).rejects.toThrow(VisionHandlerError);
    try {
      await handlePhotoExtract(baseRequest, deps);
    } catch (e) {
      if (e instanceof VisionHandlerError) {
        expect(e.statusCode).toBe(422);
        expect(e.code).toBe('vision_extraction_failed');
      }
    }
    // Both calls recorded
    expect(calls.modelCallRecords.length).toBeGreaterThanOrEqual(2);
  });
});

describe('handlePhotoExtract — input validation', () => {
  it('throws 400 on missing photoS3Key', async () => {
    const { deps } = makeDeps();
    await expect(handlePhotoExtract({ ...baseRequest, photoS3Key: '' }, deps))
      .rejects.toThrow(/photoS3Key/);
  });

  it('throws 400 on missing expectedParameter', async () => {
    const { deps } = makeDeps();
    await expect(handlePhotoExtract({ ...baseRequest, expectedParameter: '' }, deps))
      .rejects.toThrow(/expectedParameter/);
  });

  it('throws 400 on unknown expectedParameter (no LOINC mapping)', async () => {
    const { deps } = makeDeps();
    await expect(
      handlePhotoExtract({ ...baseRequest, expectedParameter: 'fictional_vital' }, deps),
    ).rejects.toThrow(/Unknown expectedParameter/);
  });
});

describe('handlePhotoExtract — error propagation', () => {
  it('propagates S3 load errors before invoking Bedrock', async () => {
    const { deps, calls } = makeDeps({ photoLoadError: new Error('S3 NoSuchKey') });
    await expect(handlePhotoExtract(baseRequest, deps)).rejects.toThrow(/NoSuchKey/);
    expect(calls.invokeCalls).toEqual([]);
    expect(calls.modelCallRecords).toEqual([]);
  });

  it('propagates Bedrock errors', async () => {
    const { deps } = makeDeps({ invokeError: new Error('Bedrock 503') });
    await expect(handlePhotoExtract(baseRequest, deps)).rejects.toThrow('Bedrock 503');
  });
});

describe('handlePhotoExtract — LOINC code mapping', () => {
  it('returns the right LOINC code for each parameter', async () => {
    const cases: Array<{ param: string; loinc: string }> = [
      { param: 'blood_pressure_systolic', loinc: '8480-6' },
      { param: 'blood_pressure_diastolic', loinc: '8462-4' },
      { param: 'blood_glucose', loinc: '2339-0' },
      { param: 'spo2', loinc: '2708-6' },
      { param: 'heart_rate', loinc: '8867-4' },
      { param: 'body_weight', loinc: '29463-7' },
    ];
    for (const c of cases) {
      const { deps } = makeDeps();
      const result = await handlePhotoExtract(
        { ...baseRequest, expectedParameter: c.param },
        deps,
      );
      const body = JSON.parse(result.body);
      expect(body.extractedValue.loincCode).toBe(c.loinc);
    }
  });
});

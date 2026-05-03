// Caregiver-onboarding protocol extractor (T-V2-302).
//
// Architecture choice (option B in the design doc): when a
// caregiver-onboarding session emits a `complete_session` action, we run
// a separate Sonnet call against the full transcript and extract a
// structured ProtocolDraft. The conversation prompt itself stays
// pure-conversation (extractedValues: [] always) — this isolated
// extraction pass is the only place that produces machine-readable
// protocol data.
//
// Why a separate pass:
//   1. The caregiver UX is conversational and iterative — turn-by-turn
//      delta emission would force the model to re-emit consistent state
//      every turn, which it doesn't reliably do.
//   2. Using Sonnet (T3) gives us higher accuracy on structured
//      extraction than Haiku, and we only pay for it once per session.
//   3. The transcript is preserved in interaction_sessions.transcript_history,
//      so a failed extraction can be retried post-hoc without losing data.
//
// Cost: ~$0.05 per session at Sonnet pricing for typical 10–15 turn
// onboarding flows. Negligible at pilot scale.

import { readFileSync } from 'node:fs';

import type { BedrockInvoker, InvokeResult } from './bedrock_client';
import { buildBedrockBody } from './prompt_builder';
import type { Turn } from './context/types';

// ---------- Public types ----------

export type ProtocolTopicName =
  | 'medications'
  | 'conditions'
  | 'allergies'
  | 'dietary_restrictions'
  | 'recent_hospitalizations'
  | 'emergency_contacts';

export type ProtocolTopicStatus = 'incomplete' | 'complete' | 'outdated';

export interface ProtocolParameter {
  parameterName: string;
  displayName: string;
  loincCode: string;
  unit: string;
  frequencyDays: number;
  dailyDeadline: string; // HH:MM, 24-hour
  timezone: string;
  thresholdMin: number | null;
  thresholdMax: number | null;
}

export interface ProtocolTopic {
  topicName: ProtocolTopicName;
  status: ProtocolTopicStatus;
  collectedData: Record<string, unknown> | null;
}

export interface ProtocolDraft {
  parameters: ProtocolParameter[];
  topics: ProtocolTopic[];
}

export interface ProtocolExtractor {
  extract(transcript: readonly Turn[]): Promise<ProtocolExtractionResult>;
}

export interface ProtocolExtractionResult {
  draft: ProtocolDraft;
  // Telemetry surfaces alongside the extraction so the caller can record
  // a model_call row (escalation_reason: 'caregiver_protocol_design').
  meta: InvokeResult;
}

// ---------- Errors ----------

export type ExtractionFailureKind =
  | 'no_output_tags'
  | 'multiple_output_tags'
  | 'invalid_json'
  | 'invalid_shape';

export class ProtocolExtractionError extends Error {
  constructor(
    public readonly kind: ExtractionFailureKind,
    message: string,
    public readonly raw: string,
  ) {
    super(message);
    this.name = 'ProtocolExtractionError';
  }
}

// ---------- Implementation ----------

const OUTPUT_TAG_REGEX = /<output>([\s\S]*?)<\/output>/g;

const ALLOWED_TOPIC_NAMES: ReadonlySet<string> = new Set<ProtocolTopicName>([
  'medications',
  'conditions',
  'allergies',
  'dietary_restrictions',
  'recent_hospitalizations',
  'emergency_contacts',
]);

const ALLOWED_TOPIC_STATUSES: ReadonlySet<string> = new Set<ProtocolTopicStatus>([
  'incomplete',
  'complete',
  'outdated',
]);

export class SonnetProtocolExtractor implements ProtocolExtractor {
  private cachedSystemPrompt: string | null = null;

  constructor(
    private readonly bedrock: BedrockInvoker,
    private readonly modelId: string,
    private readonly inferenceRegion: string,
    private readonly promptPath: string,
    private readonly maxTokens: number = 2048,
  ) {}

  async extract(transcript: readonly Turn[]): Promise<ProtocolExtractionResult> {
    if (this.cachedSystemPrompt === null) {
      this.cachedSystemPrompt = readFileSync(this.promptPath, 'utf8');
    }

    const userText = renderTranscriptForExtraction(transcript);
    const body = buildBedrockBody({
      systemPrompt: this.cachedSystemPrompt,
      // We don't have a per-patient block here — the caregiver's transcript
      // already names the patient — but the prompt builder requires a
      // non-empty perPatientBlock. Send a single-line placeholder.
      perPatientBlock: '(no per-patient context — see transcript)',
      perTurnBlock: userText,
      maxTokens: this.maxTokens,
    });

    const meta = await this.bedrock.invoke({
      modelId: this.modelId,
      body,
      configuredRegion: this.inferenceRegion,
    });

    const draft = parseProtocolDraft(meta.responseText);
    return { draft, meta };
  }
}

// Renders the transcript as a simple `caregiver:`/`assistant:` log so
// Sonnet can read it sequentially.
//
// Storage roles are `'patient' | 'caregiver' | 'system'`. In a
// caregiver_onboarding session, the speaker on the user side is the
// caregiver (the system records their utterances under the `'patient'`
// role for storage uniformity); the LLM's response is stored as
// `'system'`. We rename both for the extractor's eyes:
//   patient/caregiver → "caregiver"  (this is caregiver-onboarding)
//   system            → "assistant"  (more natural for the extractor)
export function renderTranscriptForExtraction(transcript: readonly Turn[]): string {
  if (transcript.length === 0) {
    return '## Caregiver-onboarding transcript\n\n_(empty)_';
  }
  const lines = ['## Caregiver-onboarding transcript', ''];
  for (const t of transcript) {
    const role = t.role === 'system' ? 'assistant' : 'caregiver';
    lines.push(`**${role}:** ${t.text}`);
  }
  lines.push('');
  lines.push('Now emit the structured protocol per the system instructions.');
  return lines.join('\n');
}

export function parseProtocolDraft(rawLlmText: string): ProtocolDraft {
  const matches = [...rawLlmText.matchAll(OUTPUT_TAG_REGEX)];
  if (matches.length === 0) {
    throw new ProtocolExtractionError(
      'no_output_tags',
      'No <output>...</output> block found in protocol-extractor response.',
      rawLlmText,
    );
  }
  if (matches.length > 1) {
    throw new ProtocolExtractionError(
      'multiple_output_tags',
      `Found ${matches.length} <output> blocks; expected exactly one.`,
      rawLlmText,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(matches[0][1].trim());
  } catch (err) {
    throw new ProtocolExtractionError(
      'invalid_json',
      `JSON.parse failed: ${(err as Error).message}`,
      rawLlmText,
    );
  }

  return validateProtocolDraft(parsed, rawLlmText);
}

function validateProtocolDraft(parsed: unknown, raw: string): ProtocolDraft {
  if (parsed === null || typeof parsed !== 'object') {
    throw new ProtocolExtractionError('invalid_shape', 'Top-level value is not an object', raw);
  }
  const obj = parsed as { parameters?: unknown; topics?: unknown };

  if (!Array.isArray(obj.parameters)) {
    throw new ProtocolExtractionError('invalid_shape', '`parameters` must be an array', raw);
  }
  if (!Array.isArray(obj.topics)) {
    throw new ProtocolExtractionError('invalid_shape', '`topics` must be an array', raw);
  }

  const parameters = obj.parameters.map((p, i) => validateParameter(p, i, raw));
  const topics = obj.topics
    .map((t, i) => validateTopic(t, i, raw))
    // Drop topics with unknown names rather than failing the whole draft —
    // be lenient on outputs since the persister also filters.
    .filter((t): t is ProtocolTopic => t !== null);

  return { parameters, topics };
}

function validateParameter(p: unknown, idx: number, raw: string): ProtocolParameter {
  if (p === null || typeof p !== 'object') {
    throw new ProtocolExtractionError('invalid_shape', `parameters[${idx}] is not an object`, raw);
  }
  const obj = p as Record<string, unknown>;

  const required = ['parameterName', 'displayName', 'loincCode', 'unit', 'frequencyDays', 'dailyDeadline', 'timezone'] as const;
  for (const f of required) {
    if (obj[f] === undefined) {
      throw new ProtocolExtractionError(
        'invalid_shape',
        `parameters[${idx}].${f} is missing`,
        raw,
      );
    }
  }
  const freqDays = Number(obj.frequencyDays);
  if (!Number.isInteger(freqDays) || freqDays < 1 || freqDays > 90) {
    throw new ProtocolExtractionError(
      'invalid_shape',
      `parameters[${idx}].frequencyDays out of range (got ${obj.frequencyDays})`,
      raw,
    );
  }
  if (typeof obj.dailyDeadline !== 'string' || !/^\d{2}:\d{2}$/.test(obj.dailyDeadline)) {
    throw new ProtocolExtractionError(
      'invalid_shape',
      `parameters[${idx}].dailyDeadline must be HH:MM (got ${String(obj.dailyDeadline)})`,
      raw,
    );
  }

  return {
    parameterName: String(obj.parameterName),
    displayName: String(obj.displayName),
    loincCode: String(obj.loincCode),
    unit: String(obj.unit),
    frequencyDays: freqDays,
    dailyDeadline: obj.dailyDeadline,
    timezone: String(obj.timezone),
    thresholdMin: numericOrNull(obj.thresholdMin),
    thresholdMax: numericOrNull(obj.thresholdMax),
  };
}

function validateTopic(t: unknown, idx: number, raw: string): ProtocolTopic | null {
  if (t === null || typeof t !== 'object') {
    throw new ProtocolExtractionError('invalid_shape', `topics[${idx}] is not an object`, raw);
  }
  const obj = t as Record<string, unknown>;

  const name = String(obj.topicName ?? '');
  if (!ALLOWED_TOPIC_NAMES.has(name)) {
    return null; // unknown topic — drop, persister also no-ops on unknowns.
  }
  const status = String(obj.status ?? '');
  if (!ALLOWED_TOPIC_STATUSES.has(status)) {
    throw new ProtocolExtractionError(
      'invalid_shape',
      `topics[${idx}].status must be one of incomplete|complete|outdated (got ${status})`,
      raw,
    );
  }
  const collected =
    obj.collectedData === null || obj.collectedData === undefined
      ? null
      : (obj.collectedData as Record<string, unknown>);

  return {
    topicName: name as ProtocolTopicName,
    status: status as ProtocolTopicStatus,
    collectedData: collected,
  };
}

function numericOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

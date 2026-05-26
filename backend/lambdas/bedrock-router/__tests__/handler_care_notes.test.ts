// Handler-level integration tests for the Care Notes capture path (PRD §6.9 /
// Spec §6.10). Exercises maybeProcessCareNoteActions through handleTurn,
// using a stub CareNotesRecorder so we can assert insert/update/skip calls.

import { resolve } from 'node:path';
import { handleTurn, HandlerDeps, TurnRequest, _resetSystemPromptCache } from '../src/handler';
import type { AlertEnqueuer } from '../src/alert_queue';
import type { BedrockInvoker, InvokeInput, InvokeResult, StreamChunk } from '../src/bedrock_client';
import type {
  PatientContextLoader,
  TurnContextLoader,
  PatientContext,
  TurnContext,
  SessionType,
  SupportedLanguage,
  CareTeamMember,
} from '../src/context/types';
import type { SessionPersister, ModelCallRecorder, SessionUpdate, SessionCreateParams } from '../src/db';
import type { ModelCallRecord } from '../src/telemetry';
import type {
  CareNotesRecorder,
  CareNotesRecordInput,
  RecentAmbiguousNote,
} from '../src/care_notes_recorder';

const SYSTEM_PROMPT_PATH = resolve(__dirname, '..', 'prompts', 'system_v2.md');
const ESCALATION_SUBPROMPT_DIR = resolve(__dirname, '..', 'escalation_subprompts');

// ---------- Fixtures ----------

const JOHN_CG: CareTeamMember = { userId: 'u-johncg', name: 'John CG', relationship: 'caregiver' };
const JOHN_SMITH: CareTeamMember = { userId: 'u-johnsmith', name: 'John Smith', relationship: 'caregiver' };
const PRIYA: CareTeamMember = { userId: 'u-priya', name: 'Priya Sharma', relationship: 'caregiver' };

function basePatientCtx(careTeam: CareTeamMember[] = [JOHN_CG]): PatientContext {
  return {
    patient: {
      id: 'patient-1',
      name: 'Jane Doe',
      age: 70,
      gender: 'female',
      primaryLanguage: 'en-IN',
      conditions: ['hypertension'],
      medicalHistorySummary: null,
    },
    userId: 'user-1',
    protocol: [],
    topics: [],
    recentSessions: [],
    pendingRecommendations: [],
    careTeam,
  };
}

function baseTurnCtx(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    sessionState: {
      sessionId: 'session-care-1',
      sessionType: 'patient_logging',
      language: 'en-IN',
      fsmState: 'EXTRACTING',
      capturedThisSession: [],
      pendingConfirmation: [],
      stillNeeded: [],
    },
    recentTurns: [],
    conversationSummary: null,
    currentTranscript: 'Please tell my caregiver to add cholesterol.',
    ...overrides,
  };
}

// Bedrock response that emits exactly one record_note action. Honors the
// `mentionedName`, `noteText`, and `noteLanguage` overrides for ergonomic test
// authoring.
function makeRecordNoteResponse(args: {
  noteText: string;
  mentionedName: string | null;
  responseText?: string;
  noteLanguage?: 'en-IN' | 'hi-IN' | 'bn-IN';
  extraActions?: Array<Record<string, unknown>>;
}): InvokeResult {
  const action: Record<string, unknown> = {
    type: 'record_note',
    noteText: args.noteText,
    mentionedName: args.mentionedName,
    recipientRole: 'caregiver',
    noteLanguage: args.noteLanguage ?? 'en-IN',
  };
  const actions = [action, ...(args.extraActions ?? [])];
  const body = {
    responseText: args.responseText ?? "I'll let your caregiver know.",
    ttsHints: { language: 'en-IN', spellOutNumbers: false },
    extractedValues: [],
    actions,
    stateTransition: 'EXTRACTING -> EXTRACTING',
    escalationReason: null,
  };
  return {
    responseText: `<output>${JSON.stringify(body)}</output>`,
    inputTokens: 1500,
    cachedInputTokens: 1200,
    outputTokens: 40,
    guardrailBlocked: false,
    inferenceRegion: 'ap-south-1',
    rawStopReason: 'end_turn',
  };
}

interface RecorderCalls {
  inserts: CareNotesRecordInput[];
  updates: Array<{ id: string; recipientUserId: string; mentionedName: string | null }>;
  ambiguousLookups: string[]; // sessionIds queried
  duplicateLookups: Array<{ sessionId: string; turnIndex: number; noteText: string }>;
}

function stubRecorder(opts: {
  insertedIds?: string[];
  recentAmbiguous?: RecentAmbiguousNote | null;
  duplicate?: { id: string } | null;
  insertError?: Error;
} = {}): { recorder: CareNotesRecorder; calls: RecorderCalls } {
  const calls: RecorderCalls = {
    inserts: [],
    updates: [],
    ambiguousLookups: [],
    duplicateLookups: [],
  };
  const insertedIds = opts.insertedIds ?? ['care-note-id-1', 'care-note-id-2', 'care-note-id-3'];
  let idIdx = 0;
  const recorder: CareNotesRecorder = {
    async insert(input) {
      if (opts.insertError) throw opts.insertError;
      calls.inserts.push(input);
      return { id: insertedIds[Math.min(idIdx++, insertedIds.length - 1)] };
    },
    async findRecentAmbiguous(sessionId: string) {
      calls.ambiguousLookups.push(sessionId);
      return opts.recentAmbiguous ?? null;
    },
    async updateToResolved(id, recipientUserId, mentionedName) {
      calls.updates.push({ id, recipientUserId, mentionedName });
    },
    async findDuplicateInTurn(sessionId, turnIndex, noteText) {
      calls.duplicateLookups.push({ sessionId, turnIndex, noteText });
      return opts.duplicate ?? null;
    },
  };
  return { recorder, calls };
}

interface CapturedCalls {
  persisterUpdates: Array<{ sessionId: string; patch: SessionUpdate }>;
}

function makeDeps(opts: {
  patientCtx?: PatientContext;
  turnCtx?: TurnContext;
  invokeResult?: InvokeResult;
  recorder?: CareNotesRecorder;
  withRecorder?: boolean; // defaults to true unless explicitly false
}): { deps: HandlerDeps; captured: CapturedCalls } {
  const captured: CapturedCalls = { persisterUpdates: [] };
  const bedrock: BedrockInvoker = {
    async invoke(_input: InvokeInput): Promise<InvokeResult> {
      return opts.invokeResult ?? makeRecordNoteResponse({
        noteText: 'Patient would like cholesterol added to daily tracking.',
        mentionedName: null,
      });
    },
    invokeStream(_input: InvokeInput): AsyncIterable<StreamChunk> {
      return (async function* () {})();
    },
  };
  const patientLoader: PatientContextLoader = {
    async load() {
      return opts.patientCtx ?? basePatientCtx();
    },
  };
  const turnLoader: TurnContextLoader = {
    async load() {
      return opts.turnCtx ?? baseTurnCtx();
    },
  };
  const sessionPersister: SessionPersister = {
    async update(sessionId, patch) {
      captured.persisterUpdates.push({ sessionId, patch });
    },
  };
  const sessionCreator = {
    async create(_params: {
      sessionId: string;
      patientId: string;
      userId: string;
      sessionType: SessionType;
      language: SupportedLanguage;
    }) {},
  };
  const modelCallRecorder: ModelCallRecorder = { async record(_r: ModelCallRecord) {} };
  const alertEnqueuer: AlertEnqueuer = {
    async enqueueEmergency() {},
    async enqueueRateLimit() {},
  };

  return {
    deps: {
      bedrock,
      patientLoader,
      turnLoader,
      sessionCreator,
      sessionPersister,
      modelCallRecorder,
      alertEnqueuer,
      careNotesRecorder: opts.withRecorder === false ? undefined : (opts.recorder ?? stubRecorder().recorder),
      config: {
        haikuModelId: 'apac.anthropic.claude-haiku-4-5-v1:0',
        sonnetModelId: 'apac.anthropic.claude-sonnet-4-x-v1:0',
        inferenceRegion: 'ap-south-1',
        maxTokens: 1024,
        systemPromptPath: SYSTEM_PROMPT_PATH,
        escalationSubpromptDir: ESCALATION_SUBPROMPT_DIR,
        hardRateLimitPerPatient: 500,
      },
    },
    captured,
  };
}

function baseRequest(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    sessionId: 'session-care-1',
    patientId: 'jane-cognito',
    transcript: 'Please tell my caregiver to add cholesterol to my tracking.',
    language: 'en-IN',
    turnSequence: 4,
    ...overrides,
  };
}

beforeEach(() => _resetSystemPromptCache());

// ---------- Resolved path (specific name match) ----------

describe('record_note — resolved (named caregiver)', () => {
  it('inserts a single resolved care_notes row when the patient names one caregiver', async () => {
    const { recorder, calls } = stubRecorder();
    const { deps } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG, PRIYA]),
      invokeResult: makeRecordNoteResponse({
        noteText: 'Patient wants Priya to call this evening.',
        mentionedName: 'Priya',
      }),
      recorder,
    });
    const result = await handleTurn(baseRequest(), deps);
    expect(result.statusCode).toBe(200);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]).toMatchObject({
      patientId: 'patient-1',
      sessionId: 'session-care-1',
      turnIndex: 4,
      noteText: 'Patient wants Priya to call this evening.',
      mentionedName: 'Priya Sharma', // canonical name from care-team
      recipientUserId: 'u-priya',
      candidateUserIds: [],
      disambiguationStatus: 'resolved',
      noteLanguage: 'en-IN',
    });
    const body = JSON.parse(result.body);
    expect(body.careNotes.recorded).toBe(1);
    expect(body.careNotes.updated).toBe(0);
    expect(body.careNotes.rows[0].disambiguationStatus).toBe('resolved');
  });
});

// ---------- Resolved-default path (no name) ----------

describe('record_note — resolved_default (no name spoken)', () => {
  it('inserts with disambiguation_status=resolved_default + recipient=first caregiver', async () => {
    const { recorder, calls } = stubRecorder();
    const { deps } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG, PRIYA]),
      invokeResult: makeRecordNoteResponse({
        noteText: 'Patient would like cholesterol added to daily tracking.',
        mentionedName: null,
      }),
      recorder,
    });
    const result = await handleTurn(baseRequest(), deps);
    expect(result.statusCode).toBe(200);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].disambiguationStatus).toBe('resolved_default');
    expect(calls.inserts[0].recipientUserId).toBe('u-johncg'); // primary caregiver
    expect(calls.inserts[0].mentionedName).toBeNull();
  });
});

// ---------- Ambiguous path ----------

describe('record_note — ambiguous (multiple name matches)', () => {
  it('inserts with status=ambiguous + candidates + appends synthetic system directive', async () => {
    const { recorder, calls } = stubRecorder();
    const { deps, captured } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG, JOHN_SMITH]),
      invokeResult: makeRecordNoteResponse({
        noteText: 'Patient wants John to refill the prescription.',
        mentionedName: 'John',
      }),
      recorder,
    });
    const result = await handleTurn(baseRequest(), deps);
    expect(result.statusCode).toBe(200);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].disambiguationStatus).toBe('ambiguous');
    expect(calls.inserts[0].recipientUserId).toBeNull();
    expect(calls.inserts[0].candidateUserIds).toEqual(['u-johncg', 'u-johnsmith']);
    expect(calls.inserts[0].mentionedName).toBe('John');

    // The synthetic system message should land in transcript_history so the
    // LLM's next turn asks the disambig question.
    expect(captured.persisterUpdates).toHaveLength(1);
    const persistedHistory = captured.persisterUpdates[0].patch.transcriptHistory;
    const systemTurns = persistedHistory.filter((t) => t.role === 'system');
    // 2 system turns: the LLM's responseText + our ambiguous directive
    expect(systemTurns.length).toBeGreaterThanOrEqual(2);
    const directive = systemTurns.find((t) => t.text.includes('matched multiple people'));
    expect(directive).toBeDefined();
    expect(directive!.text).toContain('John CG, John Smith');
  });
});

// ---------- Sentinel-update path ----------

describe('record_note — sentinel update on disambiguating turn', () => {
  it('UPDATEs the prior ambiguous row when the patient names one of the candidates', async () => {
    const { recorder, calls } = stubRecorder({
      recentAmbiguous: {
        id: 'prior-ambiguous-1',
        mentionedName: 'John',
        candidateUserIds: ['u-johncg', 'u-johnsmith'],
      },
    });
    const { deps } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG, JOHN_SMITH]),
      invokeResult: makeRecordNoteResponse({
        noteText: 'Patient confirmed John CG should refill.',
        mentionedName: 'John CG',
      }),
      recorder,
    });
    const result = await handleTurn(baseRequest({ turnSequence: 5 }), deps);
    expect(result.statusCode).toBe(200);
    expect(calls.inserts).toHaveLength(0); // no new row
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toEqual({
      id: 'prior-ambiguous-1',
      recipientUserId: 'u-johncg',
      mentionedName: 'John CG',
    });
    const body = JSON.parse(result.body);
    expect(body.careNotes.updated).toBe(1);
    expect(body.careNotes.recorded).toBe(0);
  });

  it('does NOT clobber the prior ambiguous when the new resolution is unrelated', async () => {
    const { recorder, calls } = stubRecorder({
      recentAmbiguous: {
        id: 'prior-ambiguous-1',
        mentionedName: 'John',
        candidateUserIds: ['u-johncg', 'u-johnsmith'],
      },
    });
    // Patient says "Priya" — totally different person, not in prior candidates.
    const { deps } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG, JOHN_SMITH, PRIYA]),
      invokeResult: makeRecordNoteResponse({
        noteText: 'Patient wants Priya to bring tea.',
        mentionedName: 'Priya',
      }),
      recorder,
    });
    await handleTurn(baseRequest(), deps);
    expect(calls.updates).toHaveLength(0);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].recipientUserId).toBe('u-priya');
  });
});

// ---------- No_match path ----------

describe('record_note — no_match (name not in care team)', () => {
  it('inserts row with disambiguation_status=no_match and raw mentioned_name preserved', async () => {
    const { recorder, calls } = stubRecorder();
    const { deps } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG]),
      invokeResult: makeRecordNoteResponse({
        noteText: 'Patient wants Aunt Padma to come over.',
        mentionedName: 'Padma',
      }),
      recorder,
    });
    await handleTurn(baseRequest(), deps);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].disambiguationStatus).toBe('no_match');
    expect(calls.inserts[0].recipientUserId).toBeNull();
    expect(calls.inserts[0].mentionedName).toBe('Padma');
  });
});

// ---------- Cap (2 per turn) ----------

describe('record_note — 2-per-turn cap (Spec §6.4)', () => {
  it('processes the first two record_note actions and drops the rest', async () => {
    const { recorder, calls } = stubRecorder();
    const { deps } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG]),
      invokeResult: makeRecordNoteResponse({
        noteText: 'first note',
        mentionedName: null,
        extraActions: [
          { type: 'record_note', noteText: 'second note', mentionedName: null, recipientRole: 'caregiver', noteLanguage: 'en-IN' },
          { type: 'record_note', noteText: 'third note', mentionedName: null, recipientRole: 'caregiver', noteLanguage: 'en-IN' },
        ],
      }),
      recorder,
    });
    await handleTurn(baseRequest(), deps);
    expect(calls.inserts).toHaveLength(2);
    expect(calls.inserts.map((i) => i.noteText)).toEqual(['first note', 'second note']);
  });
});

// ---------- Idempotency ----------

describe('record_note — idempotency (Spec §6.10 #6)', () => {
  it('skips insert when (sessionId, turnIndex, noteText) already exists', async () => {
    const { recorder, calls } = stubRecorder({
      duplicate: { id: 'pre-existing-note' },
    });
    const { deps } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG]),
      invokeResult: makeRecordNoteResponse({
        noteText: 'Patient wants cholesterol on tracking.',
        mentionedName: null,
      }),
      recorder,
    });
    const result = await handleTurn(baseRequest(), deps);
    expect(calls.inserts).toHaveLength(0);
    const body = JSON.parse(result.body);
    expect(body.careNotes.skippedDuplicate).toBe(1);
    expect(body.careNotes.rows[0].id).toBe('pre-existing-note');
  });
});

// ---------- Empty noteText rejection ----------

describe('record_note — empty noteText rejection', () => {
  it('reports failure without inserting when noteText is empty or whitespace', async () => {
    const { recorder, calls } = stubRecorder();
    const { deps } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG]),
      invokeResult: makeRecordNoteResponse({
        noteText: '   ',
        mentionedName: null,
      }),
      recorder,
    });
    const result = await handleTurn(baseRequest(), deps);
    expect(calls.inserts).toHaveLength(0);
    const body = JSON.parse(result.body);
    expect(body.careNotes.failed).toBe(1);
    expect(body.careNotes.errors[0]).toMatch(/missing noteText/i);
  });
});

// ---------- Skip conditions ----------

describe('record_note — skip when not applicable', () => {
  it('does nothing when no record_note action is emitted (regression guard)', async () => {
    const { recorder, calls } = stubRecorder();
    // Default makeRecordNoteResponse emits one — override with a plain action.
    const noActionResult: InvokeResult = {
      responseText: `<output>${JSON.stringify({
        responseText: 'Saved.',
        ttsHints: { language: 'en-IN', spellOutNumbers: false },
        extractedValues: [],
        actions: [],
        stateTransition: 'EXTRACTING -> EXTRACTING',
        escalationReason: null,
      })}</output>`,
      inputTokens: 100,
      cachedInputTokens: 80,
      outputTokens: 5,
      guardrailBlocked: false,
      inferenceRegion: 'ap-south-1',
      rawStopReason: 'end_turn',
    };
    const { deps } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG]),
      invokeResult: noActionResult,
      recorder,
    });
    const result = await handleTurn(baseRequest(), deps);
    expect(calls.inserts).toHaveLength(0);
    expect(calls.duplicateLookups).toHaveLength(0);
    expect(calls.ambiguousLookups).toHaveLength(0);
    const body = JSON.parse(result.body);
    expect(body.careNotes).toBeUndefined();
  });

  it('skips when sessionType is caregiver_onboarding (no patient-asides on caregiver turns)', async () => {
    const { recorder, calls } = stubRecorder();
    const { deps } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG]),
      turnCtx: baseTurnCtx({
        sessionState: {
          sessionId: 'session-care-1',
          sessionType: 'caregiver_onboarding',
          language: 'en-IN',
          fsmState: 'EXTRACTING',
          capturedThisSession: [],
          pendingConfirmation: [],
          stillNeeded: [],
        },
      }),
      recorder,
    });
    await handleTurn(baseRequest(), deps);
    expect(calls.inserts).toHaveLength(0);
  });

  it('skips silently (warn only) when no recorder is wired in deps', async () => {
    const { deps } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG]),
      withRecorder: false,
    });
    const result = await handleTurn(baseRequest(), deps);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.careNotes).toBeUndefined();
  });
});

// ---------- Persister still gets the new history ----------

describe('record_note — transcript persist', () => {
  it('persists the LLM responseText turn even when no record_note fires', async () => {
    // Regression guard for the schema-drift class: adding the care-notes
    // hook in handler.ts must not affect persist behavior on plain turns.
    const { recorder } = stubRecorder();
    const noActionResult: InvokeResult = {
      responseText: `<output>${JSON.stringify({
        responseText: 'OK',
        ttsHints: { language: 'en-IN', spellOutNumbers: false },
        extractedValues: [],
        actions: [],
        stateTransition: 'EXTRACTING -> EXTRACTING',
        escalationReason: null,
      })}</output>`,
      inputTokens: 100,
      cachedInputTokens: 80,
      outputTokens: 5,
      guardrailBlocked: false,
      inferenceRegion: 'ap-south-1',
      rawStopReason: 'end_turn',
    };
    const { deps, captured } = makeDeps({
      patientCtx: basePatientCtx([JOHN_CG]),
      invokeResult: noActionResult,
      recorder,
    });
    await handleTurn(baseRequest(), deps);
    expect(captured.persisterUpdates).toHaveLength(1);
    const history = captured.persisterUpdates[0].patch.transcriptHistory;
    expect(history.some((t) => t.role === 'patient')).toBe(true);
    expect(history.some((t) => t.role === 'system' && t.text === 'OK')).toBe(true);
  });
});

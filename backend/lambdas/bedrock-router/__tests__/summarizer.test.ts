import { resolve } from 'node:path';
import {
  HaikuSummarizer,
  renderSummarizerInput,
  _resetSummarizerPromptCache,
} from '../src/summarizer';
import type { Turn } from '../src/context/types';
import type { BedrockInvoker, InvokeInput, InvokeResult, StreamChunk } from '../src/bedrock_client';

const SUMMARIZE_PROMPT_PATH = resolve(__dirname, '..', 'prompts', 'summarize.md');

function turn(role: Turn['role'], text: string, secondsAgo: number): Turn {
  return { role, text, timestamp: new Date(Date.now() - secondsAgo * 1000) };
}

function makeInvokeResult(overrides: Partial<InvokeResult> = {}): InvokeResult {
  return {
    responseText: 'Patient confirmed a blood pressure reading of 130/85.',
    inputTokens: 320,
    cachedInputTokens: 250,
    outputTokens: 14,
    guardrailBlocked: false,
    inferenceRegion: 'ap-southeast-1',
    rawStopReason: 'end_turn',
    ...overrides,
  };
}

beforeEach(() => {
  _resetSummarizerPromptCache();
});

describe('renderSummarizerInput', () => {
  it('renders the existing summary block', () => {
    const out = renderSummarizerInput({
      existingSummary: 'Patient mentioned BP earlier.',
      overflowTurns: [turn('system', 'Hi.', 60), turn('patient', 'Hello.', 50)],
    });
    expect(out).toContain('[Existing summary]:\nPatient mentioned BP earlier.');
  });

  it('renders "(none)" when no existing summary', () => {
    const out = renderSummarizerInput({
      existingSummary: null,
      overflowTurns: [turn('system', 'Hi.', 60)],
    });
    expect(out).toContain('[Existing summary]:\n(none)');
  });

  it('renders turns as "role: text" lines, oldest first', () => {
    const out = renderSummarizerInput({
      existingSummary: null,
      overflowTurns: [
        turn('system', 'How are you feeling?', 60),
        turn('patient', 'A little tired.', 50),
        turn('system', 'BP measured today?', 40),
      ],
    });
    const lines = out.split('\n');
    const turnLines = lines.filter((l) => l.startsWith('system:') || l.startsWith('patient:'));
    expect(turnLines).toEqual([
      'system: How are you feeling?',
      'patient: A little tired.',
      'system: BP measured today?',
    ]);
  });

  it('treats whitespace-only existing summary as empty', () => {
    const out = renderSummarizerInput({
      existingSummary: '   \n  ',
      overflowTurns: [turn('system', 'Hi.', 60)],
    });
    expect(out).toContain('(none)');
  });
});

describe('HaikuSummarizer', () => {
  function makeBedrock(opts: { result?: InvokeResult; error?: Error } = {}): {
    bedrock: BedrockInvoker;
    invokeCalls: InvokeInput[];
  } {
    const invokeCalls: InvokeInput[] = [];
    const bedrock: BedrockInvoker = {
      async invoke(input) {
        invokeCalls.push(input);
        if (opts.error) throw opts.error;
        return opts.result ?? makeInvokeResult();
      },
      invokeStream(_input): AsyncIterable<StreamChunk> {
        return (async function* () {})();
      },
    };
    return { bedrock, invokeCalls };
  }

  it('throws when called with no overflow turns', async () => {
    const { bedrock } = makeBedrock();
    const summarizer = new HaikuSummarizer(
      bedrock,
      'claude-haiku-4-5',
      'ap-southeast-1',
      SUMMARIZE_PROMPT_PATH,
    );
    await expect(
      summarizer.summarize({ existingSummary: null, overflowTurns: [] }),
    ).rejects.toThrow(/no overflow turns/);
  });

  it('returns the LLM-produced summary trimmed', async () => {
    const { bedrock } = makeBedrock({
      result: makeInvokeResult({
        responseText: '   Patient reported feeling tired and confirmed BP 130/85.   \n',
      }),
    });
    const summarizer = new HaikuSummarizer(
      bedrock,
      'claude-haiku-4-5',
      'ap-southeast-1',
      SUMMARIZE_PROMPT_PATH,
    );
    const result = await summarizer.summarize({
      existingSummary: null,
      overflowTurns: [turn('system', 'How are you?', 60), turn('patient', 'Fine.', 50)],
    });
    expect(result.summary).toBe('Patient reported feeling tired and confirmed BP 130/85.');
  });

  it('includes token usage from the Bedrock response', async () => {
    const { bedrock } = makeBedrock({
      result: makeInvokeResult({
        inputTokens: 500,
        cachedInputTokens: 400,
        outputTokens: 30,
      }),
    });
    const summarizer = new HaikuSummarizer(
      bedrock,
      'claude-haiku-4-5',
      'ap-southeast-1',
      SUMMARIZE_PROMPT_PATH,
    );
    const result = await summarizer.summarize({
      existingSummary: null,
      overflowTurns: [turn('patient', 'BP is 130/85', 30)],
    });
    expect(result.usage).toEqual({
      inputTokens: 500,
      cachedInputTokens: 400,
      outputTokens: 30,
    });
  });

  it('measures latency via injected clock', async () => {
    const { bedrock } = makeBedrock();
    const ticks = [1_000_000, 1_000_127];
    let i = 0;
    const summarizer = new HaikuSummarizer(
      bedrock,
      'claude-haiku-4-5',
      'ap-southeast-1',
      SUMMARIZE_PROMPT_PATH,
      200,
      () => ticks[Math.min(i++, ticks.length - 1)],
    );
    const result = await summarizer.summarize({
      existingSummary: null,
      overflowTurns: [turn('patient', 'hi', 30)],
    });
    expect(result.latencyMs).toBe(127);
  });

  it('builds the Bedrock body with system prompt cached and a single user content', async () => {
    const { bedrock, invokeCalls } = makeBedrock();
    const summarizer = new HaikuSummarizer(
      bedrock,
      'claude-haiku-4-5',
      'ap-southeast-1',
      SUMMARIZE_PROMPT_PATH,
    );
    await summarizer.summarize({
      existingSummary: 'Earlier: patient confirmed BP 130/85.',
      overflowTurns: [turn('system', 'Anything else?', 60), turn('patient', 'No, that is all.', 50)],
    });
    const body = invokeCalls[0].body;
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
    expect(body.system).toHaveLength(1);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system[0].text.length).toBeGreaterThan(200); // real summarize.md prompt
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toHaveLength(1);
    expect(body.messages[0].content[0].text).toContain('[Existing summary]:');
    expect(body.messages[0].content[0].text).toContain('[Older turns]:');
  });

  it('uses the configured max_tokens', async () => {
    const { bedrock, invokeCalls } = makeBedrock();
    const summarizer = new HaikuSummarizer(
      bedrock,
      'claude-haiku-4-5',
      'ap-southeast-1',
      SUMMARIZE_PROMPT_PATH,
      150,
    );
    await summarizer.summarize({
      existingSummary: null,
      overflowTurns: [turn('patient', 'hi', 30)],
    });
    expect(invokeCalls[0].body.max_tokens).toBe(150);
  });

  it('passes guardrail flag through from the invoke result', async () => {
    const { bedrock } = makeBedrock({
      result: makeInvokeResult({ guardrailBlocked: true }),
    });
    const summarizer = new HaikuSummarizer(
      bedrock,
      'claude-haiku-4-5',
      'ap-southeast-1',
      SUMMARIZE_PROMPT_PATH,
    );
    const result = await summarizer.summarize({
      existingSummary: null,
      overflowTurns: [turn('patient', 'hi', 30)],
    });
    expect(result.guardrailBlocked).toBe(true);
  });

  it('propagates Bedrock errors', async () => {
    const { bedrock } = makeBedrock({ error: new Error('Bedrock 503') });
    const summarizer = new HaikuSummarizer(
      bedrock,
      'claude-haiku-4-5',
      'ap-southeast-1',
      SUMMARIZE_PROMPT_PATH,
    );
    await expect(
      summarizer.summarize({
        existingSummary: null,
        overflowTurns: [turn('patient', 'hi', 30)],
      }),
    ).rejects.toThrow(/Bedrock 503/);
  });
});

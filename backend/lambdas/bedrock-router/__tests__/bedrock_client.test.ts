import type { InvokeModelCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { parseInvokeOutput, parseStreamChunk } from '../src/bedrock_client';

function makeOutput(
  body: object,
  headers: Record<string, string> = {},
): InvokeModelCommandOutput {
  return {
    body: new TextEncoder().encode(JSON.stringify(body)) as unknown as InvokeModelCommandOutput['body'],
    contentType: 'application/json',
    $metadata: { httpStatusCode: 200, httpHeaders: headers },
  } as unknown as InvokeModelCommandOutput;
}

describe('parseInvokeOutput', () => {
  it('parses a happy-path Anthropic response', () => {
    const out = makeOutput({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello, Mr. Sharma.' }],
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1420,
      },
    });

    const result = parseInvokeOutput(out, 'ap-southeast-1');
    expect(result.responseText).toBe('Hello, Mr. Sharma.');
    expect(result.inputTokens).toBe(1520); // 100 + 0 + 1420
    expect(result.cachedInputTokens).toBe(1420);
    expect(result.outputTokens).toBe(20);
    expect(result.guardrailBlocked).toBe(false);
    expect(result.rawStopReason).toBe('end_turn');
  });

  it('concatenates multi-block content', () => {
    const out = makeOutput({
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Part one. ' },
        { type: 'text', text: 'Part two.' },
      ],
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 10 },
    });
    expect(parseInvokeOutput(out, 'ap-southeast-1').responseText).toBe('Part one. Part two.');
  });

  it('treats missing cache fields as zero', () => {
    const out = makeOutput({
      id: 'msg_3',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 200, output_tokens: 5 },
    });
    const r = parseInvokeOutput(out, 'ap-southeast-1');
    expect(r.inputTokens).toBe(200);
    expect(r.cachedInputTokens).toBe(0);
  });

  it('detects guardrail intervention via stop_reason', () => {
    const out = makeOutput({
      id: 'msg_4',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'I cannot help with that.' }],
      model: 'claude-haiku-4-5',
      stop_reason: 'guardrail_intervened',
      usage: { input_tokens: 100, output_tokens: 8 },
    });
    expect(parseInvokeOutput(out, 'ap-southeast-1').guardrailBlocked).toBe(true);
  });

  it('falls back to configured region when header is absent', () => {
    const out = makeOutput({
      id: 'msg_5',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    expect(parseInvokeOutput(out, 'us-east-1').inferenceRegion).toBe('us-east-1');
  });

  it('uses inference-region header when present', () => {
    const out = makeOutput(
      {
        id: 'msg_6',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        model: 'claude-haiku-4-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 2 },
      },
      { 'x-amzn-bedrock-inference-region': 'ap-southeast-1' },
    );
    expect(parseInvokeOutput(out, 'configured-region').inferenceRegion).toBe('ap-southeast-1');
  });

  it('throws if response body is missing', () => {
    const out = { body: undefined, $metadata: {} } as unknown as InvokeModelCommandOutput;
    expect(() => parseInvokeOutput(out, 'ap-southeast-1')).toThrow(/no body/);
  });

  it('throws if response body is not valid JSON', () => {
    const out = {
      body: new TextEncoder().encode('{not json'),
      $metadata: { httpStatusCode: 200 },
    } as unknown as InvokeModelCommandOutput;
    expect(() => parseInvokeOutput(out, 'ap-southeast-1')).toThrow(/not valid JSON/);
  });
});

describe('parseStreamChunk', () => {
  it('parses a content_block_delta with text_delta', () => {
    const chunk = parseStreamChunk(
      JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello, ' },
      }),
    );
    expect(chunk).toEqual({ type: 'text_delta', text: 'Hello, ' });
  });

  it('returns null for content_block_delta with non-text delta', () => {
    expect(
      parseStreamChunk(
        JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{}' },
        }),
      ),
    ).toBeNull();
  });

  it('parses a message_stop with usage and stop reason', () => {
    const chunk = parseStreamChunk(
      JSON.stringify({
        type: 'message_stop',
        'amazon-bedrock-invocationMetrics': {
          inputTokenCount: 100,
          outputTokenCount: 28,
          cacheReadInputTokenCount: 1420,
          cacheWriteInputTokenCount: 0,
          invocationLatency: 612,
          firstByteLatency: 200,
        },
        'amazon-bedrock-stopReason': 'end_turn',
      }),
    );
    expect(chunk).toEqual({
      type: 'message_stop',
      usage: {
        inputTokens: 1520, // 100 + 0 + 1420
        cachedInputTokens: 1420,
        outputTokens: 28,
      },
      stopReason: 'end_turn',
    });
  });

  it('returns null for message_stop without invocation metrics', () => {
    expect(
      parseStreamChunk(JSON.stringify({ type: 'message_stop' })),
    ).toBeNull();
  });

  it('returns null for unknown chunk types', () => {
    expect(parseStreamChunk(JSON.stringify({ type: 'message_start' }))).toBeNull();
    expect(parseStreamChunk(JSON.stringify({ type: 'content_block_start' }))).toBeNull();
    expect(parseStreamChunk(JSON.stringify({ type: 'ping' }))).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseStreamChunk('not json')).toBeNull();
  });

  it('treats missing cache fields as zero in message_stop', () => {
    const chunk = parseStreamChunk(
      JSON.stringify({
        type: 'message_stop',
        'amazon-bedrock-invocationMetrics': {
          inputTokenCount: 200,
          outputTokenCount: 5,
        },
      }),
    );
    expect(chunk).toEqual({
      type: 'message_stop',
      usage: {
        inputTokens: 200,
        cachedInputTokens: 0,
        outputTokens: 5,
      },
      stopReason: null,
    });
  });

  it('detects guardrail_intervened stop reason', () => {
    const chunk = parseStreamChunk(
      JSON.stringify({
        type: 'message_stop',
        'amazon-bedrock-invocationMetrics': {
          inputTokenCount: 100,
          outputTokenCount: 8,
        },
        'amazon-bedrock-stopReason': 'guardrail_intervened',
      }),
    );
    expect(chunk).toMatchObject({ type: 'message_stop', stopReason: 'guardrail_intervened' });
  });
});

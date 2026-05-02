import type { InvokeModelCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { buildVisionBody, parseVisionInvokeOutput } from '../src/bedrock_client';

function makeOutput(body: object): InvokeModelCommandOutput {
  return {
    body: new TextEncoder().encode(JSON.stringify(body)) as unknown as InvokeModelCommandOutput['body'],
    contentType: 'application/json',
    $metadata: { httpStatusCode: 200, httpHeaders: {} },
  } as unknown as InvokeModelCommandOutput;
}

describe('buildVisionBody', () => {
  const sampleImage = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes (just symbolic)

  it('produces the Anthropic-on-Bedrock vision body shape', () => {
    const body = buildVisionBody({
      modelId: 'claude-haiku-4-5',
      systemPrompt: 'You are a medical-device-display reader...',
      imageBytes: sampleImage,
      imageMediaType: 'image/jpeg',
      userText: 'Expected parameter: blood_glucose',
      configuredRegion: 'ap-southeast-1',
      maxTokens: 512,
    }) as {
      anthropic_version: string;
      max_tokens: number;
      system: Array<{ type: string; text: string; cache_control: { type: string } }>;
      messages: Array<{ role: string; content: Array<{ type: string; [k: string]: unknown }> }>;
    };

    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
    expect(body.max_tokens).toBe(512);
    expect(body.system).toHaveLength(1);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toHaveLength(2);
    expect(body.messages[0].content[0].type).toBe('image');
    expect(body.messages[0].content[1].type).toBe('text');
  });

  it('encodes image as base64', () => {
    const body = buildVisionBody({
      modelId: 'm',
      systemPrompt: 's',
      imageBytes: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
      imageMediaType: 'image/jpeg',
      userText: 'u',
      configuredRegion: 'ap-southeast-1',
      maxTokens: 100,
    }) as { messages: Array<{ content: Array<{ type: string; source?: { data: string; media_type: string; type: string } }> }> };
    const imageBlock = body.messages[0].content[0];
    expect(imageBlock.source?.type).toBe('base64');
    expect(imageBlock.source?.media_type).toBe('image/jpeg');
    expect(imageBlock.source?.data).toBe(Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64'));
  });

  it('places user text as the second content block (after image)', () => {
    const body = buildVisionBody({
      modelId: 'm',
      systemPrompt: 's',
      imageBytes: sampleImage,
      imageMediaType: 'image/jpeg',
      userText: 'Expected: blood_glucose',
      configuredRegion: 'ap-southeast-1',
      maxTokens: 100,
    }) as { messages: Array<{ content: Array<{ type: string; text?: string }> }> };
    expect(body.messages[0].content[1]).toEqual({
      type: 'text',
      text: 'Expected: blood_glucose',
    });
  });
});

describe('parseVisionInvokeOutput', () => {
  it('parses a happy-path Anthropic vision response', () => {
    const out = makeOutput({
      content: [{ type: 'text', text: '<output>{"value":142,"unit":"mg/dL","confidence":0.96,"rationale":"clear"}</output>' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 30,
        cache_read_input_tokens: 1420,
        cache_creation_input_tokens: 0,
      },
    });
    const result = parseVisionInvokeOutput(out, 'ap-southeast-1');
    expect(result.responseText).toContain('142');
    expect(result.inputTokens).toBe(1520); // 100 + 0 + 1420
    expect(result.cachedInputTokens).toBe(1420);
    expect(result.outputTokens).toBe(30);
    expect(result.guardrailBlocked).toBe(false);
    expect(result.inferenceRegion).toBe('ap-southeast-1');
  });

  it('detects guardrail intervention via stop_reason', () => {
    const out = makeOutput({
      content: [{ type: 'text', text: 'I cannot help with that.' }],
      stop_reason: 'guardrail_intervened',
      usage: { input_tokens: 100, output_tokens: 8 },
    });
    expect(parseVisionInvokeOutput(out, 'ap-southeast-1').guardrailBlocked).toBe(true);
  });

  it('treats missing cache fields as zero', () => {
    const out = makeOutput({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 200, output_tokens: 5 },
    });
    const r = parseVisionInvokeOutput(out, 'ap-southeast-1');
    expect(r.inputTokens).toBe(200);
    expect(r.cachedInputTokens).toBe(0);
  });

  it('throws on missing body', () => {
    expect(() =>
      parseVisionInvokeOutput(
        { body: undefined, $metadata: {} } as unknown as InvokeModelCommandOutput,
        'ap-southeast-1',
      ),
    ).toThrow(/no body/);
  });

  it('throws on invalid JSON', () => {
    const out = {
      body: new TextEncoder().encode('{not json'),
      $metadata: { httpStatusCode: 200 },
    } as unknown as InvokeModelCommandOutput;
    expect(() => parseVisionInvokeOutput(out, 'ap-southeast-1')).toThrow(/not valid JSON/);
  });
});

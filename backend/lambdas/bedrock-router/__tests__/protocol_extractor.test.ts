import { resolve } from 'node:path';
import {
  parseProtocolDraft,
  ProtocolExtractionError,
  renderTranscriptForExtraction,
  SonnetProtocolExtractor,
} from '../src/protocol_extractor';
import type { BedrockInvoker, InvokeInput, InvokeResult } from '../src/bedrock_client';
import type { Turn } from '../src/context/types';

const PROMPT_PATH = resolve(__dirname, '..', 'prompts', 'extract_caregiver_protocol.md');

function validDraftJson(): string {
  return JSON.stringify({
    parameters: [
      {
        parameterName: 'blood_pressure_systolic',
        displayName: 'Blood Pressure (Systolic)',
        loincCode: '8480-6',
        unit: 'mmHg',
        frequencyDays: 1,
        dailyDeadline: '09:00',
        timezone: 'Asia/Kolkata',
        thresholdMin: 90,
        thresholdMax: 160,
      },
      {
        parameterName: 'blood_glucose_fasting',
        displayName: 'Blood Glucose (Fasting)',
        loincCode: '1558-6',
        unit: 'mg/dL',
        frequencyDays: 1,
        dailyDeadline: '08:00',
        timezone: 'Asia/Kolkata',
        thresholdMin: 70,
        thresholdMax: 130,
      },
    ],
    topics: [
      {
        topicName: 'medications',
        status: 'complete',
        collectedData: { summary: 'Amlodipine 5mg daily' },
      },
    ],
  });
}

describe('parseProtocolDraft', () => {
  it('parses a valid <output> block with parameters and topics', () => {
    const raw = `<output>${validDraftJson()}</output>`;
    const result = parseProtocolDraft(raw);
    expect(result.parameters).toHaveLength(2);
    expect(result.parameters[0].parameterName).toBe('blood_pressure_systolic');
    expect(result.parameters[0].thresholdMax).toBe(160);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].topicName).toBe('medications');
    expect(result.topics[0].collectedData).toEqual({ summary: 'Amlodipine 5mg daily' });
  });

  it('accepts thresholdMin/thresholdMax as null', () => {
    const draft = JSON.parse(validDraftJson());
    draft.parameters[0].thresholdMin = null;
    draft.parameters[0].thresholdMax = null;
    const raw = `<output>${JSON.stringify(draft)}</output>`;
    const result = parseProtocolDraft(raw);
    expect(result.parameters[0].thresholdMin).toBeNull();
    expect(result.parameters[0].thresholdMax).toBeNull();
  });

  it('drops topics with unknown topicName rather than failing', () => {
    const draft = JSON.parse(validDraftJson());
    draft.topics.push({
      topicName: 'unsupported_topic',
      status: 'complete',
      collectedData: {},
    });
    const raw = `<output>${JSON.stringify(draft)}</output>`;
    const result = parseProtocolDraft(raw);
    // Original valid topic kept, unknown one dropped.
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].topicName).toBe('medications');
  });

  it('throws no_output_tags when <output> block is missing', () => {
    expect(() => parseProtocolDraft('Just prose, no tags.')).toThrow(ProtocolExtractionError);
    try {
      parseProtocolDraft('Just prose, no tags.');
    } catch (e) {
      expect((e as ProtocolExtractionError).kind).toBe('no_output_tags');
    }
  });

  it('throws multiple_output_tags when more than one block is present', () => {
    const raw = `<output>${validDraftJson()}</output><output>${validDraftJson()}</output>`;
    try {
      parseProtocolDraft(raw);
      fail('expected ProtocolExtractionError');
    } catch (e) {
      expect((e as ProtocolExtractionError).kind).toBe('multiple_output_tags');
    }
  });

  it('throws invalid_json when the body is not parseable', () => {
    const raw = `<output>{not valid json}</output>`;
    try {
      parseProtocolDraft(raw);
      fail('expected ProtocolExtractionError');
    } catch (e) {
      expect((e as ProtocolExtractionError).kind).toBe('invalid_json');
    }
  });

  it('throws invalid_shape when parameters is not an array', () => {
    const raw = `<output>{"parameters": {}, "topics": []}</output>`;
    try {
      parseProtocolDraft(raw);
      fail('expected ProtocolExtractionError');
    } catch (e) {
      expect((e as ProtocolExtractionError).kind).toBe('invalid_shape');
    }
  });

  it('throws invalid_shape when a parameter is missing required fields', () => {
    const draft = JSON.parse(validDraftJson());
    delete draft.parameters[0].dailyDeadline;
    const raw = `<output>${JSON.stringify(draft)}</output>`;
    try {
      parseProtocolDraft(raw);
      fail('expected ProtocolExtractionError');
    } catch (e) {
      expect((e as ProtocolExtractionError).kind).toBe('invalid_shape');
    }
  });

  it('throws invalid_shape when frequencyDays is out of range', () => {
    const draft = JSON.parse(validDraftJson());
    draft.parameters[0].frequencyDays = 0;
    const raw = `<output>${JSON.stringify(draft)}</output>`;
    try {
      parseProtocolDraft(raw);
      fail('expected ProtocolExtractionError');
    } catch (e) {
      expect((e as ProtocolExtractionError).kind).toBe('invalid_shape');
    }
  });

  it('throws invalid_shape when dailyDeadline is not HH:MM', () => {
    const draft = JSON.parse(validDraftJson());
    draft.parameters[0].dailyDeadline = '9am';
    const raw = `<output>${JSON.stringify(draft)}</output>`;
    try {
      parseProtocolDraft(raw);
      fail('expected ProtocolExtractionError');
    } catch (e) {
      expect((e as ProtocolExtractionError).kind).toBe('invalid_shape');
    }
  });

  it('throws invalid_shape when topic status is not in allowed set', () => {
    const draft = JSON.parse(validDraftJson());
    draft.topics[0].status = 'something_else';
    const raw = `<output>${JSON.stringify(draft)}</output>`;
    try {
      parseProtocolDraft(raw);
      fail('expected ProtocolExtractionError');
    } catch (e) {
      expect((e as ProtocolExtractionError).kind).toBe('invalid_shape');
    }
  });
});

describe('renderTranscriptForExtraction', () => {
  it('formats a multi-turn transcript with caregiver/assistant role markers', () => {
    const transcript: Turn[] = [
      { role: 'patient', text: 'I want to set up monitoring for my father.', timestamp: new Date(0) },
      { role: 'system', text: 'Of course. What is his name?', timestamp: new Date(0) },
      { role: 'patient', text: "Ramesh. He's 72 with hypertension.", timestamp: new Date(0) },
    ];
    const rendered = renderTranscriptForExtraction(transcript);
    expect(rendered).toContain('**caregiver:** I want to set up monitoring');
    expect(rendered).toContain('**assistant:** Of course');
    expect(rendered).toContain("**caregiver:** Ramesh. He's 72");
  });

  it('handles an empty transcript', () => {
    const rendered = renderTranscriptForExtraction([]);
    expect(rendered).toContain('_(empty)_');
  });
});

describe('SonnetProtocolExtractor.extract', () => {
  function makeBedrock(responseText: string): BedrockInvoker {
    return {
      async invoke(_input: InvokeInput): Promise<InvokeResult> {
        return {
          responseText,
          inputTokens: 1500,
          cachedInputTokens: 500,
          outputTokens: 200,
          guardrailBlocked: false,
          inferenceRegion: 'ap-south-1',
          rawStopReason: 'end_turn',
        };
      },
      async *invokeStream() {
        // Not used by the extractor.
      },
    };
  }

  it('invokes Bedrock and returns a parsed ProtocolDraft + meta', async () => {
    const bedrock = makeBedrock(`<output>${validDraftJson()}</output>`);
    const extractor = new SonnetProtocolExtractor(
      bedrock,
      'global.anthropic.claude-sonnet-4-6',
      'ap-south-1',
      PROMPT_PATH,
    );
    const transcript: Turn[] = [
      { role: 'patient', text: 'set up monitoring', timestamp: new Date(0) },
    ];
    const { draft, meta } = await extractor.extract(transcript);

    expect(draft.parameters).toHaveLength(2);
    expect(draft.topics).toHaveLength(1);
    expect(meta.inputTokens).toBe(1500);
    expect(meta.outputTokens).toBe(200);
  });

  it('propagates ProtocolExtractionError on bad LLM output', async () => {
    const bedrock = makeBedrock('no output tags here');
    const extractor = new SonnetProtocolExtractor(
      bedrock,
      'm',
      'r',
      PROMPT_PATH,
    );
    await expect(extractor.extract([])).rejects.toThrow(ProtocolExtractionError);
  });
});

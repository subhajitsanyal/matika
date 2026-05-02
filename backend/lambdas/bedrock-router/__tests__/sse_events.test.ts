import {
  CollectingSseEmitter,
  serializeEvent,
  emitParsedOutput,
  SseEvent,
} from '../src/sse_events';
import type { StructuredOutput } from '../src/parser';

function bareParsed(): StructuredOutput {
  return {
    responseText: 'I heard one thirty over eighty five.',
    ttsHints: { language: 'en-IN', spellOutNumbers: false },
    extractedValues: [
      {
        parameter: 'blood_pressure_systolic',
        value: 130,
        unit: 'mmHg',
        loincCode: '8480-6',
        status: 'pending_confirmation',
        confidence: 0.94,
      },
    ],
    actions: [{ type: 'request_photo', reason: 'value_not_recalled' }],
    stateTransition: 'EXTRACTING -> PENDING_CONFIRMATION',
    escalationReason: null,
  };
}

describe('CollectingSseEmitter', () => {
  it('collects events in order', () => {
    const e = new CollectingSseEmitter();
    e.emit({ type: 'prelude', data: { sessionId: 's', tier: 'T2', model: 'm', streamId: 'x' } });
    e.emit({ type: 'sentence', data: { text: 'Hello.', sentenceIndex: 0 } });
    expect(e.events).toHaveLength(2);
    expect(e.events[0].type).toBe('prelude');
    expect(e.events[1].type).toBe('sentence');
  });

  it('throws when emitting after end()', () => {
    const e = new CollectingSseEmitter();
    e.end();
    expect(() =>
      e.emit({ type: 'sentence', data: { text: 'late', sentenceIndex: 0 } }),
    ).toThrow(/after end/);
  });

  it('marks ended=true after end()', () => {
    const e = new CollectingSseEmitter();
    expect(e.ended).toBe(false);
    e.end();
    expect(e.ended).toBe(true);
  });
});

describe('serializeEvent', () => {
  it('produces the SSE wire format: event: NAME\\ndata: JSON\\n\\n', () => {
    const event: SseEvent = {
      type: 'sentence',
      data: { text: 'Hi.', sentenceIndex: 0 },
    };
    expect(serializeEvent(event)).toBe('event: sentence\ndata: {"text":"Hi.","sentenceIndex":0}\n\n');
  });

  it('serializes prelude', () => {
    const out = serializeEvent({
      type: 'prelude',
      data: { sessionId: 's1', tier: 'T3', model: 'sonnet', streamId: 'x' },
    });
    expect(out.startsWith('event: prelude\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(true);
  });

  it('serializes done', () => {
    const out = serializeEvent({
      type: 'done',
      data: {
        sessionState: {
          capturedThisSession: [],
          pendingConfirmation: [],
          stillNeeded: [],
          fsmState: 'COMPLETE',
        },
      },
    });
    expect(out).toContain('event: done');
    expect(out).toContain('"fsmState":"COMPLETE"');
  });
});

describe('emitParsedOutput', () => {
  it('emits sentence + extracted + action events from a parsed output', () => {
    const e = new CollectingSseEmitter();
    const next = emitParsedOutput(e, bareParsed());

    const types = e.events.map((ev) => ev.type);
    expect(types).toEqual(['sentence', 'extracted', 'action']);
    expect(next).toBe(1); // one sentence emitted
  });

  it('skips sentence event when responseText is empty', () => {
    const e = new CollectingSseEmitter();
    const parsed = bareParsed();
    parsed.responseText = '';
    emitParsedOutput(e, parsed);
    const types = e.events.map((ev) => ev.type);
    expect(types).not.toContain('sentence');
    expect(types).toContain('extracted');
  });

  it('respects starting sentenceIndex offset', () => {
    const e = new CollectingSseEmitter();
    emitParsedOutput(e, bareParsed(), 5);
    const sentenceEvent = e.events.find((ev) => ev.type === 'sentence');
    expect(sentenceEvent).toBeDefined();
    if (sentenceEvent && sentenceEvent.type === 'sentence') {
      expect(sentenceEvent.data.sentenceIndex).toBe(5);
    }
  });

  it('emits zero events for an empty parsed output', () => {
    const e = new CollectingSseEmitter();
    emitParsedOutput(e, {
      responseText: '',
      ttsHints: { language: 'en-IN', spellOutNumbers: false },
      extractedValues: [],
      actions: [],
      stateTransition: 'EXTRACTING -> EXTRACTING',
      escalationReason: null,
    });
    expect(e.events).toEqual([]);
  });
});

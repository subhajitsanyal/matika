import { applySlidingWindow, renderTurnContext, TURN_WINDOW_SIZE } from '../src/context/per_turn';
import type { Turn, TurnContext, SessionState } from '../src/context/types';

function turn(role: Turn['role'], text: string, secondsAgo: number): Turn {
  return { role, text, timestamp: new Date(Date.now() - secondsAgo * 1000) };
}

function baseSessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'session-1',
    sessionType: 'patient_logging',
    language: 'en-IN',
    fsmState: 'EXTRACTING',
    capturedThisSession: [],
    pendingConfirmation: [],
    stillNeeded: ['blood_glucose'],
    ...overrides,
  };
}

function baseContext(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    sessionState: baseSessionState(),
    recentTurns: [],
    conversationSummary: null,
    currentTranscript: 'My BP is one thirty over eighty five.',
    ...overrides,
  };
}

describe('applySlidingWindow', () => {
  it('returns empty window and empty overflow for empty input', () => {
    expect(applySlidingWindow([])).toEqual({ window: [], overflow: [] });
  });

  it('returns all turns in window when below size', () => {
    const turns = [turn('patient', 'a', 30), turn('system', 'b', 20)];
    const result = applySlidingWindow(turns);
    expect(result.window).toHaveLength(2);
    expect(result.overflow).toHaveLength(0);
  });

  it('returns all turns in window when exactly at size', () => {
    const turns = Array.from({ length: TURN_WINDOW_SIZE }, (_, i) =>
      turn(i % 2 === 0 ? 'patient' : 'system', `t${i}`, 100 - i),
    );
    const result = applySlidingWindow(turns);
    expect(result.window).toHaveLength(TURN_WINDOW_SIZE);
    expect(result.overflow).toHaveLength(0);
  });

  it('splits when above window size, keeping most recent in window', () => {
    const turns = Array.from({ length: TURN_WINDOW_SIZE + 3 }, (_, i) =>
      turn('patient', `t${i}`, (TURN_WINDOW_SIZE + 3) - i),
    );
    const result = applySlidingWindow(turns);
    expect(result.window).toHaveLength(TURN_WINDOW_SIZE);
    expect(result.overflow).toHaveLength(3);
    expect(result.window[0].text).toBe('t3'); // first kept turn
    expect(result.window[result.window.length - 1].text).toBe(`t${TURN_WINDOW_SIZE + 2}`);
    expect(result.overflow[0].text).toBe('t0'); // oldest overflow first
  });

  it('respects custom window size', () => {
    const turns = [turn('patient', 'a', 4), turn('system', 'b', 3), turn('patient', 'c', 2), turn('system', 'd', 1)];
    const result = applySlidingWindow(turns, 2);
    expect(result.window.map((t) => t.text)).toEqual(['c', 'd']);
    expect(result.overflow.map((t) => t.text)).toEqual(['a', 'b']);
  });

  it('window size 0 puts everything in overflow', () => {
    const turns = [turn('patient', 'a', 1)];
    const result = applySlidingWindow(turns, 0);
    expect(result.window).toEqual([]);
    expect(result.overflow).toHaveLength(1);
  });

  it('throws on negative window size', () => {
    expect(() => applySlidingWindow([], -1)).toThrow(/non-negative/);
  });
});

describe('renderTurnContext', () => {
  it('renders all sections except summary when no summary present', () => {
    const out = renderTurnContext(baseContext());
    expect(out).toContain('## Current session state');
    expect(out).toContain('## Recent turns');
    expect(out).toContain('## Current transcript');
    expect(out).not.toContain('## Earlier in this session');
  });

  it('includes the summary section when conversationSummary is set', () => {
    const ctx = baseContext({ conversationSummary: 'Patient confirmed BP 130/85 and reported feeling tired.' });
    const out = renderTurnContext(ctx);
    expect(out).toContain('## Earlier in this session (summary of older turns)');
    expect(out).toContain('Patient confirmed BP 130/85');
  });

  it('renders session-state fields', () => {
    const ctx = baseContext({
      sessionState: baseSessionState({
        capturedThisSession: [
          { parameter: 'blood_pressure_systolic', value: 130, unit: 'mmHg', loincCode: '8480-6', status: 'confirmed', confidence: 0.95 },
        ],
        pendingConfirmation: [
          { parameter: 'blood_glucose', value: 110, unit: 'mg/dL', loincCode: '2339-0', status: 'pending_confirmation', confidence: 0.88 },
        ],
        stillNeeded: ['body_weight'],
      }),
    });
    const out = renderTurnContext(ctx);
    expect(out).toContain('Captured this session: blood_pressure_systolic 130 mmHg');
    expect(out).toContain('Pending confirmation: blood_glucose 110 mg/dL');
    expect(out).toContain('Still needed: body_weight');
  });

  it('shows "all required parameters captured" when stillNeeded is empty', () => {
    const ctx = baseContext({ sessionState: baseSessionState({ stillNeeded: [] }) });
    expect(renderTurnContext(ctx)).toContain('Still needed: (none — all required parameters captured)');
  });

  it('shows "(this is the first turn)" when no recent turns', () => {
    expect(renderTurnContext(baseContext())).toContain('## Recent turns\n\n_(this is the first turn)_');
  });

  it('renders recent turns with role labels', () => {
    const ctx = baseContext({
      recentTurns: [
        turn('system', 'How are you feeling today?', 60),
        turn('patient', "I'm fine, thanks.", 30),
      ],
    });
    const out = renderTurnContext(ctx);
    expect(out).toContain('**system:** How are you feeling today?');
    expect(out).toContain("**patient:** I'm fine, thanks.");
  });

  it('uses "patient" speaker for patient_logging current transcript', () => {
    const ctx = baseContext({
      sessionState: baseSessionState({ sessionType: 'patient_logging' }),
      currentTranscript: 'My sugar was one ten.',
    });
    expect(renderTurnContext(ctx)).toContain('**patient:** My sugar was one ten.');
  });

  it('uses "caregiver" speaker for caregiver_config current transcript', () => {
    const ctx = baseContext({
      sessionState: baseSessionState({ sessionType: 'caregiver_config' }),
      currentTranscript: 'Add weight tracking every 3 days.',
    });
    expect(renderTurnContext(ctx)).toContain('**caregiver:** Add weight tracking every 3 days.');
  });

  it('uses "caregiver" speaker for caregiver_onboarding', () => {
    const ctx = baseContext({
      sessionState: baseSessionState({ sessionType: 'caregiver_onboarding' }),
      currentTranscript: "He's 72, has diabetes and high BP.",
    });
    expect(renderTurnContext(ctx)).toContain("**caregiver:** He's 72, has diabetes and high BP.");
  });

  it('renders FSM state', () => {
    const ctx = baseContext({ sessionState: baseSessionState({ fsmState: 'PLAUSIBILITY_CHALLENGE' }) });
    expect(renderTurnContext(ctx)).toContain('FSM state: PLAUSIBILITY_CHALLENGE');
  });

  it('does NOT end with the cache breakpoint marker (per-turn block is uncached)', () => {
    const out = renderTurnContext(baseContext());
    expect(out).not.toContain('CACHE_BREAKPOINT');
  });
});

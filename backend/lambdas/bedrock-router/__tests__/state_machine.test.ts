import {
  parseTransition,
  isAllowedTransition,
  applyTransition,
  isTerminal,
  StateTransitionError,
} from '../src/state_machine';

describe('parseTransition', () => {
  it('parses a clean transition', () => {
    expect(parseTransition('EXTRACTING -> PENDING_CONFIRMATION')).toEqual({
      from: 'EXTRACTING',
      to: 'PENDING_CONFIRMATION',
    });
  });

  it('tolerates extra whitespace around the arrow', () => {
    expect(parseTransition('  EXTRACTING   ->   PENDING_CONFIRMATION  ')).toEqual({
      from: 'EXTRACTING',
      to: 'PENDING_CONFIRMATION',
    });
  });

  it('parses self-loop transitions', () => {
    expect(parseTransition('EXTRACTING -> EXTRACTING')).toEqual({
      from: 'EXTRACTING',
      to: 'EXTRACTING',
    });
  });

  it('throws parse_error on malformed input', () => {
    expect.assertions(2);
    try {
      parseTransition('not a transition');
    } catch (e) {
      expect(e).toBeInstanceOf(StateTransitionError);
      expect((e as StateTransitionError).kind).toBe('parse_error');
    }
  });

  it('throws unknown_state on unrecognized FROM', () => {
    try {
      parseTransition('NONSENSE -> EXTRACTING');
    } catch (e) {
      expect((e as StateTransitionError).kind).toBe('unknown_state');
    }
  });

  it('throws unknown_state on unrecognized TO', () => {
    try {
      parseTransition('EXTRACTING -> NONSENSE');
    } catch (e) {
      expect((e as StateTransitionError).kind).toBe('unknown_state');
    }
  });
});

describe('isAllowedTransition', () => {
  it('allows EXTRACTING -> PENDING_CONFIRMATION', () => {
    expect(isAllowedTransition('EXTRACTING', 'PENDING_CONFIRMATION')).toBe(true);
  });

  it('allows PENDING_CONFIRMATION -> EXTRACTING', () => {
    expect(isAllowedTransition('PENDING_CONFIRMATION', 'EXTRACTING')).toBe(true);
  });

  it('allows EXTRACTING self-loop (same param re-extracted)', () => {
    expect(isAllowedTransition('EXTRACTING', 'EXTRACTING')).toBe(true);
  });

  it('allows EXTRACTING -> EMERGENCY', () => {
    expect(isAllowedTransition('EXTRACTING', 'EMERGENCY')).toBe(true);
  });

  it('allows EMERGENCY -> TERMINAL', () => {
    expect(isAllowedTransition('EMERGENCY', 'TERMINAL')).toBe(true);
  });

  it('rejects EMERGENCY -> EXTRACTING (no recovery from emergency)', () => {
    expect(isAllowedTransition('EMERGENCY', 'EXTRACTING')).toBe(false);
  });

  it('rejects TERMINAL -> anything (absorbing)', () => {
    expect(isAllowedTransition('TERMINAL', 'EXTRACTING')).toBe(false);
    expect(isAllowedTransition('TERMINAL', 'PAUSED')).toBe(false);
    expect(isAllowedTransition('TERMINAL', 'TERMINAL')).toBe(false);
  });

  it('allows CREATED -> EXTRACTING (patient may lead with a vital)', () => {
    expect(isAllowedTransition('CREATED', 'EXTRACTING')).toBe(true);
  });

  it('allows CREATED -> PENDING_CONFIRMATION (patient leads with value, model captures pending)', () => {
    expect(isAllowedTransition('CREATED', 'PENDING_CONFIRMATION')).toBe(true);
  });

  it('allows CREATED -> EMERGENCY (patient leads with distress signal)', () => {
    expect(isAllowedTransition('CREATED', 'EMERGENCY')).toBe(true);
  });

  it('rejects GREETING -> EMERGENCY (no shortcut)', () => {
    expect(isAllowedTransition('GREETING', 'EMERGENCY')).toBe(false);
  });

  it('allows PAUSED to resume to most non-terminal states', () => {
    expect(isAllowedTransition('PAUSED', 'EXTRACTING')).toBe(true);
    expect(isAllowedTransition('PAUSED', 'GREETING')).toBe(true);
    expect(isAllowedTransition('PAUSED', 'PENDING_CONFIRMATION')).toBe(true);
    expect(isAllowedTransition('PAUSED', 'AWAITING_PHOTO')).toBe(true);
    expect(isAllowedTransition('PAUSED', 'PLAUSIBILITY_CHALLENGE')).toBe(true);
  });

  it('allows COMPLETE -> TERMINAL', () => {
    expect(isAllowedTransition('COMPLETE', 'TERMINAL')).toBe(true);
  });

  it('rejects COMPLETE -> EXTRACTING (no resurrection)', () => {
    expect(isAllowedTransition('COMPLETE', 'EXTRACTING')).toBe(false);
  });
});

describe('applyTransition', () => {
  it('applies a valid transition', () => {
    expect(applyTransition('EXTRACTING', 'EXTRACTING -> PENDING_CONFIRMATION')).toBe('PENDING_CONFIRMATION');
  });

  it('throws from_mismatch when proposed FROM differs from current', () => {
    try {
      applyTransition('GREETING', 'EXTRACTING -> PENDING_CONFIRMATION');
    } catch (e) {
      expect((e as StateTransitionError).kind).toBe('from_mismatch');
      expect((e as StateTransitionError).currentState).toBe('GREETING');
    }
  });

  it('throws transition_not_allowed when FROM matches but transition is invalid', () => {
    try {
      applyTransition('TERMINAL', 'TERMINAL -> EXTRACTING');
    } catch (e) {
      expect((e as StateTransitionError).kind).toBe('transition_not_allowed');
    }
  });

  it('throws parse_error on malformed proposal', () => {
    try {
      applyTransition('EXTRACTING', 'garbage');
    } catch (e) {
      expect((e as StateTransitionError).kind).toBe('parse_error');
    }
  });
});

describe('isTerminal', () => {
  it('TERMINAL is terminal', () => {
    expect(isTerminal('TERMINAL')).toBe(true);
  });

  it('EXTRACTING is not terminal', () => {
    expect(isTerminal('EXTRACTING')).toBe(false);
  });

  it('EMERGENCY is not terminal (transitions to TERMINAL)', () => {
    expect(isTerminal('EMERGENCY')).toBe(false);
  });

  it('COMPLETE is not terminal (transitions to TERMINAL)', () => {
    expect(isTerminal('COMPLETE')).toBe(false);
  });
});

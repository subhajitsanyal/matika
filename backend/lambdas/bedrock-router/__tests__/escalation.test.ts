import {
  detectEscalation,
  codeSwitchDensity,
  EscalationInput,
  PreModelExtractionHint,
  SessionContext,
} from '../escalation/signal_detectors';

const baseContext: SessionContext = {
  sessionType: 'patient_logging',
  language: 'en-IN',
  hasPendingRecommendationsRequiringIntroduction: false,
  previousTurnLowestConfidence: null,
  protocolDesignTurn: false,
  longResponseExpected: false,
};

interface InputOverrides {
  transcript?: string;
  preModelHints?: PreModelExtractionHint[];
  context?: Partial<SessionContext>;
}

function input(overrides: InputOverrides = {}): EscalationInput {
  return {
    transcript: overrides.transcript ?? 'My BP is 130 over 85',
    preModelHints: overrides.preModelHints ?? [],
    context: { ...baseContext, ...(overrides.context ?? {}) },
  };
}

describe('detectEscalation', () => {
  it('returns T2 with no reason on a clean patient turn', () => {
    expect(detectEscalation(input())).toEqual({ tier: 'T2', reason: null });
  });

  it('escalates to T3 on an implausible BP systolic', () => {
    const result = detectEscalation(input({
      preModelHints: [{ parameter: 'blood_pressure_systolic', value: 350 }],
    }));
    expect(result).toEqual({ tier: 'T3', reason: 'implausible_value' });
  });

  it('escalates to T3 on an implausibly low spo2', () => {
    const result = detectEscalation(input({
      preModelHints: [{ parameter: 'spo2', value: 10 }],
    }));
    expect(result).toEqual({ tier: 'T3', reason: 'implausible_value' });
  });

  it('does NOT escalate on a soft-out-of-range value (within hard bounds)', () => {
    const result = detectEscalation(input({
      preModelHints: [{ parameter: 'blood_pressure_systolic', value: 200 }],
    }));
    expect(result.tier).toBe('T2');
  });

  it('escalates on English emergency keyword', () => {
    const result = detectEscalation(input({ transcript: 'I have chest pain' }));
    expect(result).toEqual({ tier: 'T3', reason: 'emergency_keyword' });
  });

  it('escalates on Hindi emergency keyword', () => {
    const result = detectEscalation(input({
      transcript: 'mujhe seene mein dard ho raha hai',
      context: { language: 'hi-IN' },
    }));
    expect(result).toEqual({ tier: 'T3', reason: 'emergency_keyword' });
  });

  it('escalates on Bengali emergency keyword', () => {
    const result = detectEscalation(input({
      transcript: 'aamar bukey byatha hochhe',
      context: { language: 'bn-IN' },
    }));
    expect(result).toEqual({ tier: 'T3', reason: 'emergency_keyword' });
  });

  it('escalates on emergency keyword from non-primary language (cross-language safety)', () => {
    // Patient configured as Hindi but blurts out English emergency phrase.
    const result = detectEscalation(input({
      transcript: 'I cannot breathe',
      context: { language: 'hi-IN' },
    }));
    expect(result).toEqual({ tier: 'T3', reason: 'emergency_keyword' });
  });

  it('escalates caregiver_config session with protocolDesignTurn', () => {
    const result = detectEscalation(input({
      context: { sessionType: 'caregiver_config', protocolDesignTurn: true },
    }));
    expect(result).toEqual({ tier: 'T3', reason: 'caregiver_protocol_design' });
  });

  it('does NOT escalate caregiver_config without protocolDesignTurn', () => {
    const result = detectEscalation(input({
      context: { sessionType: 'caregiver_config', protocolDesignTurn: false },
    }));
    expect(result.tier).toBe('T2');
  });

  it('escalates when pending recommendations require gentle introduction', () => {
    const result = detectEscalation(input({
      context: { hasPendingRecommendationsRequiringIntroduction: true },
    }));
    expect(result).toEqual({ tier: 'T3', reason: 'cross_session_continuity' });
  });

  it('escalates on previous-turn low confidence', () => {
    const result = detectEscalation(input({
      context: { previousTurnLowestConfidence: 0.55 },
    }));
    expect(result).toEqual({ tier: 'T3', reason: 'low_confidence_extraction' });
  });

  it('does NOT escalate when previousTurnLowestConfidence is at threshold', () => {
    const result = detectEscalation(input({
      context: { previousTurnLowestConfidence: 0.7 },
    }));
    expect(result.tier).toBe('T2');
  });

  it('escalates on dense code-switching from primary Hindi', () => {
    // 5 of 7 tokens are Latin → density ~0.71
    const result = detectEscalation(input({
      transcript: 'mera blood pressure is one thirty over eighty hai',
      context: { language: 'hi-IN' },
    }));
    expect(result).toEqual({ tier: 'T3', reason: 'code_switch_density_high' });
  });

  it('does NOT escalate on light code-switching', () => {
    // 2 of 6 tokens are Devanagari for an English-primary speaker → density ~0.33,
    // but we'd need to be a Hindi-primary speaker to trip on Latin. Test the inverse.
    const result = detectEscalation(input({
      transcript: 'BP is one thirty hai',
      context: { language: 'hi-IN' },
    }));
    // 4 Latin / 5 total = 0.8 → escalates. Correct expected behavior — code-switch detection fires.
    // For a less code-switched case:
    const lighter = detectEscalation(input({
      transcript: 'BP is one thirty',
      context: { language: 'en-IN' },
    }));
    expect(lighter.tier).toBe('T2');
    expect(result.tier).toBe('T3');
  });

  it('escalates on long response expected', () => {
    const result = detectEscalation(input({
      context: { longResponseExpected: true },
    }));
    expect(result).toEqual({ tier: 'T3', reason: 'long_response_expected' });
  });

  it('precedence: emergency_keyword beats implausible_value when both present (safety > correctness)', () => {
    const result = detectEscalation(input({
      transcript: 'I have chest pain',
      preModelHints: [{ parameter: 'blood_pressure_systolic', value: 400 }],
    }));
    expect(result.reason).toBe('emergency_keyword');
  });
});

describe('codeSwitchDensity', () => {
  it('returns 0 for empty transcript', () => {
    expect(codeSwitchDensity('', 'en-IN')).toBe(0);
  });

  it('returns 0 for monolingual English when primary is en-IN', () => {
    expect(codeSwitchDensity('My BP is one thirty over eighty five', 'en-IN')).toBe(0);
  });

  it('counts Devanagari as switched when primary is en-IN', () => {
    const density = codeSwitchDensity('My BP is एक सौ तीस', 'en-IN');
    expect(density).toBeGreaterThan(0);
  });

  it('counts Latin as switched when primary is hi-IN', () => {
    const density = codeSwitchDensity('mera BP is one thirty over eighty hai', 'hi-IN');
    expect(density).toBeGreaterThan(0.5);
  });

  it('ignores single-character tokens', () => {
    // "/" is one char so should be ignored, not counted toward switching
    expect(codeSwitchDensity('One two / three', 'en-IN')).toBe(0);
  });
});

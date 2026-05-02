import { buildEmergencyAlert, AlertTrigger } from '../src/alert_queue';

describe('buildEmergencyAlert', () => {
  it('produces a complete alert message', () => {
    const fixedDate = new Date('2026-05-02T10:00:00Z');
    const alert = buildEmergencyAlert({
      patientId: 'p1',
      sessionId: 's1',
      triggers: ['transcript_keyword'],
      transcript: 'I have chest pain',
      language: 'en-IN',
      now: () => fixedDate,
    });
    expect(alert).toEqual({
      alertType: 'emergency',
      patientId: 'p1',
      sessionId: 's1',
      triggers: ['transcript_keyword'],
      transcript: 'I have chest pain',
      language: 'en-IN',
      timestamp: '2026-05-02T10:00:00.000Z',
    });
  });

  it('accepts multiple triggers', () => {
    const alert = buildEmergencyAlert({
      patientId: 'p1',
      sessionId: 's1',
      triggers: ['transcript_keyword', 'llm_classification', 'guardrail_block'],
      transcript: 'I have severe chest pain and cant breathe',
      language: 'en-IN',
    });
    expect(alert.triggers).toEqual([
      'transcript_keyword',
      'llm_classification',
      'guardrail_block',
    ]);
  });

  it('preserves trigger order', () => {
    const triggers: AlertTrigger[] = ['guardrail_block', 'transcript_keyword'];
    const alert = buildEmergencyAlert({
      patientId: 'p',
      sessionId: 's',
      triggers,
      transcript: 't',
      language: 'hi-IN',
    });
    expect(alert.triggers).toEqual(['guardrail_block', 'transcript_keyword']);
  });

  it('throws when triggers is empty', () => {
    expect(() =>
      buildEmergencyAlert({
        patientId: 'p',
        sessionId: 's',
        triggers: [],
        transcript: 't',
        language: 'en-IN',
      }),
    ).toThrow(/at least one trigger/i);
  });

  it('serializes language verbatim', () => {
    const enAlert = buildEmergencyAlert({
      patientId: 'p',
      sessionId: 's',
      triggers: ['transcript_keyword'],
      transcript: 't',
      language: 'en-IN',
    });
    const hiAlert = buildEmergencyAlert({
      patientId: 'p',
      sessionId: 's',
      triggers: ['transcript_keyword'],
      transcript: 't',
      language: 'hi-IN',
    });
    const bnAlert = buildEmergencyAlert({
      patientId: 'p',
      sessionId: 's',
      triggers: ['transcript_keyword'],
      transcript: 't',
      language: 'bn-IN',
    });
    expect(enAlert.language).toBe('en-IN');
    expect(hiAlert.language).toBe('hi-IN');
    expect(bnAlert.language).toBe('bn-IN');
  });

  it('uses Date.now() when no clock provided', () => {
    const before = Date.now();
    const alert = buildEmergencyAlert({
      patientId: 'p',
      sessionId: 's',
      triggers: ['transcript_keyword'],
      transcript: 't',
      language: 'en-IN',
    });
    const after = Date.now();
    const ts = new Date(alert.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

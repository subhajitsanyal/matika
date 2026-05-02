import { shouldStream } from '../src/streaming_decision';

describe('shouldStream', () => {
  describe('non-streaming defaults', () => {
    it('returns false for T2 + no escalation + no client hint', () => {
      expect(shouldStream({ tier: 'T2', escalationReason: null })).toBe(false);
    });

    it('returns false for T2 + null client hint', () => {
      expect(shouldStream({ tier: 'T2', escalationReason: null, clientPreferStreaming: false })).toBe(false);
    });
  });

  describe('tier-based streaming', () => {
    it('returns true for T3 (Sonnet escalation)', () => {
      expect(shouldStream({ tier: 'T3', escalationReason: null })).toBe(true);
    });

    it('returns true for T3_VISION', () => {
      expect(shouldStream({ tier: 'T3_VISION', escalationReason: null })).toBe(true);
    });

    it('returns false for T2_VISION', () => {
      expect(shouldStream({ tier: 'T2_VISION', escalationReason: null })).toBe(false);
    });
  });

  describe('escalation-reason-based streaming', () => {
    it('returns true for caregiver_protocol_design', () => {
      expect(shouldStream({ tier: 'T2', escalationReason: 'caregiver_protocol_design' })).toBe(true);
    });

    it('returns true for cross_session_continuity', () => {
      expect(shouldStream({ tier: 'T2', escalationReason: 'cross_session_continuity' })).toBe(true);
    });

    it('returns true for long_response_expected', () => {
      expect(shouldStream({ tier: 'T2', escalationReason: 'long_response_expected' })).toBe(true);
    });

    it('returns false for emergency_keyword (T2 default doesn\'t stream; tier alone forces T3)', () => {
      // Note: emergency_keyword always escalates the tier to T3 in real flow,
      // so this combination wouldn't occur in production. The pure function
      // still returns false here because emergency_keyword isn't in the
      // streaming-reason allow-list.
      expect(shouldStream({ tier: 'T2', escalationReason: 'emergency_keyword' })).toBe(false);
    });

    it('returns false for implausible_value at T2 (also tier-escalated in real flow)', () => {
      expect(shouldStream({ tier: 'T2', escalationReason: 'implausible_value' })).toBe(false);
    });

    it('returns false for low_confidence_extraction at T2', () => {
      expect(shouldStream({ tier: 'T2', escalationReason: 'low_confidence_extraction' })).toBe(false);
    });

    it('returns false for code_switch_density_high at T2 (also tier-escalated)', () => {
      expect(shouldStream({ tier: 'T2', escalationReason: 'code_switch_density_high' })).toBe(false);
    });
  });

  describe('client-preference override', () => {
    it('returns true when client requests streaming, even on T2 short turn', () => {
      expect(
        shouldStream({ tier: 'T2', escalationReason: null, clientPreferStreaming: true }),
      ).toBe(true);
    });

    it('still returns true for T3 when client opts out (tier wins on the streaming-required side)', () => {
      // Client cannot prevent streaming on T3 — Sonnet is too slow without it.
      expect(
        shouldStream({ tier: 'T3', escalationReason: null, clientPreferStreaming: false }),
      ).toBe(true);
    });
  });
});

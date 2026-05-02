// Streaming decision logic per spec §6.6.
//
// Pure function over (tier, escalationReason, clientHints) → boolean.
// Owned by backend per AGENTS.md §3.1; signal definitions live in
// inference-platform/escalation/signal_detectors.ts.
//
// Rule:
//   stream IF
//     tier == T3
//     OR escalationReason IN (caregiver_protocol_design,
//                             cross_session_continuity,
//                             long_response_expected)
//     OR clientHints.preferStreaming == true
//   ELSE non-stream
//
// Patient short turns (T2 with no escalation) default to non-streamed because
// the response is too short to benefit (~30 tokens; full response in <500ms).
// Streaming pays off when the response is long enough that early TTS playback
// meaningfully reduces perceived latency.

import type { Tier } from './pricing';
import type { EscalationSignal } from '../escalation/signal_detectors';

const STREAMING_ESCALATION_REASONS: ReadonlySet<EscalationSignal> = new Set([
  'caregiver_protocol_design',
  'cross_session_continuity',
  'long_response_expected',
]);

export interface StreamingDecisionInput {
  tier: Tier;
  escalationReason: EscalationSignal | null;
  clientPreferStreaming?: boolean;
}

export function shouldStream(input: StreamingDecisionInput): boolean {
  if (input.clientPreferStreaming === true) return true;
  if (input.tier === 'T3' || input.tier === 'T3_VISION') return true;
  if (input.escalationReason && STREAMING_ESCALATION_REASONS.has(input.escalationReason)) {
    return true;
  }
  return false;
}

// Escalation signal detectors — owned by inference-platform agent.
// Real implementation in P1 per docs/matika_spec_v2.md §6.5 and T-V2-106.

export type Tier = 'T2' | 'T3';

export interface RoutingDecision {
  tier: Tier;
  reason: string | null;
}

export function detectEscalation(_transcript: string, _sessionState: unknown): RoutingDecision {
  return { tier: 'T2', reason: null };
}

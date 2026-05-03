// FSM transition logic for the conversation engine.
// Spec §6.2 — owned by backend per AGENTS.md.
//
// The LLM proposes a transition (e.g. "EXTRACTING -> PENDING_CONFIRMATION")
// in its structured output. This module:
//   1. Parses the proposed transition string.
//   2. Validates that the FROM state matches the session's current state.
//   3. Validates that FROM -> TO is in the allowed transition set.
//   4. Returns the new state, or throws a typed error.

import type { FsmState } from './context/types';

// Allowed transitions per spec §6.2. Each entry maps a source state to the
// set of target states reachable from it.
//
// Notes:
// - EMERGENCY and COMPLETE are normal terminating routes.
// - TERMINAL is the absorbing state (idle timeout, explicit completion).
// - PAUSED is a transient state — a session can pause from any non-terminal
//   state and resume to its prior state. The state machine doesn't track the
//   "prior state"; the caller is responsible for restoring it on resume.
const ALLOWED_TRANSITIONS: Record<FsmState, ReadonlySet<FsmState>> = {
  // Patients sometimes lead with a vital reading on the first turn (e.g.,
  // "BP is 130 over 85" with no greeting). Allow direct entry to EXTRACTING /
  // PENDING_CONFIRMATION / EMERGENCY rather than forcing an artificial
  // GREETING hop that the LLM has to fabricate.
  CREATED: new Set([
    'GREETING',
    'EXTRACTING',
    'PENDING_CONFIRMATION',
    'EMERGENCY',
    'PAUSED',
    'TERMINAL',
  ]),
  GREETING: new Set(['EXTRACTING', 'PAUSED', 'TERMINAL']),
  EXTRACTING: new Set([
    'EXTRACTING',
    'PENDING_CONFIRMATION',
    'AWAITING_PHOTO',
    'PLAUSIBILITY_CHALLENGE',
    'EMERGENCY',
    'COMPLETE',
    'PAUSED',
    'TERMINAL',
  ]),
  PENDING_CONFIRMATION: new Set([
    'EXTRACTING',
    'PENDING_CONFIRMATION',
    'PLAUSIBILITY_CHALLENGE',
    'EMERGENCY',
    'COMPLETE',
    'PAUSED',
    'TERMINAL',
  ]),
  AWAITING_PHOTO: new Set([
    'PENDING_CONFIRMATION',
    'EXTRACTING',
    'EMERGENCY',
    'PAUSED',
    'TERMINAL',
  ]),
  PLAUSIBILITY_CHALLENGE: new Set(['EXTRACTING', 'EMERGENCY', 'PAUSED', 'TERMINAL']),
  EMERGENCY: new Set(['TERMINAL']),
  PAUSED: new Set([
    'GREETING',
    'EXTRACTING',
    'PENDING_CONFIRMATION',
    'AWAITING_PHOTO',
    'PLAUSIBILITY_CHALLENGE',
    'TERMINAL',
  ]),
  COMPLETE: new Set(['TERMINAL']),
  TERMINAL: new Set([]),
};

const STATE_NAMES = new Set<FsmState>([
  'CREATED', 'GREETING', 'EXTRACTING', 'PENDING_CONFIRMATION', 'AWAITING_PHOTO',
  'PLAUSIBILITY_CHALLENGE', 'EMERGENCY', 'PAUSED', 'COMPLETE', 'TERMINAL',
]);

const TRANSITION_REGEX = /^\s*([A-Z_]+)\s*->\s*([A-Z_]+)\s*$/;

export type TransitionFailureKind = 'parse_error' | 'unknown_state' | 'from_mismatch' | 'transition_not_allowed';

export class StateTransitionError extends Error {
  public readonly kind: TransitionFailureKind;
  public readonly proposedTransition: string;
  public readonly currentState?: FsmState;

  constructor(kind: TransitionFailureKind, message: string, proposedTransition: string, currentState?: FsmState) {
    super(message);
    this.name = 'StateTransitionError';
    this.kind = kind;
    this.proposedTransition = proposedTransition;
    this.currentState = currentState;
  }
}

export interface ParsedTransition {
  from: FsmState;
  to: FsmState;
}

export function parseTransition(transition: string): ParsedTransition {
  const match = TRANSITION_REGEX.exec(transition);
  if (!match) {
    throw new StateTransitionError(
      'parse_error',
      `Could not parse transition string: "${transition}"`,
      transition,
    );
  }
  const [, fromRaw, toRaw] = match;
  if (!STATE_NAMES.has(fromRaw as FsmState)) {
    throw new StateTransitionError('unknown_state', `Unknown source state: "${fromRaw}"`, transition);
  }
  if (!STATE_NAMES.has(toRaw as FsmState)) {
    throw new StateTransitionError('unknown_state', `Unknown target state: "${toRaw}"`, transition);
  }
  return { from: fromRaw as FsmState, to: toRaw as FsmState };
}

export function isAllowedTransition(from: FsmState, to: FsmState): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

// Apply an LLM-proposed transition to the current state. Validates that the
// FROM matches the current state and that the transition is allowed.
export function applyTransition(currentState: FsmState, proposedTransition: string): FsmState {
  const parsed = parseTransition(proposedTransition);
  if (parsed.from !== currentState) {
    throw new StateTransitionError(
      'from_mismatch',
      `Proposed transition's FROM (${parsed.from}) does not match current session state (${currentState}).`,
      proposedTransition,
      currentState,
    );
  }
  if (!isAllowedTransition(parsed.from, parsed.to)) {
    throw new StateTransitionError(
      'transition_not_allowed',
      `Transition ${parsed.from} -> ${parsed.to} is not in the allowed set.`,
      proposedTransition,
      currentState,
    );
  }
  return parsed.to;
}

// Convenience: a state is "terminal" if no further transitions are allowed.
export function isTerminal(state: FsmState): boolean {
  return ALLOWED_TRANSITIONS[state].size === 0;
}

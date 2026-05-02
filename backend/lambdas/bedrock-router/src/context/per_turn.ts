// Per-turn context renderer + sliding window.
// Spec §6.3 + §6.7: last 6 turns kept verbatim; older turns get summarized into
// a single "conversation summary" string (the actual summarization is a Haiku
// call, wired in increment 3). This block is uncached.

import type { TurnContext, Turn, SessionState } from './types';
import type { ExtractedValue } from '../parser';

export const TURN_WINDOW_SIZE = 6;

export interface SlidingWindowResult {
  window: Turn[]; // most recent N turns, oldest first
  overflow: Turn[]; // older turns that fell off the window, oldest first
}

export function applySlidingWindow(
  turns: readonly Turn[],
  windowSize: number = TURN_WINDOW_SIZE,
): SlidingWindowResult {
  if (windowSize < 0) {
    throw new Error(`windowSize must be non-negative, got ${windowSize}`);
  }
  if (turns.length <= windowSize) {
    return { window: [...turns], overflow: [] };
  }
  const splitAt = turns.length - windowSize;
  return {
    window: turns.slice(splitAt),
    overflow: turns.slice(0, splitAt),
  };
}

export function renderTurnContext(ctx: TurnContext): string {
  const sections = [
    renderSessionState(ctx.sessionState),
    renderConversationSummary(ctx.conversationSummary),
    renderRecentTurns(ctx.recentTurns),
    renderCurrentTranscript(ctx.currentTranscript, ctx.sessionState.sessionType),
  ];
  return sections.filter((s) => s !== null).join('\n\n');
}

function renderSessionState(s: SessionState): string {
  const lines = [
    '## Current session state',
    '',
    `- Session type: ${s.sessionType}`,
    `- Language: ${s.language}`,
    `- FSM state: ${s.fsmState}`,
    `- Captured this session: ${formatExtractedList(s.capturedThisSession)}`,
    `- Pending confirmation: ${formatExtractedList(s.pendingConfirmation)}`,
    `- Still needed: ${s.stillNeeded.length > 0 ? s.stillNeeded.join(', ') : '(none — all required parameters captured)'}`,
  ];
  return lines.join('\n');
}

function formatExtractedList(values: ExtractedValue[]): string {
  if (values.length === 0) return '(none)';
  return values.map((v) => `${v.parameter} ${v.value} ${v.unit}`).join(', ');
}

function renderConversationSummary(summary: string | null): string | null {
  if (!summary) return null;
  return ['## Earlier in this session (summary of older turns)', '', summary].join('\n');
}

function renderRecentTurns(turns: Turn[]): string {
  if (turns.length === 0) {
    return '## Recent turns\n\n_(this is the first turn)_';
  }
  const lines: string[] = ['## Recent turns', ''];
  for (const t of turns) {
    lines.push(`**${t.role}:** ${t.text}`);
  }
  return lines.join('\n');
}

function renderCurrentTranscript(transcript: string, sessionType: SessionState['sessionType']): string {
  const speaker = sessionType === 'patient_logging' ? 'patient' : 'caregiver';
  return ['## Current transcript', '', `**${speaker}:** ${transcript}`].join('\n');
}

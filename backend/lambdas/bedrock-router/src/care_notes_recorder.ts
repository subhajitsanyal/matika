// Care notes persistence contract for the bedrock-router handler.
// Spec §6.10 — the handler does name-resolution against the care-team list it
// already loaded into the per-patient prompt block; this recorder owns only
// the SQL touch points (insert + ambiguous-lookup + update-to-resolved).
//
// Owner: backend. Three Pg-backed implementations live in db.ts; tests pass
// stubs.

import type { CareTeamMember } from './context/types';

export type CareNoteDisambiguationStatus =
  | 'resolved'          // exactly one match in the care team
  | 'resolved_default'  // no name spoken; defaulted to primary caregiver
  | 'ambiguous'         // multiple matches; candidate_user_ids populated
  | 'no_match';         // spoken name not in the care team

export type CareNoteLanguage = 'en-IN' | 'hi-IN' | 'bn-IN';

export interface CareNotesRecordInput {
  patientId: string;            // internal patients.id UUID
  sessionId: string;
  turnIndex: number;
  noteText: string;
  mentionedName: string | null;
  recipientUserId: string | null;
  candidateUserIds: string[];   // populated only when disambiguation_status === 'ambiguous'
  disambiguationStatus: CareNoteDisambiguationStatus;
  noteLanguage: CareNoteLanguage;
}

export interface RecentAmbiguousNote {
  id: string;
  mentionedName: string | null;
  candidateUserIds: string[];
}

export interface CareNotesRecorder {
  // Returns the inserted row's id.
  insert(input: CareNotesRecordInput): Promise<{ id: string }>;
  // Sentinel-update lookup (§6.10 #4c). Returns the most-recent ambiguous note
  // in the same session within `maxAgeMinutes` (defaults to 5).
  findRecentAmbiguous(sessionId: string, maxAgeMinutes?: number): Promise<RecentAmbiguousNote | null>;
  // Promote an ambiguous note to resolved once the patient's clarifying turn
  // lands. Clears candidate_user_ids and stamps recipient_user_id.
  updateToResolved(id: string, recipientUserId: string, mentionedName: string | null): Promise<void>;
  // Idempotency (§6.10 #6). Returns true iff an identical noteText already
  // exists for the same (sessionId, turnIndex) — handler skips re-insert in
  // that case so a Lambda retry doesn't double-write.
  findDuplicateInTurn(sessionId: string, turnIndex: number, noteText: string): Promise<{ id: string } | null>;
}

// ---------- Resolution algorithm (Spec §6.10 #3) ----------
//
// Pure function over (mentionedName, careTeam). The handler runs this against
// the same `patientCtx.careTeam` list that was rendered into the prompt block,
// so prompt-context and handler-resolution stay in sync.

export interface ResolutionResult {
  status: CareNoteDisambiguationStatus;
  recipientUserId: string | null;
  candidateUserIds: string[];
  // The name the handler will persist into mentioned_name. On a resolved match
  // we use the canonical care-team display name; on no_match we keep the raw
  // spoken referent so the UI can show "Named: <X> (not in care team)".
  mentionedName: string | null;
}

export function resolveRecipient(
  mentionedName: string | null,
  careTeam: CareTeamMember[],
): ResolutionResult {
  // No spoken name → default to the primary (= first active) caregiver.
  if (mentionedName === null || mentionedName.trim() === '') {
    if (careTeam.length === 0) {
      return {
        status: 'no_match',
        recipientUserId: null,
        candidateUserIds: [],
        mentionedName: null,
      };
    }
    const primary = careTeam[0];
    return {
      status: 'resolved_default',
      recipientUserId: primary.userId,
      candidateUserIds: [],
      mentionedName: null,
    };
  }

  const normalized = normalizeName(mentionedName);
  const matches = careTeam.filter((m) => nameMatches(normalized, m.name));

  if (matches.length === 1) {
    return {
      status: 'resolved',
      recipientUserId: matches[0].userId,
      candidateUserIds: [],
      mentionedName: matches[0].name,
    };
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      recipientUserId: null,
      candidateUserIds: matches.map((m) => m.userId),
      mentionedName,
    };
  }
  // The patient said "caregiver" / "my caregiver" — that's not a name, it's a
  // role reference. Treat it as resolved_default against the primary caregiver
  // so the note actually lands somewhere actionable.
  if (isGenericCaregiverWord(normalized) && careTeam.length > 0) {
    return {
      status: 'resolved_default',
      recipientUserId: careTeam[0].userId,
      candidateUserIds: [],
      mentionedName: null,
    };
  }
  return {
    status: 'no_match',
    recipientUserId: null,
    candidateUserIds: [],
    mentionedName,
  };
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function nameMatches(normalizedSpoken: string, careTeamName: string): boolean {
  const normCT = normalizeName(careTeamName);
  if (normCT === normalizedSpoken) return true;
  // Only fall back to first-token match when the SPOKEN name is a single
  // token — bare "John" should match "John CG" and "John Smith" both
  // (downstream ambiguous path forks on that). But a multi-token spoken
  // referent like "John CG" carries enough specificity that we must NOT
  // also match "John Smith" via first-token; that would mis-classify a
  // disambiguating-answer as ambiguous and skip the sentinel-update.
  if (normalizedSpoken.includes(' ')) return false;
  const firstCT = normCT.split(' ')[0];
  return normalizedSpoken.length > 0 && normalizedSpoken === firstCT;
}

function isGenericCaregiverWord(normalized: string): boolean {
  // English + common Hindi/Bengali words for "caregiver / family member".
  // Kept narrow on purpose — broader matching would risk false positives.
  return (
    normalized === 'caregiver' ||
    normalized === 'my caregiver' ||
    normalized === 'family' ||
    normalized === 'parivar' ||      // hi: family
    normalized === 'paribar'         // bn: family
  );
}

// ---------- Sentinel-update detection (§6.10 #4c) ----------
//
// Decide whether a freshly-resolved record_note is the "disambiguating answer"
// to a prior ambiguous note in the same session. Pure decision logic; the
// caller is the one who actually performs the UPDATE.

export function isDisambiguationOf(
  resolution: ResolutionResult,
  recentAmbiguous: RecentAmbiguousNote,
): boolean {
  // Only resolved → resolved transitions trigger an UPDATE. A new ambiguous
  // note alongside an existing one is treated as a fresh row.
  if (resolution.status !== 'resolved') return false;
  if (resolution.recipientUserId === null) return false;
  // The newly-resolved user must have been one of the prior ambiguous
  // candidates. Without this, a totally unrelated record_note ("tell Aunt
  // Padma") on the next turn would clobber the unresolved one.
  return recentAmbiguous.candidateUserIds.includes(resolution.recipientUserId);
}

// ---------- Synthetic next-turn directive (§6.10 #4b) ----------
//
// When a note lands ambiguous, the handler appends this to transcript_history
// as a 'system' Turn. On the patient's next turn the LLM picks it up from the
// per-turn block and emits a clarifying question.

export function buildAmbiguousDirective(
  mentionedName: string | null,
  candidateNames: string[],
): string {
  const safeName = mentionedName ?? '(no name spoken)';
  const list = candidateNames.length > 0 ? candidateNames.join(', ') : '(no candidates)';
  return (
    `Earlier the patient mentioned "${safeName}" — that matched multiple people on the care team (${list}). ` +
    `On your next reply, politely ask the patient which one they meant before continuing with the protocol.`
  );
}

-- V016: Care Notes — generic notes substrate for patient-originated asides
-- captured during conversational sessions.
--
-- PRD §6.9 surface; Spec §5.1 schema (verbatim); Spec §6.10 conversation-engine
-- flow that populates rows; Spec §4.6 caregiver-facing API.
--
-- v2.0 only emits source = 'patient_request' rows. The 'matika_observation'
-- (v2.1) and 'doctor_note' (Phase 2) enum values are seeded now so future
-- writers don't need a follow-up migration.
--
-- FK choices (mirror existing V001 / V015 patterns):
--   patient_id      → patients(id)             ON DELETE CASCADE
--   session_id      → interaction_sessions(id) ON DELETE SET NULL
--                     (nullable to allow non-session origin; session deletes
--                      preserve the note + clear the back-pointer)
--   recipient_user_id → users(id)              ON DELETE SET NULL
--                     (a removed care-team member should not vaporize the
--                      historical record; UI surfaces the mentioned_name)
--   acknowledged_by   → users(id)              (RESTRICT — default)
--                     (matches spec; an acked-by user cannot be removed
--                      without an explicit policy decision)
--
-- ROLLBACK (manual; Flyway does not auto-rollback):
--   DROP TABLE IF EXISTS care_notes;
--   DROP TYPE  IF EXISTS care_note_disambiguation_status;
--   DROP TYPE  IF EXISTS care_note_recipient_role;
--   DROP TYPE  IF EXISTS care_note_source;

CREATE TYPE care_note_source AS ENUM (
    'patient_request',     -- captured from a patient session turn (v2.0)
    'matika_observation',  -- agent-surfaced; emitted by Matika prompts (v2.1)
    'doctor_note'          -- written from the doctor portal (Phase 2)
);

CREATE TYPE care_note_recipient_role AS ENUM ('caregiver', 'doctor');

CREATE TYPE care_note_disambiguation_status AS ENUM (
    'resolved',          -- exactly one match in the care team
    'resolved_default',  -- no name spoken; defaulted to primary caregiver
    'ambiguous',         -- multiple matches; candidate_user_ids populated
    'no_match'           -- spoken name not in the care team
);

CREATE TABLE care_notes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id              UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    session_id              UUID REFERENCES interaction_sessions(id) ON DELETE SET NULL,
    -- nullable to allow non-session origin (future: doctor portal, scheduled jobs)
    turn_index              INTEGER,  -- which turn in the session emitted this, if applicable
    source                  care_note_source NOT NULL,
    recipient_role          care_note_recipient_role NOT NULL DEFAULT 'caregiver',
    recipient_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    -- The resolved-to user. Null when disambiguation_status IN ('ambiguous', 'no_match').
    candidate_user_ids      UUID[] DEFAULT NULL,
    -- Populated only when disambiguation_status = 'ambiguous'; the list of users
    -- that matched the spoken referent.
    mentioned_name          TEXT,
    -- Raw spoken name/nickname as the LLM heard it ("Priya", "Bittu", "Dr. Mehta").
    -- Always populated when source = 'patient_request' AND a name was spoken,
    -- regardless of resolution outcome — so the caregiver UI can show the raw
    -- referent on ambiguous/no_match rows.
    disambiguation_status   care_note_disambiguation_status NOT NULL,
    note_text               TEXT NOT NULL,
    -- The structured note content (NOT the raw transcript snippet — that's
    -- joinable via session_id + turn_index against interaction_sessions.transcript_history).
    note_language           VARCHAR(8) NOT NULL DEFAULT 'en-IN',
    -- Match the patient session language so the caregiver UI can show with
    -- the right script + optional translation.
    acknowledged_at         TIMESTAMPTZ,
    acknowledged_by         UUID REFERENCES users(id),
    -- Caregiver who hit "Acknowledge" in the UI. Null until acked.
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_care_notes_patient_unacked
    ON care_notes (patient_id, created_at DESC)
    WHERE acknowledged_at IS NULL;
-- Hot path: caregiver opening the Notes screen for a patient — list unacked
-- newest-first. Partial index keeps it small as resolved notes accumulate.

CREATE INDEX idx_care_notes_recipient_unacked
    ON care_notes (recipient_user_id, created_at DESC)
    WHERE acknowledged_at IS NULL;
-- For the unread-count badge: caregiver dashboard fans out across all linked
-- patients with one query keyed by recipient_user_id.

CREATE INDEX idx_care_notes_session ON care_notes (session_id)
    WHERE session_id IS NOT NULL;
-- For the detail view: pull the surrounding transcript turns by session_id.

-- updated_at maintenance — match the V004 interaction_sessions trigger pattern
-- (the project ships an update_updated_at_column() helper from V001).
CREATE TRIGGER update_care_notes_updated_at
    BEFORE UPDATE ON care_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

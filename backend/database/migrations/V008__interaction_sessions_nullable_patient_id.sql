-- F23 — voice patient profile extraction needs to bootstrap an
-- interaction_sessions row before the patient exists. Spec §6.9 calls
-- for a "synthetic placeholder" session where patient_id is NULL until
-- the create-patient-from-voice pivot mid-session. Today the column is
-- NOT NULL, so the placeholder INSERT would fail.
--
-- Drop NOT NULL on patient_id, then add a CHECK constraint that allows
-- NULL only for caregiver_onboarding sessions (the only session_type
-- that runs without a pre-existing patient). Patient_logging and
-- caregiver_config sessions still require a patient_id at INSERT time.
--
-- The FK to patients(id) ON DELETE CASCADE is preserved automatically:
-- nullable FK columns simply skip the constraint check when NULL.
--
-- After F23 lands, the bedrock-router UPDATEs patient_id to the real
-- UUID at the mid-session pivot (when create-patient-from-voice
-- returns 200). The CHECK still holds because the post-pivot row has
-- patient_id IS NOT NULL.

ALTER TABLE interaction_sessions
    ALTER COLUMN patient_id DROP NOT NULL;

ALTER TABLE interaction_sessions
    ADD CONSTRAINT interaction_sessions_patient_id_required_unless_caregiver_onboarding
    CHECK (patient_id IS NOT NULL OR session_type = 'caregiver_onboarding');

COMMENT ON COLUMN interaction_sessions.patient_id IS
    'FK to patients(id). NULL allowed ONLY for caregiver_onboarding sessions during the profile-extraction phase, before create-patient-from-voice fires (F23 / spec §6.9). UPDATE to the real patient UUID happens at the mid-session pivot.';

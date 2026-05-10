-- F23 — caregiver_onboarding two-pass session shape (spec §6.9) needs
-- three new fsm_state values to mark the boundaries of the
-- profile-extraction phase:
--   - EXTRACTING_PROFILE: profile-extraction phase active. Reachable
--     from CREATED on caregiver_onboarding sessions.
--   - AWAITING_PROFILE_CONFIRMATION: LLM has delivered the final
--     readback; waiting for caregiver yes/no/"change <field>".
--   - PROFILE_CONFIRMED: caregiver confirmed; bedrock-router has called
--     create-patient-from-voice and the placeholder session row's
--     patient_id has been UPDATEd to the real patient UUID. Successor
--     re-enters the existing protocol-extraction lifecycle (EXTRACTING).
--
-- The check constraint set in V005 only allows the original v1 + v2
-- states. Drop and re-add with the F23 additions appended.

ALTER TABLE interaction_sessions DROP CONSTRAINT IF EXISTS interaction_sessions_fsm_state_check;
ALTER TABLE interaction_sessions ADD CONSTRAINT interaction_sessions_fsm_state_check
    CHECK (fsm_state IN (
        'CREATED',
        'GREETING',
        'EXTRACTING',
        'PENDING_CONFIRMATION',
        'AWAITING_PHOTO',
        'PLAUSIBILITY_CHALLENGE',
        'EMERGENCY',
        'PAUSED',
        'COMPLETE',
        'TERMINAL',
        -- F23 caregiver_onboarding additions:
        'EXTRACTING_PROFILE',
        'AWAITING_PROFILE_CONFIRMATION',
        'PROFILE_CONFIRMED'
    ));

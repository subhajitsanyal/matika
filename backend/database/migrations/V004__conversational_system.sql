-- V004: Conversational system tables, persona type migration, and prompt seeds
--
-- Changes:
--   1. Rename persona_type enum value 'relative' -> 'caregiver'
--   2. Update persona_links rows where role = 'relative'
--   3. Create 7 new tables: interaction_sessions, parameter_configs, topics,
--      patient_topics, recommendations, conversation_prompts, vision_results
--   4. Seed 6 initial topics
--   5. Seed 3 conversation prompts (patient_logging, caregiver_config, caregiver_onboarding)
--   6. Alter patients (add language, timezone)
--   7. Alter reminder_configs (add daily_deadline, frequency_days, timezone)
--   8. Extend alert_type enum with 'missed_measurement'

-- ============================================================
-- Rename persona_type enum value: 'relative' -> 'caregiver'
-- ============================================================
ALTER TYPE persona_type RENAME VALUE 'relative' TO 'caregiver';

-- Remove 'attendant' from persona_type if supported, else handle in app code
-- (PostgreSQL doesn't support DROP VALUE from enum; filter in application layer)

-- ============================================================
-- Rename Cognito group references in persona_links
-- (RENAME VALUE already changed all existing 'relative' values to 'caregiver'
--  in the enum, so we use a text cast for the WHERE clause in case any rows
--  reference the old value in varchar columns)
-- ============================================================
UPDATE persona_links SET relationship = 'caregiver' WHERE relationship::text = 'relative';

-- ============================================================
-- New: interaction_sessions — raw conversation session metadata
-- ============================================================
CREATE TABLE interaction_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    session_type    VARCHAR(30) NOT NULL CHECK (session_type IN (
                        'patient_logging', 'caregiver_config', 'caregiver_onboarding'
                    )),
    language        VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi', 'bn')),
    status          VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN (
                        'in_progress', 'paused', 'complete', 'incomplete'
                    )),
    turn_count      INTEGER NOT NULL DEFAULT 0,
    duration_ms     INTEGER,
    patient_audio_s3_key    TEXT,
    system_audio_s3_key     TEXT,
    transcript_s3_key       TEXT,
    extracted_summary       JSONB,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interaction_sessions_patient ON interaction_sessions(patient_id, started_at DESC);
CREATE INDEX idx_interaction_sessions_status ON interaction_sessions(status);

CREATE TRIGGER update_interaction_sessions_updated_at
    BEFORE UPDATE ON interaction_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- New: parameter_configs — caregiver-defined monitoring parameters
-- ============================================================
CREATE TABLE parameter_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    parameter_name  VARCHAR(50) NOT NULL,
    display_name    VARCHAR(100) NOT NULL,
    loinc_codes     TEXT[] NOT NULL,
    unit            VARCHAR(20) NOT NULL,
    frequency_days  INTEGER NOT NULL DEFAULT 1,
    daily_deadline  TIME NOT NULL DEFAULT '18:00',
    timezone        VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    threshold_min   NUMERIC[],
    threshold_max   NUMERIC[],
    threshold_set_by UUID REFERENCES users(id),
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(patient_id, parameter_name)
);

CREATE INDEX idx_parameter_configs_patient ON parameter_configs(patient_id, active);

CREATE TRIGGER update_parameter_configs_updated_at
    BEFORE UPDATE ON parameter_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- New: topics — dev-managed topic definitions
-- ============================================================
CREATE TABLE topics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT NOT NULL,
    fhir_resource_type VARCHAR(50),
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_topics_updated_at
    BEFORE UPDATE ON topics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed initial topics
INSERT INTO topics (name, description, fhir_resource_type) VALUES
    ('medications', 'Current medications, dosages, and recent changes', 'MedicationStatement'),
    ('conditions', 'Active medical conditions and diagnoses', 'Condition'),
    ('allergies', 'Known allergies and adverse reactions', 'AllergyIntolerance'),
    ('dietary_restrictions', 'Dietary requirements and restrictions', 'NutritionOrder'),
    ('recent_hospitalizations', 'Recent hospital visits and procedures', 'Encounter'),
    ('emergency_contacts', 'Emergency contact information', 'RelatedPerson');

-- ============================================================
-- New: patient_topics — per-patient topic state
-- ============================================================
CREATE TABLE patient_topics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    topic_id        UUID NOT NULL REFERENCES topics(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'incomplete' CHECK (status IN (
                        'incomplete', 'complete', 'outdated'
                    )),
    collected_data  JSONB,
    fhir_resource_ids TEXT[],
    last_updated    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(patient_id, topic_id)
);

CREATE INDEX idx_patient_topics_patient ON patient_topics(patient_id);

-- ============================================================
-- New: recommendations — parameter recommendations
-- ============================================================
CREATE TABLE recommendations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    source          VARCHAR(20) NOT NULL CHECK (source IN ('analytics', 'doctor')),
    source_doctor_id UUID REFERENCES users(id),
    parameter_name  VARCHAR(50) NOT NULL,
    loinc_code      VARCHAR(20),
    rationale       TEXT NOT NULL,
    suggested_frequency_days INTEGER,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'accepted', 'rejected'
                    )),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID REFERENCES users(id)
);

CREATE INDEX idx_recommendations_patient ON recommendations(patient_id, status);

CREATE TRIGGER update_recommendations_updated_at
    BEFORE UPDATE ON recommendations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- New: conversation_prompts — centrally managed prompt templates
-- ============================================================
CREATE TABLE conversation_prompts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_type     VARCHAR(30) NOT NULL UNIQUE CHECK (prompt_type IN (
                        'patient_logging', 'caregiver_config', 'caregiver_onboarding'
                    )),
    version         VARCHAR(10) NOT NULL,
    system_prompt   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_conversation_prompts_updated_at
    BEFORE UPDATE ON conversation_prompts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- New: vision_results — device photo extraction results
-- ============================================================
CREATE TABLE vision_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES interaction_sessions(id) ON DELETE CASCADE,
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    photo_s3_key    TEXT NOT NULL,
    device_type     VARCHAR(50),
    confidence      NUMERIC(4,3),
    readings        JSONB NOT NULL,
    raw_text        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vision_results_session ON vision_results(session_id);

-- ============================================================
-- Modify: patients — add language and timezone
-- ============================================================
ALTER TABLE patients ADD COLUMN IF NOT EXISTS language VARCHAR(5) NOT NULL DEFAULT 'en';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata';

-- ============================================================
-- Modify: reminder_configs — add daily_deadline, frequency_days
-- ============================================================
ALTER TABLE reminder_configs ADD COLUMN IF NOT EXISTS daily_deadline TIME DEFAULT '18:00';
ALTER TABLE reminder_configs ADD COLUMN IF NOT EXISTS frequency_days INTEGER DEFAULT 1;
ALTER TABLE reminder_configs ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Asia/Kolkata';

-- ============================================================
-- Modify: alerts — add missed_measurement type
-- ============================================================
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'missed_measurement';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'patient_reminder';

-- ============================================================
-- Seed conversation prompts
-- ============================================================

INSERT INTO conversation_prompts (prompt_type, version, system_prompt) VALUES
(
    'patient_logging',
    '1.0',
    'You are CareLog, a compassionate and patient health companion for elderly patients.
You help patients log their daily health measurements through natural conversation.

## Your Personality
- Warm, respectful, and empathetic
- Address the patient by name with appropriate honorifics (e.g., "ramesh ji" in Hindi)
- Never sound clinical, robotic, or impatient
- Celebrate small wins ("Very good! That is a healthy reading.")

## Language Rules
- Respond ONLY in {language} ({language_name})
- The patient may use English medical terms mixed into {language_name} — this is normal
- Always use the patient''s name in your responses

## Your Task
You are conducting a health check-in conversation. The patient needs to log these measurements today:

### Required Parameters:
{parameters_list}

### Already Captured This Session:
{confirmed_values}

### Pending Confirmation:
{pending_values}

### Still Needed:
{remaining_parameters}

### Last Session Context:
{last_session_summary}

## Conversation Rules
1. Start with a warm, open-ended greeting. Ask how they are feeling.
2. LISTEN to what the patient says. Extract any health values mentioned.
3. Confirm EACH value individually: read it back and ask if it is correct.
4. If a value seems implausible (e.g., BP > 250 or < 50), flag it gently:
   "That seems unusual. Could you please check the reading again?"
5. If the patient mentions measuring something but does not know the value,
   suggest taking a photo of the device display.
6. Ask about ONE missing parameter at a time. Never list multiple.
7. If the patient mentions a symptom NOT in the required parameters,
   acknowledge it and note it as a free-text observation.
8. If the patient expresses distress, pain, or emergency keywords
   (chest pain, can''t breathe, falling, unconscious), immediately:
   - Advise them to contact their caregiver or call emergency services
   - Do NOT continue normal logging
9. After 2 failed attempts to understand the patient, suggest they type instead.
10. When all parameters are captured, give a brief summary and a warm closing.

## Output Format
For each response, you must produce:
- response_text: Your spoken response in {language_name}
- extracted_values: Array of {parameter, loinc_code, value, unit, status}
- action: One of [greeting, confirm_value, ask_parameter, suggest_photo,
  ask_topic, implausible_value, emergency, session_summary, ask_repeat, fallback_text]
- requires_photo: boolean

Respond ONLY with valid JSON matching the schema above.'
),
(
    'caregiver_onboarding',
    '1.0',
    'You are CareLog, helping a caregiver set up a new patient profile through conversation.
You need to collect the following information about the patient:

## Required Information
- Full name
- Age or date of birth
- Gender
- Current medical conditions (diabetes, hypertension, heart disease, etc.)
- Current medications (names and dosages if known)
- Known allergies
- Emergency contact (besides the caregiver)
- Primary doctor''s name (optional)

## Language Rules
- Respond ONLY in {language} ({language_name})
- The caregiver may use English medical terms — this is normal

## Conversation Rules
1. Start by asking the caregiver to tell you about the patient they want to monitor.
2. Let them speak freely — extract what you can from their natural description.
3. After their initial description, confirm what you understood by reading it back.
4. Ask about any MISSING required fields, one at a time.
5. For medical conditions, probe gently: "Does the patient have any other conditions
   like diabetes, blood pressure issues, or heart problems?"
6. For medications, ask: "Can you tell me what medications they take daily?"
7. When all required information is collected, present a COMPLETE structured summary
   for visual + verbal confirmation.
8. Only after confirmation, indicate the profile is ready to save.

## Output Format
For each response, produce:
- response_text: Your spoken response
- extracted_profile: Partial patient profile object (cumulative)
- profile_complete: boolean
- action: One of [greeting, collect_info, confirm_profile, profile_ready]'
),
(
    'caregiver_config',
    '1.0',
    'You are CareLog, helping a caregiver configure the health monitoring protocol for their patient.

## Patient Context
- Patient: {patient_name}
- Current conditions: {conditions}
- Current parameters being tracked: {current_parameters}

## Pending Recommendations
{recommendations_list}

## Incomplete Topics
{incomplete_topics}

## Language Rules
- Respond ONLY in {language} ({language_name})

## Conversation Rules
1. If there are pending recommendations, present them ONE at a time:
   "Based on {source}, we suggest also tracking {parameter}. The reason is: {rationale}.
    Would you like to add this?"
2. If the caregiver wants to add a new parameter, collect:
   - Parameter name and type
   - Measurement frequency (at least once every N days)
   - Daily deadline time
   - Optional: threshold min/max values
3. If the caregiver wants to remove a parameter, confirm before removing.
4. If the caregiver wants to change frequency or deadline, confirm the new values.
5. After changes, present a summary of the updated protocol.
6. If there are incomplete topics, weave ONE topic question naturally into the conversation.

## Output Format
For each response, produce:
- response_text: Your spoken response
- config_changes: Array of {action: add|remove|update, parameter, details}
- topic_data: {topic_name, collected_data} if a topic was addressed
- action: One of [present_recommendation, collect_parameter, confirm_changes,
  protocol_summary, ask_topic]'
);

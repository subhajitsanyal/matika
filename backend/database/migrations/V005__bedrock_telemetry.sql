-- V005: Bedrock telemetry + v2 conversational state extensions.
--
-- Closes the schema half of T-V2-103, T-V2-105, T-V2-107, T-V2-108.
--
-- Splits naturally into four sections:
--   1. Extend interaction_sessions with v2 conversational columns
--   2. Migrate language column to BCP-47 region forms (en-IN / hi-IN / bn-IN)
--   3. Create model_call telemetry table (every Bedrock invocation)
--   4. Create cost_telemetry rollup table (daily per-patient summary)
--
-- Owned by backend agent. Spec: docs/matika_spec_v2.md §5.1.
--
-- v1 schema reality vs v2 spec: V004 created tables with PLURAL names
-- (interaction_sessions, parameter_configs, recommendations, etc.). The v2
-- spec docs accidentally use singular ("interaction_session"); the spec is
-- wrong, the v1 deployed schema is right. v2 code references plural.

BEGIN;

-- ============================================================
-- 1. v2 conversational state columns on interaction_sessions
-- ============================================================
-- All columns are nullable / DEFAULT-ed so existing v1 rows accept the
-- migration without backfill work.

ALTER TABLE interaction_sessions
    ADD COLUMN IF NOT EXISTS fsm_state             VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    ADD COLUMN IF NOT EXISTS captured_this_session JSONB       NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS pending_confirmation  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS still_needed          TEXT[]      NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN IF NOT EXISTS transcript_history    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS conversation_summary  TEXT,
    ADD COLUMN IF NOT EXISTS streaming_used        BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS escalations_triggered JSONB,
    ADD COLUMN IF NOT EXISTS inference_region      VARCHAR(32);

-- FSM state must match handler/state_machine.ts FsmState type.
ALTER TABLE interaction_sessions DROP CONSTRAINT IF EXISTS interaction_sessions_fsm_state_check;
ALTER TABLE interaction_sessions ADD CONSTRAINT interaction_sessions_fsm_state_check
    CHECK (fsm_state IN (
        'CREATED', 'GREETING', 'EXTRACTING', 'PENDING_CONFIRMATION',
        'AWAITING_PHOTO', 'PLAUSIBILITY_CHALLENGE', 'EMERGENCY',
        'PAUSED', 'COMPLETE', 'TERMINAL'
    ));

CREATE INDEX IF NOT EXISTS idx_interaction_sessions_fsm_state
    ON interaction_sessions(fsm_state)
    WHERE fsm_state NOT IN ('TERMINAL', 'COMPLETE');

-- ============================================================
-- 2. Language column → BCP-47 region forms (en-IN / hi-IN / bn-IN)
-- ============================================================
-- v1 used 2-letter codes ('en'); v2 code (Android SpeechRecognizer locales,
-- Bedrock TTS hints) uses 5-char region forms. Backfill existing rows by
-- appending the '-IN' region tag. Future regions can be added by widening
-- the CHECK constraint.

ALTER TABLE interaction_sessions ALTER COLUMN language TYPE VARCHAR(8);
ALTER TABLE interaction_sessions DROP CONSTRAINT IF EXISTS interaction_sessions_language_check;
UPDATE interaction_sessions SET language = language || '-IN' WHERE length(language) = 2;
ALTER TABLE interaction_sessions ADD CONSTRAINT interaction_sessions_language_check
    CHECK (language IN ('en-IN', 'hi-IN', 'bn-IN'));

ALTER TABLE patients ALTER COLUMN language TYPE VARCHAR(8);
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_language_check;
UPDATE patients SET language = language || '-IN' WHERE length(language) = 2;
ALTER TABLE patients ADD CONSTRAINT patients_language_check
    CHECK (language IN ('en-IN', 'hi-IN', 'bn-IN'));

-- ============================================================
-- 3. model_call: per-Bedrock-invocation telemetry
-- ============================================================
-- Every text or vision Bedrock call from bedrock-router or bedrock-vision
-- writes one row here. Cost computed at insert time using the pricing
-- constants in backend/lambdas/bedrock-router/src/pricing.ts (and the
-- mirror in bedrock-vision/src/telemetry.ts). Rollup picks up these rows
-- daily into cost_telemetry.

CREATE TABLE IF NOT EXISTS model_call (
    id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id                  UUID            NOT NULL REFERENCES interaction_sessions(id) ON DELETE CASCADE,
    patient_id                  UUID            NOT NULL REFERENCES patients(id)             ON DELETE CASCADE,
    tier                        VARCHAR(16)     NOT NULL CHECK (tier IN ('T2','T3','T2_VISION','T3_VISION')),
    model                       VARCHAR(64)     NOT NULL,
    streamed                    BOOLEAN         NOT NULL DEFAULT FALSE,
    guardrail_blocked           BOOLEAN         NOT NULL DEFAULT FALSE,
    input_tokens                INTEGER         NOT NULL CHECK (input_tokens >= 0),
    cached_input_tokens         INTEGER         NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
    output_tokens               INTEGER         NOT NULL CHECK (output_tokens >= 0),
    latency_ms                  INTEGER         NOT NULL CHECK (latency_ms >= 0),
    inference_region            VARCHAR(32)     NOT NULL,
    -- Free-form: includes EscalationSignal values plus telemetry-only
    -- markers like 'summarizer_overflow', 'vision_low_confidence'.
    escalation_reason           VARCHAR(64),
    cost_usd                    NUMERIC(10,6)   NOT NULL CHECK (cost_usd >= 0),
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT model_call_cached_lte_input
        CHECK (cached_input_tokens <= input_tokens)
);

-- Daily rollup query: WHERE patient_id = $1 AND created_at >= today_utc().
-- Keep patient_id as leading column so range scans by date are fast.
CREATE INDEX IF NOT EXISTS idx_model_call_patient_day
    ON model_call (patient_id, created_at);

-- For per-session telemetry queries (admin tab, debug).
CREATE INDEX IF NOT EXISTS idx_model_call_session
    ON model_call (session_id);

-- For escalation-reason analysis (e.g. "how often does Sonnet fire?").
CREATE INDEX IF NOT EXISTS idx_model_call_escalation
    ON model_call (escalation_reason)
    WHERE escalation_reason IS NOT NULL;

-- ============================================================
-- 4. cost_telemetry: daily per-patient rollup
-- ============================================================
-- Populated by the cost-telemetry-rollup Lambda nightly. UPSERT-shaped
-- so backfills and re-runs are safe.
--
-- ocr_local_calls is NOT touched by the rollup Lambda (those calls happen
-- on-device via ML Kit, not via Bedrock; they don't generate model_call
-- rows). A separate client-telemetry endpoint will populate it later.

CREATE TABLE IF NOT EXISTS cost_telemetry (
    id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id                  UUID            NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    day                         DATE            NOT NULL,
    haiku_calls                 INTEGER         NOT NULL DEFAULT 0 CHECK (haiku_calls >= 0),
    sonnet_calls                INTEGER         NOT NULL DEFAULT 0 CHECK (sonnet_calls >= 0),
    vision_haiku_calls          INTEGER         NOT NULL DEFAULT 0 CHECK (vision_haiku_calls >= 0),
    vision_sonnet_calls         INTEGER         NOT NULL DEFAULT 0 CHECK (vision_sonnet_calls >= 0),
    ocr_local_calls             INTEGER         NOT NULL DEFAULT 0 CHECK (ocr_local_calls >= 0),
    total_input_tokens          INTEGER         NOT NULL DEFAULT 0 CHECK (total_input_tokens >= 0),
    total_cached_input_tokens   INTEGER         NOT NULL DEFAULT 0 CHECK (total_cached_input_tokens >= 0),
    total_output_tokens         INTEGER         NOT NULL DEFAULT 0 CHECK (total_output_tokens >= 0),
    total_cost_usd              NUMERIC(10,4)   NOT NULL DEFAULT 0 CHECK (total_cost_usd >= 0),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    UNIQUE (patient_id, day)
);

CREATE INDEX IF NOT EXISTS idx_cost_telemetry_day
    ON cost_telemetry (day);

CREATE INDEX IF NOT EXISTS idx_cost_telemetry_patient
    ON cost_telemetry (patient_id, day DESC);

COMMIT;

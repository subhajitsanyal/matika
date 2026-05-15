-- V011 — Phase 2 telemetry: conversation session daily rollup, per tier.
--
-- See docs/v2_launch_plan.md §4.7. The Phase 2 doctor portal needs
-- longitudinal data on conversation health: how often patients converse,
-- how often Haiku (T2) escalates to Sonnet (T3), guardrail block rate,
-- per-tier cost. This rollup captures it from day 1 of beta.
--
-- Companion lambda: carelog-<env>-conversation-session-rollup,
-- hourly EventBridge schedule, recomputes today + yesterday in UTC
-- (cost rollups are billing-period scoped, not patient-tz scoped).
--
-- Grain: per (patient_id, day, tier).
--   - "tier" is from model_call.tier (T2|T3|T2_VISION|T3_VISION).
--   - Tier-scoped metrics (model_call_count, tokens, cost, latency,
--     guardrail_block_count, escalation_count) come from model_call
--     rows where tier matches.
--   - Session-scoped metrics (session_count, completed_session_count,
--     total_turns) attribute each session to the HIGHEST tier it ever
--     touched (T3 > T3_VISION > T2_VISION > T2). So a session that
--     escalated counts in the T3 row, not the T2 row — gives clean
--     partition + makes "T3 escalation rate" trivially queryable as
--     `T3.session_count / SUM(*).session_count`.

CREATE TABLE conversation_session_daily (
    patient_id              UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    day                     DATE NOT NULL,
    tier                    VARCHAR(16) NOT NULL,           -- 'T2'|'T3'|'T2_VISION'|'T3_VISION'
    -- Session-scoped (attributed to MAX-tier the session touched)
    session_count           INTEGER NOT NULL DEFAULT 0,
    completed_session_count INTEGER NOT NULL DEFAULT 0,     -- status='complete'
    total_turns             INTEGER NOT NULL DEFAULT 0,     -- SUM(turn_count) over those sessions
    -- Tier-scoped (sourced directly from model_call where tier matches)
    model_call_count        INTEGER NOT NULL DEFAULT 0,
    guardrail_block_count   INTEGER NOT NULL DEFAULT 0,     -- guardrail_blocked=true
    escalation_count        INTEGER NOT NULL DEFAULT 0,     -- escalation_reason IS NOT NULL
    total_input_tokens      BIGINT  NOT NULL DEFAULT 0,
    cached_input_tokens     BIGINT  NOT NULL DEFAULT 0,
    total_output_tokens     BIGINT  NOT NULL DEFAULT 0,
    total_cost_usd          NUMERIC(10,4) NOT NULL DEFAULT 0,
    p50_latency_ms          INTEGER,                         -- NULL when model_call_count=0
    p95_latency_ms          INTEGER,
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (patient_id, day, tier)
);

CREATE INDEX idx_conv_session_day ON conversation_session_daily(day DESC);
CREATE INDEX idx_conv_session_patient_day ON conversation_session_daily(patient_id, day DESC);

COMMENT ON TABLE conversation_session_daily IS
    'Phase 2 telemetry: per-patient per-day per-tier conversation rollup. Populated by carelog-<env>-conversation-session-rollup Lambda (hourly EventBridge cron). Session-scoped metrics use MAX-tier-touched attribution; tier-scoped metrics come from model_call directly. See docs/v2_launch_plan.md §4.7.';

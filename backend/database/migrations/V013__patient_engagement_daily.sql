-- V013 — Phase 2 telemetry: patient engagement daily rollup with
-- zero-activity day materialization for trivial drop-off detection.
--
-- See docs/v2_launch_plan.md §4.7. Phase 2 doctor portal's headline
-- question is "which patients should I look at?" — the cheapest signal
-- for that is "patient hasn't done anything in N+ days." This rollup
-- materializes one row per active patient per day INCLUDING zero-
-- activity days, so drop-off queries are a one-liner:
--   SELECT patient_id FROM patient_engagement_daily
--   WHERE day = CURRENT_DATE AND days_since_last_activity > 7;
--
-- Companion lambda: carelog-<env>-patient-engagement-rollup, hourly
-- EventBridge schedule, recomputes today + yesterday in patient
-- timezone (engagement is a user-facing concept; tz-anchored).
--
-- Grain: per (patient_id, day). One row per active patient per day,
-- whether or not anything happened.
--
-- Storage cost: ~1000 patients × 365 days × 1 row = 365k rows/yr.
-- Negligible at v2.0 scale; revisit if patient count exceeds 100k.

CREATE TABLE patient_engagement_daily (
    patient_id               UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    day                      DATE NOT NULL,
    -- Activity counts for THIS day
    session_count            INTEGER NOT NULL DEFAULT 0,
    observation_count        INTEGER NOT NULL DEFAULT 0,
    alert_acked_count        INTEGER NOT NULL DEFAULT 0,     -- caregiver-side ack (alerts.is_read=true)
    -- Convenience flag — true iff (session_count + observation_count + alert_acked_count) > 0
    any_activity             BOOLEAN NOT NULL DEFAULT FALSE,
    -- Most recent activity timestamp across the patient's full history
    -- (NOT scoped to `day` — denormalized for cheap drop-off queries).
    last_activity_at         TIMESTAMPTZ,
    -- Days between `day` and last_activity_at, computed at materialization
    -- time. 0 when any_activity=true. Indexed for the headline drop-off
    -- query.
    days_since_last_activity INTEGER NOT NULL DEFAULT 0,
    computed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (patient_id, day)
);

CREATE INDEX idx_engagement_day ON patient_engagement_daily(day DESC);
CREATE INDEX idx_engagement_dropoff ON patient_engagement_daily(day DESC, days_since_last_activity DESC);

COMMENT ON TABLE patient_engagement_daily IS
    'Phase 2 telemetry: per-patient per-day engagement rollup with zero-activity rows materialized. days_since_last_activity is the drop-off signal. Populated by carelog-<env>-patient-engagement-rollup Lambda (hourly EventBridge cron). See docs/v2_launch_plan.md §4.7.';

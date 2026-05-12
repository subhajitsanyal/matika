-- V010 — Phase 2 telemetry: vital coverage daily rollup table.
--
-- See docs/v2_launch_plan.md §4.7. Doctor portal product work in
-- Phase 2 (post-GA + 8 weeks) needs longitudinal vital-completion
-- data per patient per parameter to answer the discovery questions
-- (which patients does a doctor most want to see; what cadence;
-- what summary cards are useful). This rollup table captures it
-- from day 1 of beta so the data is ready when discovery starts.
--
-- The companion `carelog-<env>-vital-coverage-rollup` Lambda runs
-- hourly via EventBridge, recomputing today + yesterday for every
-- active parameter config. INSERT ON CONFLICT UPDATE means the
-- table is monotonically grown — historical rows are never deleted.

CREATE TABLE vital_coverage_daily (
    patient_id       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    day              DATE NOT NULL,
    parameter_name   VARCHAR(50) NOT NULL,
    -- Observations of this parameter logged for this patient on this day,
    -- counted from observation_sync_log irrespective of sync_status (a
    -- pending sync still counts as an observation for completion-rate
    -- purposes).
    actual_count     INTEGER NOT NULL DEFAULT 0,
    -- Per-day expected rate derived from parameter_configs.frequency_days
    -- at materialization time. frequency_days=1 → 1.000 expected/day;
    -- frequency_days=3 → 0.333. Stored on the row so historical pcts
    -- reflect the config in effect that day, not the current config.
    expected_per_day NUMERIC(6,3) NOT NULL,
    -- Rolling completion percentages over the trailing 7 / 30 / 90 days
    -- inclusive of `day`. NULL when the window crosses days where this
    -- patient-parameter pair didn't exist yet (e.g. patient onboarded
    -- 3 days ago → rolling_30d_pct is NULL until they have a 30-day
    -- history). Materialized once per row write so dashboards don't
    -- need a recursive query.
    rolling_7d_pct   NUMERIC(5,2),
    rolling_30d_pct  NUMERIC(5,2),
    rolling_90d_pct  NUMERIC(5,2),
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (patient_id, day, parameter_name)
);

-- Common access patterns:
-- * "all patients on day X" → idx_vital_coverage_day
-- * "patient X over time" → idx_vital_coverage_patient_day
CREATE INDEX idx_vital_coverage_day ON vital_coverage_daily(day DESC);
CREATE INDEX idx_vital_coverage_patient_day ON vital_coverage_daily(patient_id, day DESC);

COMMENT ON TABLE vital_coverage_daily IS
    'Phase 2 telemetry: per-patient per-parameter daily vital logging coverage. Populated by carelog-<env>-vital-coverage-rollup Lambda (hourly EventBridge cron). See docs/v2_launch_plan.md §4.7.';

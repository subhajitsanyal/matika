-- V012 — Phase 2 telemetry: alert flow daily rollup, per alert_type.
--
-- See docs/v2_launch_plan.md §4.7. Phase 2 doctor portal needs to know
-- alert volumes by class (threshold_breach storms vs missed_measurement
-- patterns) and caregiver responsiveness (time-to-read). This rollup
-- captures it from day 1 of beta.
--
-- Companion lambda: carelog-<env>-alert-flow-rollup, hourly EventBridge
-- schedule, recomputes today + yesterday in patient timezone (alerts
-- belong to the patient's day for caregiver UX purposes).
--
-- Grain: per (patient_id, day, alert_type).
--   - alert_type uses the V001 enum: threshold_breach | reminder_lapse |
--     system | missed_measurement | patient_reminder.
--   - sent_count = is_sent=true (delivery succeeded).
--   - read_count = is_read=true (caregiver/recipient acked).
--   - send_failure_count = send_error IS NOT NULL.
--   - time-to-read percentiles computed from rows where is_read=true.
--     Stored as INTEGER seconds; NULL when read_count = 0.

CREATE TABLE alert_flow_daily (
    patient_id                  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    day                         DATE NOT NULL,
    alert_type                  alert_type NOT NULL,            -- enum from V001
    raised_count                INTEGER NOT NULL DEFAULT 0,
    sent_count                  INTEGER NOT NULL DEFAULT 0,
    read_count                  INTEGER NOT NULL DEFAULT 0,
    send_failure_count          INTEGER NOT NULL DEFAULT 0,
    median_time_to_read_seconds INTEGER,
    p95_time_to_read_seconds    INTEGER,
    computed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (patient_id, day, alert_type)
);

CREATE INDEX idx_alert_flow_day ON alert_flow_daily(day DESC);
CREATE INDEX idx_alert_flow_patient_day ON alert_flow_daily(patient_id, day DESC);

COMMENT ON TABLE alert_flow_daily IS
    'Phase 2 telemetry: per-patient per-day per-alert_type rollup of alerts raised/sent/read + time-to-read percentiles. Populated by carelog-<env>-alert-flow-rollup Lambda (hourly EventBridge cron). See docs/v2_launch_plan.md §4.7.';

-- Reconcile flyway_schema_history after a greenfield psql-driven
-- V001..VXXX migration. Used by Stream H staging stand-up (2026-05-15)
-- and reusable for any future env first-apply where we choose plain
-- psql + manual recording over flyway baseline.
--
-- Rationale: Flyway's schema history table is auto-created by
-- `flyway baseline` or the first `flyway migrate` run. When the
-- migrations are applied with plain psql instead, the table never gets
-- created. A subsequent flyway invocation would re-apply every
-- migration (and fail loudly on the second-create-of-tables).
--
-- Run this AFTER `psql ... -f V001..VXXX.sql` succeeds. Idempotent on
-- the CREATE TABLE / CREATE INDEX (IF NOT EXISTS); the INSERT uses
-- ON CONFLICT DO NOTHING so re-running is safe even if some rows
-- already exist (e.g. flyway baseline ran historically and added the
-- first few rows).
--
-- When you add a NEW migration (V015+), append a row to the INSERT
-- below in the same session that runs the migration. Mirror the
-- pattern in dev's V010..V013 / staging's V001..V014.

CREATE TABLE IF NOT EXISTS flyway_schema_history (
    installed_rank INT NOT NULL,
    version VARCHAR(50),
    description VARCHAR(200) NOT NULL,
    type VARCHAR(20) NOT NULL,
    script VARCHAR(1000) NOT NULL,
    checksum INT,
    installed_by VARCHAR(100) NOT NULL,
    installed_on TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    execution_time INT NOT NULL,
    success BOOLEAN NOT NULL,
    CONSTRAINT flyway_schema_history_pk PRIMARY KEY (installed_rank)
);
CREATE INDEX IF NOT EXISTS flyway_schema_history_s_idx ON flyway_schema_history(success);

INSERT INTO flyway_schema_history (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) VALUES
  (1,  '001', 'initial schema',                                       'SQL', 'V001__initial_schema.sql',                                       NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (2,  '002', 'attendant invites',                                    'SQL', 'V002__attendant_invites.sql',                                    NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (3,  '003', 'additional tables',                                    'SQL', 'V003__additional_tables.sql',                                    NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (4,  '004', 'conversational system',                                'SQL', 'V004__conversational_system.sql',                                NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (5,  '005', 'bedrock telemetry',                                    'SQL', 'V005__bedrock_telemetry.sql',                                    NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (6,  '006', 'device tokens endpoint arn',                           'SQL', 'V006__device_tokens_endpoint_arn.sql',                           NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (7,  '007', 'device tokens user device unique',                     'SQL', 'V007__device_tokens_user_device_unique.sql',                     NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (8,  '008', 'interaction sessions nullable patient id',             'SQL', 'V008__interaction_sessions_nullable_patient_id.sql',             NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (9,  '009', 'interaction sessions caregiver onboarding fsm states', 'SQL', 'V009__interaction_sessions_caregiver_onboarding_fsm_states.sql', NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (10, '010', 'vital coverage daily',                                 'SQL', 'V010__vital_coverage_daily.sql',                                 NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (11, '011', 'conversation session daily',                           'SQL', 'V011__conversation_session_daily.sql',                           NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (12, '012', 'alert flow daily',                                     'SQL', 'V012__alert_flow_daily.sql',                                     NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (13, '013', 'patient engagement daily',                             'SQL', 'V013__patient_engagement_daily.sql',                             NULL, 'manual-stream-h', NOW(), 0, TRUE),
  (14, '014', 'email suppression',                                    'SQL', 'V014__email_suppression.sql',                                    NULL, 'manual-stream-h', NOW(), 0, TRUE)
ON CONFLICT (installed_rank) DO NOTHING;

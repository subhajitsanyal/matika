-- Migration: Create notifications-related tables
-- Version: 5
-- Description: Tables for device tokens and alerts

-- Device tokens table for push notification endpoints
CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    device_id VARCHAR(255) NOT NULL,
    device_token TEXT NOT NULL,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('ios', 'android')),
    endpoint_arn TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Ensure one token per device per user
    CONSTRAINT unique_device_user UNIQUE (device_id, user_id)
);

-- Index for looking up tokens by user
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);

-- Index for looking up tokens by endpoint ARN
CREATE INDEX IF NOT EXISTS idx_device_tokens_endpoint_arn ON device_tokens(endpoint_arn);

-- Alerts table for storing notification history
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('THRESHOLD_BREACH', 'REMINDER_LAPSE', 'PATIENT_REMINDER', 'SYSTEM')),
    vital_type VARCHAR(50),
    value DECIMAL(10, 2),
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Index for fetching alerts by patient
CREATE INDEX IF NOT EXISTS idx_alerts_patient_id ON alerts(patient_id);

-- Index for fetching alerts by user
CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);

-- Index for filtering by alert type
CREATE INDEX IF NOT EXISTS idx_alerts_alert_type ON alerts(alert_type);

-- Index for fetching recent alerts
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);

-- Alert reads table for tracking read status per user
CREATE TABLE IF NOT EXISTS alert_reads (
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    PRIMARY KEY (alert_id, user_id)
);

-- Index for checking if alert is read by user
CREATE INDEX IF NOT EXISTS idx_alert_reads_user_id ON alert_reads(user_id);

-- Observations table for tracking vital logs (if not already exists)
CREATE TABLE IF NOT EXISTS observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vital_type VARCHAR(50) NOT NULL,
    value DECIMAL(10, 2) NOT NULL,
    secondary_value DECIMAL(10, 2),
    unit VARCHAR(20),
    performer_id VARCHAR(255),
    performer_role VARCHAR(50),
    fhir_resource_id VARCHAR(255),
    sync_status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    synced_at TIMESTAMP WITH TIME ZONE
);

-- Index for fetching observations by patient and vital type
CREATE INDEX IF NOT EXISTS idx_observations_patient_vital ON observations(patient_id, vital_type);

-- Index for fetching recent observations
CREATE INDEX IF NOT EXISTS idx_observations_created_at ON observations(created_at DESC);

-- Add comments
COMMENT ON TABLE device_tokens IS 'Stores device push notification tokens for SNS endpoints';
COMMENT ON TABLE alerts IS 'Stores alert notifications sent to users';
COMMENT ON TABLE alert_reads IS 'Tracks which alerts have been read by which users';
COMMENT ON TABLE observations IS 'Local cache of vital observations for reminder checking';

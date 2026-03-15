-- CareLog Database Schema
-- Version: V001
-- Description: Initial schema for CareLog application
--
-- HIPAA Compliance:
-- - All PHI fields are encrypted at rest via RDS encryption
-- - Audit logging enabled for all tables
-- - Timestamps for all modifications

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE persona_type AS ENUM ('patient', 'attendant', 'relative', 'doctor');
CREATE TYPE vital_type AS ENUM (
    'blood_pressure_systolic',
    'blood_pressure_diastolic',
    'glucose',
    'temperature',
    'weight',
    'pulse',
    'spo2'
);
CREATE TYPE alert_type AS ENUM ('threshold_breach', 'reminder_lapse', 'system');
CREATE TYPE sync_status AS ENUM ('pending', 'synced', 'failed');

-- ============================================================
-- USERS TABLE
-- ============================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cognito_sub VARCHAR(128) NOT NULL UNIQUE,
    email VARCHAR(256) NOT NULL,
    name VARCHAR(256) NOT NULL,
    phone_number VARCHAR(20),
    persona_type persona_type NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE INDEX idx_users_cognito_sub ON users(cognito_sub);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_persona_type ON users(persona_type);

COMMENT ON TABLE users IS 'CareLog users linked to Cognito identities';
COMMENT ON COLUMN users.cognito_sub IS 'Cognito user pool subject identifier';

-- ============================================================
-- PATIENTS TABLE (Extended patient information)
-- ============================================================

CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    patient_id VARCHAR(20) NOT NULL UNIQUE, -- Human-readable patient ID
    date_of_birth DATE,
    gender VARCHAR(20),
    blood_type VARCHAR(5),
    medical_conditions TEXT[], -- Array of conditions
    allergies TEXT[],
    medications TEXT[],
    emergency_contact_name VARCHAR(256),
    emergency_contact_phone VARCHAR(20),
    fhir_patient_id VARCHAR(64), -- Reference to FHIR Patient resource
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT patients_user_id_unique UNIQUE (user_id)
);

CREATE INDEX idx_patients_patient_id ON patients(patient_id);
CREATE INDEX idx_patients_fhir_id ON patients(fhir_patient_id);

COMMENT ON TABLE patients IS 'Extended patient information beyond Cognito profile';
COMMENT ON COLUMN patients.patient_id IS 'Human-readable unique patient identifier';

-- ============================================================
-- PERSONA LINKS TABLE
-- ============================================================

CREATE TABLE persona_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    linked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    relationship persona_type NOT NULL,
    is_primary BOOLEAN DEFAULT false, -- Primary caregiver flag
    can_log_vitals BOOLEAN DEFAULT false,
    can_configure_thresholds BOOLEAN DEFAULT false,
    can_view_history BOOLEAN DEFAULT true,
    can_receive_alerts BOOLEAN DEFAULT false,
    invited_by UUID REFERENCES users(id),
    invited_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT persona_links_unique UNIQUE (patient_id, linked_user_id)
);

CREATE INDEX idx_persona_links_patient ON persona_links(patient_id);
CREATE INDEX idx_persona_links_user ON persona_links(linked_user_id);
CREATE INDEX idx_persona_links_relationship ON persona_links(relationship);

COMMENT ON TABLE persona_links IS 'Links between patients and their caregivers/doctors';
COMMENT ON COLUMN persona_links.relationship IS 'Type of relationship: attendant, relative, or doctor';

-- ============================================================
-- THRESHOLDS TABLE
-- ============================================================

CREATE TABLE thresholds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    vital_type vital_type NOT NULL,
    min_value DECIMAL(10, 2),
    max_value DECIMAL(10, 2),
    unit VARCHAR(20) NOT NULL,
    set_by_user_id UUID NOT NULL REFERENCES users(id),
    set_by_persona persona_type NOT NULL, -- 'relative' or 'doctor'
    is_doctor_override BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    effective_from TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    effective_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT thresholds_unique_active UNIQUE (patient_id, vital_type, is_active)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_thresholds_patient ON thresholds(patient_id);
CREATE INDEX idx_thresholds_vital_type ON thresholds(vital_type);
CREATE INDEX idx_thresholds_active ON thresholds(patient_id, is_active) WHERE is_active = true;

COMMENT ON TABLE thresholds IS 'Vital thresholds for patient monitoring';
COMMENT ON COLUMN thresholds.is_doctor_override IS 'True if this threshold was set by a doctor and overrides relative settings';

-- ============================================================
-- REMINDER CONFIGS TABLE
-- ============================================================

CREATE TABLE reminder_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    vital_type vital_type NOT NULL,
    window_hours INTEGER NOT NULL, -- Log must happen within this window
    grace_period_minutes INTEGER DEFAULT 30, -- Additional time before alerting relative
    is_enabled BOOLEAN DEFAULT true,
    last_reminded_at TIMESTAMP WITH TIME ZONE,
    configured_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT reminder_configs_unique UNIQUE (patient_id, vital_type)
);

CREATE INDEX idx_reminder_configs_patient ON reminder_configs(patient_id);
CREATE INDEX idx_reminder_configs_enabled ON reminder_configs(patient_id, is_enabled) WHERE is_enabled = true;

COMMENT ON TABLE reminder_configs IS 'Configuration for vital logging reminders';
COMMENT ON COLUMN reminder_configs.window_hours IS 'Time window in hours within which a vital must be logged';

-- ============================================================
-- CONSENT RECORDS TABLE (DPDP Act Compliance)
-- ============================================================

CREATE TABLE consent_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type VARCHAR(50) NOT NULL, -- 'data_processing', 'data_sharing', etc.
    consent_version VARCHAR(20) NOT NULL, -- Version of consent text shown
    consent_text_hash VARCHAR(64) NOT NULL, -- SHA-256 of consent text
    is_accepted BOOLEAN NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    withdrawn_at TIMESTAMP WITH TIME ZONE,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT consent_records_check CHECK (
        (is_accepted = true AND accepted_at IS NOT NULL) OR
        (is_accepted = false)
    )
);

CREATE INDEX idx_consent_records_user ON consent_records(user_id);
CREATE INDEX idx_consent_records_type ON consent_records(consent_type, consent_version);

COMMENT ON TABLE consent_records IS 'DPDP Act compliant consent tracking';
COMMENT ON COLUMN consent_records.consent_text_hash IS 'SHA-256 hash of the consent text presented to user';

-- ============================================================
-- ALERTS TABLE
-- ============================================================

CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_type alert_type NOT NULL,
    vital_type vital_type,
    vital_value DECIMAL(10, 2),
    vital_unit VARCHAR(20),
    threshold_min DECIMAL(10, 2),
    threshold_max DECIMAL(10, 2),
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP WITH TIME ZONE,
    is_sent BOOLEAN DEFAULT false,
    sent_at TIMESTAMP WITH TIME ZONE,
    send_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_alerts_patient ON alerts(patient_id);
CREATE INDEX idx_alerts_recipient ON alerts(recipient_user_id);
CREATE INDEX idx_alerts_unread ON alerts(recipient_user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_alerts_created ON alerts(created_at DESC);

COMMENT ON TABLE alerts IS 'Alert notifications for threshold breaches and reminder lapses';

-- ============================================================
-- DEVICE TOKENS TABLE (Push Notifications)
-- ============================================================

CREATE TABLE device_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token VARCHAR(512) NOT NULL,
    platform VARCHAR(20) NOT NULL, -- 'ios', 'android'
    device_id VARCHAR(256), -- Device unique identifier
    app_version VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT device_tokens_unique UNIQUE (user_id, device_token)
);

CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);
CREATE INDEX idx_device_tokens_active ON device_tokens(user_id, is_active) WHERE is_active = true;

COMMENT ON TABLE device_tokens IS 'FCM/APNs device tokens for push notifications';

-- ============================================================
-- AUDIT LOG TABLE (HIPAA Compliance)
-- ============================================================

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id), -- Can be NULL for system actions
    user_persona persona_type,
    action VARCHAR(50) NOT NULL, -- 'CREATE', 'READ', 'UPDATE', 'DELETE'
    resource_type VARCHAR(50) NOT NULL, -- 'observation', 'patient', 'threshold', etc.
    resource_id VARCHAR(128), -- ID of the affected resource
    patient_id UUID REFERENCES patients(id), -- Patient context if applicable
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(64), -- API request correlation ID
    details JSONB, -- Additional context (no PHI!)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_patient ON audit_log(patient_id);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log(action);

-- Partition audit log by month for performance
-- Note: Partitioning requires additional setup in production

COMMENT ON TABLE audit_log IS 'HIPAA-compliant audit trail of all data access and modifications';
COMMENT ON COLUMN audit_log.details IS 'Additional context - must NOT contain PHI';

-- ============================================================
-- OBSERVATION SYNC TRACKING TABLE
-- ============================================================

CREATE TABLE observation_sync_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    fhir_observation_id VARCHAR(64) NOT NULL,
    vital_type vital_type NOT NULL,
    logged_by_user_id UUID NOT NULL REFERENCES users(id),
    logged_by_persona persona_type NOT NULL,
    local_timestamp TIMESTAMP WITH TIME ZONE NOT NULL, -- When logged on device
    sync_status sync_status DEFAULT 'pending',
    synced_at TIMESTAMP WITH TIME ZONE,
    sync_error TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_observation_sync_patient ON observation_sync_log(patient_id);
CREATE INDEX idx_observation_sync_fhir ON observation_sync_log(fhir_observation_id);
CREATE INDEX idx_observation_sync_pending ON observation_sync_log(sync_status) WHERE sync_status = 'pending';

COMMENT ON TABLE observation_sync_log IS 'Tracks sync status of FHIR observations';

-- ============================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_patients_updated_at
    BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_persona_links_updated_at
    BEFORE UPDATE ON persona_links
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_thresholds_updated_at
    BEFORE UPDATE ON thresholds
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reminder_configs_updated_at
    BEFORE UPDATE ON reminder_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_device_tokens_updated_at
    BEFORE UPDATE ON device_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_observation_sync_updated_at
    BEFORE UPDATE ON observation_sync_log
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- INITIAL DATA
-- ============================================================

-- Insert default consent versions
-- (These would be managed via application code in production)

COMMENT ON SCHEMA public IS 'CareLog application schema - v1.0.0';

-- V7: Compliance Tables
-- Tables for DPDP consent, data export, and account deletion

-- Consent records table
CREATE TABLE IF NOT EXISTS consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    consent_version VARCHAR(20) NOT NULL,
    consent_text_hash VARCHAR(64) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    accepted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    withdrawn_at TIMESTAMP WITH TIME ZONE,
    withdrawal_reason TEXT
);

CREATE INDEX idx_consent_records_user_id ON consent_records(user_id);
CREATE INDEX idx_consent_records_active ON consent_records(user_id, withdrawn_at) WHERE withdrawn_at IS NULL;

-- Data export requests table
CREATE TABLE IF NOT EXISTS data_export_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id),
    requested_by VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    s3_key VARCHAR(512),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX idx_data_export_patient_id ON data_export_requests(patient_id);
CREATE INDEX idx_data_export_requested_by ON data_export_requests(requested_by);

-- Account deletion requests table
CREATE TABLE IF NOT EXISTS deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    reason TEXT,
    confirmation_code VARCHAR(6),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT valid_deletion_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired'))
);

CREATE INDEX idx_deletion_requests_user_id ON deletion_requests(user_id);
CREATE INDEX idx_deletion_requests_status ON deletion_requests(status);

-- Security events log (for compliance auditing)
CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL,
    user_id VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    success BOOLEAN NOT NULL DEFAULT true,
    failure_reason TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_security_events_user_id ON security_events(user_id);
CREATE INDEX idx_security_events_type ON security_events(event_type);
CREATE INDEX idx_security_events_created ON security_events(created_at DESC);

-- Add email to users table if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'email'
    ) THEN
        ALTER TABLE users ADD COLUMN email VARCHAR(255);
    END IF;
END $$;

-- Comments
COMMENT ON TABLE consent_records IS 'DPDP consent acceptance records with cryptographic verification';
COMMENT ON TABLE data_export_requests IS 'User data portability requests per DPDP';
COMMENT ON TABLE deletion_requests IS 'Account deletion requests per DPDP right to erasure';
COMMENT ON TABLE security_events IS 'Security audit trail for compliance reporting';

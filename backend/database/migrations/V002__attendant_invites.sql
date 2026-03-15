-- V002: Add attendant_invites table for managing caregiver invitations
-- This table stores pending invites sent by relatives to attendants

CREATE TABLE IF NOT EXISTS attendant_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    invite_token VARCHAR(64) UNIQUE NOT NULL,
    attendant_name VARCHAR(100) NOT NULL,
    attendant_email VARCHAR(255),
    attendant_phone VARCHAR(20),
    invited_by VARCHAR(255) NOT NULL,  -- Cognito sub of inviter
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    accepted_by_user_id UUID REFERENCES users(id),
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient queries
CREATE INDEX idx_attendant_invites_patient ON attendant_invites(patient_id);
CREATE INDEX idx_attendant_invites_token ON attendant_invites(invite_token);
CREATE INDEX idx_attendant_invites_status ON attendant_invites(status);
CREATE INDEX idx_attendant_invites_expires ON attendant_invites(expires_at) WHERE status = 'pending';

-- Trigger to update updated_at
CREATE TRIGGER update_attendant_invites_updated_at
    BEFORE UPDATE ON attendant_invites
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add similar table for doctor invites
CREATE TABLE IF NOT EXISTS doctor_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    invite_token VARCHAR(64) UNIQUE NOT NULL,
    doctor_name VARCHAR(100) NOT NULL,
    doctor_email VARCHAR(255) NOT NULL,
    specialty VARCHAR(100),
    invited_by VARCHAR(255) NOT NULL,  -- Cognito sub of inviter
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    accepted_by_user_id UUID REFERENCES users(id),
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for doctor invites
CREATE INDEX idx_doctor_invites_patient ON doctor_invites(patient_id);
CREATE INDEX idx_doctor_invites_token ON doctor_invites(invite_token);
CREATE INDEX idx_doctor_invites_status ON doctor_invites(status);

-- Trigger to update updated_at
CREATE TRIGGER update_doctor_invites_updated_at
    BEFORE UPDATE ON doctor_invites
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

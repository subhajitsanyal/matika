-- V6: Doctor Portal Tables
-- Tables for care plans, observation notes, and enhanced documents

-- Care Plans table with version history
CREATE TABLE IF NOT EXISTS care_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    updated_by UUID NOT NULL,
    updated_by_name VARCHAR(255) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    is_current BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_care_plans_patient_id ON care_plans(patient_id);
CREATE INDEX idx_care_plans_current ON care_plans(patient_id, is_current) WHERE is_current = true;

-- Observation notes (doctor annotations)
CREATE TABLE IF NOT EXISTS observation_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    observation_id UUID NOT NULL,
    note TEXT NOT NULL,
    author_id UUID NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_observation_notes_observation_id ON observation_notes(observation_id);
CREATE INDEX idx_observation_notes_author_id ON observation_notes(author_id);

-- Documents table (enhanced for doctor portal)
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    file_type VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    s3_key VARCHAR(512) NOT NULL,
    file_size BIGINT,
    uploaded_by UUID NOT NULL,
    uploaded_by_name VARCHAR(255),
    uploaded_by_role VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_documents_patient_id ON documents(patient_id);
CREATE INDEX idx_documents_file_type ON documents(patient_id, file_type);
CREATE INDEX idx_documents_created_at ON documents(patient_id, created_at DESC);

-- Patients table (if not exists, enhanced fields)
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    age INTEGER,
    gender VARCHAR(20),
    conditions TEXT[] DEFAULT '{}',
    cognito_sub VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure observations table has patient_id index
CREATE INDEX IF NOT EXISTS idx_observations_patient_created
ON observations(patient_id, created_at DESC);

-- Add trigger to update updated_at on care_plans
CREATE OR REPLACE FUNCTION update_care_plan_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS care_plans_updated_at ON care_plans;
CREATE TRIGGER care_plans_updated_at
    BEFORE UPDATE ON care_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_care_plan_updated_at();

-- Comments
COMMENT ON TABLE care_plans IS 'Doctor-created care plans with version history';
COMMENT ON TABLE observation_notes IS 'Clinical annotations on observations by doctors';
COMMENT ON TABLE documents IS 'Patient documents (prescriptions, photos, etc.)';

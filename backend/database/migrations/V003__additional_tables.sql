-- V003: Add tables required by scaffolded Lambda functions
-- care_plans, documents, data_export_requests, deletion_requests, observation_notes

-- ============================================================
-- CARE PLANS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS care_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    title VARCHAR(256) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'revoked', 'draft')),
    created_by UUID NOT NULL REFERENCES users(id),
    created_by_persona persona_type NOT NULL,
    effective_from TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    effective_until TIMESTAMP WITH TIME ZONE,
    fhir_care_plan_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_care_plans_patient ON care_plans(patient_id);
CREATE INDEX idx_care_plans_status ON care_plans(patient_id, status) WHERE status = 'active';

CREATE TRIGGER update_care_plans_updated_at
    BEFORE UPDATE ON care_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE care_plans IS 'FHIR CarePlan records managed by doctors';

-- ============================================================
-- DOCUMENTS TABLE (metadata for S3 uploads)
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    uploaded_by_persona persona_type NOT NULL,
    file_type VARCHAR(50) NOT NULL, -- 'prescription', 'lab_result', 'medical_photo', 'voice_note', 'video_note'
    file_name VARCHAR(512) NOT NULL,
    s3_key VARCHAR(1024) NOT NULL,
    s3_bucket VARCHAR(256) NOT NULL,
    content_type VARCHAR(128),
    file_size_bytes BIGINT,
    description TEXT,
    fhir_document_reference_id VARCHAR(64),
    is_processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_documents_patient ON documents(patient_id);
CREATE INDEX idx_documents_type ON documents(patient_id, file_type);
CREATE INDEX idx_documents_s3_key ON documents(s3_key);

CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE documents IS 'Metadata for unstructured files stored in S3';

-- ============================================================
-- DATA EXPORT REQUESTS TABLE (DPDP Act compliance)
-- ============================================================

CREATE TABLE IF NOT EXISTS data_export_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requested_by UUID NOT NULL REFERENCES users(id),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired')),
    export_format VARCHAR(20) NOT NULL DEFAULT 'fhir_bundle', -- 'fhir_bundle', 'pdf', 'csv'
    s3_key VARCHAR(1024), -- Location of completed export
    s3_bucket VARCHAR(256),
    error_message TEXT,
    expires_at TIMESTAMP WITH TIME ZONE, -- Download link expiry
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_data_export_requests_patient ON data_export_requests(patient_id);
CREATE INDEX idx_data_export_requests_status ON data_export_requests(status) WHERE status IN ('pending', 'processing');

CREATE TRIGGER update_data_export_requests_updated_at
    BEFORE UPDATE ON data_export_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE data_export_requests IS 'DPDP Act data portability — tracks export requests';

-- ============================================================
-- DELETION REQUESTS TABLE (DPDP Act compliance)
-- ============================================================

CREATE TABLE IF NOT EXISTS deletion_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requested_by UUID NOT NULL REFERENCES users(id),
    patient_id UUID REFERENCES patients(id),
    user_id UUID REFERENCES users(id),
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    resources_deleted JSONB, -- Summary of what was deleted
    error_message TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_deletion_requests_status ON deletion_requests(status) WHERE status IN ('pending', 'processing');

CREATE TRIGGER update_deletion_requests_updated_at
    BEFORE UPDATE ON deletion_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE deletion_requests IS 'DPDP Act right to erasure — tracks deletion requests';

-- ============================================================
-- OBSERVATION NOTES TABLE (doctor annotations)
-- ============================================================

CREATE TABLE IF NOT EXISTS observation_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    observation_id VARCHAR(128) NOT NULL, -- FHIR Observation ID (S3 key reference)
    note_text TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_by_persona persona_type NOT NULL,
    is_clinical BOOLEAN DEFAULT false, -- True if created by a doctor
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_observation_notes_patient ON observation_notes(patient_id);
CREATE INDEX idx_observation_notes_observation ON observation_notes(observation_id);

CREATE TRIGGER update_observation_notes_updated_at
    BEFORE UPDATE ON observation_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE observation_notes IS 'Doctor and caregiver annotations on FHIR Observations';

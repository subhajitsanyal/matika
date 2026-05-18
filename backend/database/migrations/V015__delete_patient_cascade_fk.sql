-- V015: ON DELETE CASCADE for deletion_requests.patient_id
--
-- Stream B / CG-V2-16 hardening (2026-05-17).
-- V003:100 declared deletion_requests.patient_id without an ON DELETE clause,
-- which leaves the FK as RESTRICT (default). A delete-patient call against a
-- patient that has ANY row in deletion_requests would fail with a FK violation.
-- In practice deletion_requests is part of the dormant account-deletion self-
-- service flow and is rarely populated, but the latent foot-gun must be closed
-- before beta.
--
-- Note: audit_log.patient_id (V001:267) is intentionally NOT touched here.
-- The current lambda code path writes audit_log rows with patient_id=NULL
-- (resource_id carries the short code instead), so the RESTRICT FK never
-- fires. Preserving RESTRICT keeps the contract honest: any future code path
-- that does populate audit_log.patient_id will see the conflict at delete
-- time and have to make an explicit decision about audit retention.
--
-- ROLLBACK (manual; Flyway does not auto-rollback):
--   ALTER TABLE deletion_requests DROP CONSTRAINT deletion_requests_patient_id_fkey;
--   ALTER TABLE deletion_requests ADD CONSTRAINT deletion_requests_patient_id_fkey
--     FOREIGN KEY (patient_id) REFERENCES patients(id);

ALTER TABLE deletion_requests
    DROP CONSTRAINT IF EXISTS deletion_requests_patient_id_fkey;

ALTER TABLE deletion_requests
    ADD CONSTRAINT deletion_requests_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

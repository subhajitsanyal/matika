-- V014 — SES bounce/complaint suppression list.
--
-- See docs/v2_launch_plan.md §8.5 (SES production-access prerequisites)
-- and the AWS Support production-access ticket (deferred 2026-05-14).
-- AWS Support typically lifts the last reviewer objection when bounce
-- and complaint handling is wired and the ticket can cite a live
-- configuration-set ARN.
--
-- Population path:
--   SES event destination (Bounce, Complaint) → SNS topic →
--   ses-suppression-handler lambda → INSERT INTO email_suppression.
--
-- Read path:
--   Every email-sending lambda SHOULD consult this table before
--   sending. Current scope (task #23) wires the population path; the
--   pre-send check is a follow-up — until then the SES configuration
--   set's own suppression list and the bounce/complaint rate metrics
--   are the front-line defense (per AWS's recommended pattern for
--   account-level reputation protection).
--
-- Grain: per email address. Latest classification wins (ON CONFLICT
-- DO UPDATE keeps the most-recent reason + timestamp).

CREATE TABLE email_suppression (
    email           VARCHAR(254) PRIMARY KEY,
    -- Bounce | Complaint (mirrors the SES eventType verbatim, so future
    -- event-types — e.g. Reject, RenderingFailure — slot in without
    -- a schema change).
    reason          TEXT NOT NULL,
    -- Free-text subtype the SES message carries (bounceType + bounceSubType
    -- for bounces; complaintFeedbackType for complaints). Stored as JSON
    -- so we can preserve the full structure without column proliferation.
    details         JSONB,
    classified_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- SES SNS message id — useful for de-duplicating retries and for
    -- correlating with CloudWatch traces.
    sns_message_id  VARCHAR(128)
);

CREATE INDEX idx_email_suppression_classified_at ON email_suppression(classified_at DESC);

-- F17 — push transport.
--
-- The device-token Lambda registers an SNS Platform Endpoint per device on
-- POST /device-tokens (CreatePlatformEndpoint with the FCM/APNs token), and
-- needs to persist the resulting endpoint ARN so notification-sender can
-- read it later instead of calling CreatePlatformEndpoint per message.
-- Until this column existed, the lambda's UPSERT failed at runtime with
-- "column endpoint_arn does not exist", so device_tokens stayed empty
-- and no push could land.
--
-- VARCHAR(256) is the documented upper bound on SNS endpoint ARN length
-- (account-id (12) + region (~12) + platform-app-name + endpoint-uuid is
-- well under 256). NULLable because legacy rows pre-dating F17 won't have
-- one; the lambda treats NULL as "needs CreatePlatformEndpoint on next push"
-- so old rows are still serviceable.

ALTER TABLE device_tokens ADD COLUMN endpoint_arn VARCHAR(256);

-- Lookup index for notification-sender's per-recipient device-tokens query.
-- Filtered partial index: only rows with a valid endpoint_arn matter for
-- delivery, and is_active=true is the read pattern (legacy / unregistered
-- devices are skipped).
CREATE INDEX idx_device_tokens_active_with_endpoint
    ON device_tokens(user_id)
    WHERE endpoint_arn IS NOT NULL AND is_active = true;

COMMENT ON COLUMN device_tokens.endpoint_arn IS
    'SNS Platform Endpoint ARN for this device. NULL until the device-token Lambda persists one on first POST /device-tokens.';

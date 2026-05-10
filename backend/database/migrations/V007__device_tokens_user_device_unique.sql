-- F17 follow-up to V006.
--
-- The device-token Lambda's UPSERT uses `ON CONFLICT (device_id, user_id)`
-- to coalesce token rotations on the same (user, device) pair into a single
-- row. The V001 schema only has UNIQUE(user_id, device_token) — different
-- semantic (one row per FCM token, no consolidation on rotation).
--
-- Without this constraint the Lambda's INSERT raises:
--   "no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Safe to add today: device_tokens has zero rows in dev (per F17's surfacing
-- audit; no Android client has ever hit POST /device-tokens). If the table
-- has rows by the time this is applied to higher envs, run the conflict
-- resolution upfront:
--
--   DELETE FROM device_tokens d1
--   USING device_tokens d2
--   WHERE d1.user_id = d2.user_id
--     AND d1.device_id = d2.device_id
--     AND d1.created_at < d2.created_at;
--
-- (keeps the most-recently-created row per pair, drops earlier duplicates.)

ALTER TABLE device_tokens
    ADD CONSTRAINT device_tokens_user_device_unique
    UNIQUE (user_id, device_id);

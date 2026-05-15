/**
 * carelog-<env>-patient-engagement-rollup Lambda
 *
 * Phase 2 telemetry rollup #4 (§4.7). Runs hourly via EventBridge,
 * recomputes `patient_engagement_daily` for the last 2 days
 * (yesterday + today in patient timezone). Materializes ONE row per
 * patient per day even if zero activity — that's the load-bearing
 * invariant for trivial drop-off queries:
 *   SELECT patient_id FROM patient_engagement_daily
 *   WHERE day = CURRENT_DATE AND days_since_last_activity > 7;
 *
 * Read sources:
 *   - patients (the universe of rows to enumerate)
 *   - interaction_sessions (session_count)
 *   - observation_sync_log (observation_count)
 *   - alerts (alert_acked_count = is_read=true rows whose recipient is
 *     a caregiver/attendant linked to this patient)
 *
 * last_activity_at is the MAX timestamp across ALL of the patient's
 * historical activity (not scoped to `day`) — denormalized so the
 * drop-off query doesn't need a window function.
 */

const { Client } = require("pg");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const secretsClient = new SecretsManagerClient({});
let dbCredentials = null;

async function getDatabaseCredentials() {
  if (dbCredentials) return dbCredentials;
  const command = new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_NAME });
  const response = await secretsClient.send(command);
  dbCredentials = JSON.parse(response.SecretString);
  return dbCredentials;
}

async function createDbConnection() {
  const credentials = await getDatabaseCredentials();
  const client = new Client({
    host: credentials.host,
    port: credentials.port,
    database: credentials.dbname,
    user: credentials.username,
    password: credentials.password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  return client;
}

const ROLLUP_SQL = `
WITH
patient_tz AS (
  SELECT DISTINCT ON (pc.patient_id)
    pc.patient_id,
    pc.timezone
  FROM parameter_configs pc
  WHERE pc.active = TRUE
  ORDER BY pc.patient_id, pc.frequency_days DESC
),

-- Universe: every patient, with their tz. Two day cells per patient
-- (today + yesterday) — zero-activity rows still get materialized.
day_cells AS (
  SELECT
    p.id AS patient_id,
    COALESCE(pt.timezone, 'Asia/Kolkata') AS tz,
    d.day
  FROM patients p
  LEFT JOIN patient_tz pt ON pt.patient_id = p.id
  CROSS JOIN LATERAL (VALUES
    ((NOW() AT TIME ZONE COALESCE(pt.timezone, 'Asia/Kolkata'))::date),
    (((NOW() AT TIME ZONE COALESCE(pt.timezone, 'Asia/Kolkata')) - INTERVAL '1 day')::date)
  ) AS d(day)
),

-- Per-day session counts (interaction_sessions.started_at in patient tz)
session_counts AS (
  SELECT
    dc.patient_id,
    dc.day,
    COUNT(s.id)::int AS session_count
  FROM day_cells dc
  LEFT JOIN interaction_sessions s
    ON s.patient_id = dc.patient_id
    AND (s.started_at AT TIME ZONE dc.tz)::date = dc.day
  GROUP BY dc.patient_id, dc.day
),

-- Per-day observation counts (observation_sync_log.local_timestamp)
observation_counts AS (
  SELECT
    dc.patient_id,
    dc.day,
    COUNT(osl.id)::int AS observation_count
  FROM day_cells dc
  LEFT JOIN observation_sync_log osl
    ON osl.patient_id = dc.patient_id
    AND (osl.local_timestamp AT TIME ZONE dc.tz)::date = dc.day
  GROUP BY dc.patient_id, dc.day
),

-- Per-day alert-ack counts (alerts.read_at, scoped to alerts whose
-- patient_id matches — read_at is when caregiver acked).
alert_ack_counts AS (
  SELECT
    dc.patient_id,
    dc.day,
    COUNT(a.id)::int AS alert_acked_count
  FROM day_cells dc
  LEFT JOIN alerts a
    ON a.patient_id = dc.patient_id
    AND a.is_read = TRUE
    AND (a.read_at AT TIME ZONE dc.tz)::date = dc.day
  GROUP BY dc.patient_id, dc.day
),

-- Per-patient overall last-activity timestamp (UTC; recorded on
-- every row to make drop-off-from-day-X queries cheap).
last_activity AS (
  SELECT
    p.id AS patient_id,
    GREATEST(
      (SELECT MAX(s.started_at) FROM interaction_sessions s WHERE s.patient_id = p.id),
      (SELECT MAX(osl.local_timestamp) FROM observation_sync_log osl WHERE osl.patient_id = p.id),
      (SELECT MAX(a.read_at) FROM alerts a WHERE a.patient_id = p.id AND a.is_read = TRUE)
    ) AS last_activity_at
  FROM patients p
)

INSERT INTO patient_engagement_daily (
  patient_id, day,
  session_count, observation_count, alert_acked_count,
  any_activity, last_activity_at, days_since_last_activity,
  computed_at
)
SELECT
  dc.patient_id,
  dc.day,
  COALESCE(sc.session_count, 0),
  COALESCE(oc.observation_count, 0),
  COALESCE(ac.alert_acked_count, 0),
  (COALESCE(sc.session_count, 0) + COALESCE(oc.observation_count, 0) + COALESCE(ac.alert_acked_count, 0)) > 0,
  la.last_activity_at,
  -- 0 if anything happened today; otherwise (day - last_activity_at::date) days.
  -- COALESCE the inner expression so a never-active patient gets a large default
  -- (9999) rather than NULL; downstream drop-off queries treat that as "never engaged".
  GREATEST(
    0,
    COALESCE((dc.day - (la.last_activity_at AT TIME ZONE dc.tz)::date)::int, 9999)
  ) AS days_since_last_activity,
  NOW()
FROM day_cells dc
LEFT JOIN session_counts     sc ON sc.patient_id = dc.patient_id AND sc.day = dc.day
LEFT JOIN observation_counts oc ON oc.patient_id = dc.patient_id AND oc.day = dc.day
LEFT JOIN alert_ack_counts   ac ON ac.patient_id = dc.patient_id AND ac.day = dc.day
LEFT JOIN last_activity      la ON la.patient_id = dc.patient_id
ON CONFLICT (patient_id, day) DO UPDATE SET
  session_count            = EXCLUDED.session_count,
  observation_count        = EXCLUDED.observation_count,
  alert_acked_count        = EXCLUDED.alert_acked_count,
  any_activity             = EXCLUDED.any_activity,
  last_activity_at         = EXCLUDED.last_activity_at,
  days_since_last_activity = EXCLUDED.days_since_last_activity,
  computed_at              = EXCLUDED.computed_at
RETURNING patient_id, day;
`;

exports.handler = async () => {
  let client;
  try {
    client = await createDbConnection();
    const result = await client.query(ROLLUP_SQL);
    const rowsUpserted = result.rowCount;
    let daysWindowStart = null;
    let daysWindowEnd = null;
    if (rowsUpserted > 0) {
      const days = result.rows
        .map((r) => r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10))
        .sort();
      daysWindowStart = days[0];
      daysWindowEnd = days[days.length - 1];
    }
    console.log(JSON.stringify({
      msg: "patient_engagement_daily rollup complete",
      rowsUpserted, daysWindowStart, daysWindowEnd,
    }));
    return { rowsUpserted, daysWindowStart, daysWindowEnd };
  } catch (err) {
    console.error(JSON.stringify({
      msg: "patient_engagement_daily rollup failed",
      error: err.message, stack: err.stack,
    }));
    throw err;
  } finally {
    if (client) await client.end();
  }
};

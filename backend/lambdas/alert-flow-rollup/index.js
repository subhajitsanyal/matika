/**
 * carelog-<env>-alert-flow-rollup Lambda
 *
 * Phase 2 telemetry rollup #3 (§4.7). Runs hourly via EventBridge,
 * recomputes `alert_flow_daily` for the last 2 days (yesterday + today
 * in patient timezone — alerts are user-facing so day boundaries follow
 * the patient's clock).
 *
 * Read source: alerts (filtered by patient_id + day window).
 *
 * Per-patient timezone is sourced from the patient's primary
 * parameter_config; defaults to 'Asia/Kolkata' when no config exists
 * (matches v2.0 single-region assumption).
 *
 * Write sink: alert_flow_daily, INSERT … ON CONFLICT DO UPDATE.
 *
 * Time-to-read percentiles use PERCENTILE_DISC over (read_at -
 * created_at) in seconds. NULL when no rows in that bucket were read.
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
-- Resolve each patient's primary tz (from any active parameter_config).
patient_tz AS (
  SELECT DISTINCT ON (pc.patient_id)
    pc.patient_id,
    pc.timezone
  FROM parameter_configs pc
  WHERE pc.active = TRUE
  ORDER BY pc.patient_id, pc.frequency_days DESC
),
-- Day window: yesterday + today in each patient's tz.
target_days AS (
  SELECT
    p.id AS patient_id,
    COALESCE(pt.timezone, 'Asia/Kolkata') AS tz,
    (NOW() AT TIME ZONE COALESCE(pt.timezone, 'Asia/Kolkata'))::date AS today,
    ((NOW() AT TIME ZONE COALESCE(pt.timezone, 'Asia/Kolkata')) - INTERVAL '1 day')::date AS yesterday
  FROM patients p
  LEFT JOIN patient_tz pt ON pt.patient_id = p.id
),
day_cells AS (
  SELECT patient_id, tz, today AS day FROM target_days
  UNION ALL
  SELECT patient_id, tz, yesterday AS day FROM target_days
),

-- Aggregate alerts per (patient, day-in-tz, alert_type).
alert_aggregates AS (
  SELECT
    dc.patient_id,
    dc.day,
    a.alert_type,
    COUNT(*)::int                                       AS raised_count,
    SUM((a.is_sent = TRUE)::int)::int                   AS sent_count,
    SUM((a.is_read = TRUE)::int)::int                   AS read_count,
    SUM((a.send_error IS NOT NULL)::int)::int           AS send_failure_count,
    PERCENTILE_DISC(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (a.read_at - a.created_at)))
      FILTER (WHERE a.is_read = TRUE AND a.read_at IS NOT NULL)::int AS median_time_to_read_seconds,
    PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (a.read_at - a.created_at)))
      FILTER (WHERE a.is_read = TRUE AND a.read_at IS NOT NULL)::int AS p95_time_to_read_seconds
  FROM day_cells dc
  JOIN alerts a
    ON a.patient_id = dc.patient_id
    AND (a.created_at AT TIME ZONE dc.tz)::date = dc.day
  GROUP BY dc.patient_id, dc.day, a.alert_type
)

INSERT INTO alert_flow_daily (
  patient_id, day, alert_type,
  raised_count, sent_count, read_count, send_failure_count,
  median_time_to_read_seconds, p95_time_to_read_seconds,
  computed_at
)
SELECT
  patient_id, day, alert_type,
  raised_count, sent_count, read_count, send_failure_count,
  median_time_to_read_seconds, p95_time_to_read_seconds,
  NOW()
FROM alert_aggregates
ON CONFLICT (patient_id, day, alert_type) DO UPDATE SET
  raised_count                = EXCLUDED.raised_count,
  sent_count                  = EXCLUDED.sent_count,
  read_count                  = EXCLUDED.read_count,
  send_failure_count          = EXCLUDED.send_failure_count,
  median_time_to_read_seconds = EXCLUDED.median_time_to_read_seconds,
  p95_time_to_read_seconds    = EXCLUDED.p95_time_to_read_seconds,
  computed_at                 = EXCLUDED.computed_at
RETURNING patient_id, day, alert_type;
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
      msg: "alert_flow_daily rollup complete",
      rowsUpserted, daysWindowStart, daysWindowEnd,
    }));
    return { rowsUpserted, daysWindowStart, daysWindowEnd };
  } catch (err) {
    console.error(JSON.stringify({
      msg: "alert_flow_daily rollup failed",
      error: err.message, stack: err.stack,
    }));
    throw err;
  } finally {
    if (client) await client.end();
  }
};

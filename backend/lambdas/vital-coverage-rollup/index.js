/**
 * carelog-<env>-vital-coverage-rollup Lambda
 *
 * Phase 2 telemetry rollup. Runs hourly via EventBridge, recomputes
 * `vital_coverage_daily` for the last 2 days (yesterday + today in
 * each patient's local timezone) for every active parameter_config.
 *
 * Read sources:
 *   - parameter_configs (active=true) joined to patients to pull tz
 *   - observation_sync_log filtered by (patient_id, vital_type, day)
 *   - vital_coverage_daily for the trailing 7/30/90-day rolling pcts
 *
 * Write sink:
 *   - vital_coverage_daily, INSERT ... ON CONFLICT DO UPDATE
 *
 * Why hourly (not daily):
 *   - Yesterday's actual_count can change retroactively if observations
 *     sync late (e.g. patient was offline yesterday, syncs at noon
 *     today). The hourly cadence catches these without waiting until
 *     tomorrow.
 *   - Today's row updates as the day progresses, so dashboards always
 *     show the latest expected-vs-actual ratio.
 *
 * Idempotent: re-running the same hour produces the same row content
 * (modulo `computed_at` timestamp).
 *
 * Returns a small JSON object for CloudWatch / EventBridge logging:
 *   { paramConfigsScanned, rowsUpserted, daysWindowStart, daysWindowEnd }
 *
 * See docs/v2_launch_plan.md §4.7 for the rollup-class contract.
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
  const secretName = process.env.DB_SECRET_NAME;
  const command = new GetSecretValueCommand({ SecretId: secretName });
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

/**
 * The whole rollup is one SQL statement: a CTE that enumerates the
 * (patient, parameter, day) cells we want, joins each to the count
 * of observations, looks up the rolling sums via a window function,
 * and upserts. Doing it inside a single statement keeps the lambda
 * fast and crash-safe (PG handles the locking).
 *
 * Window: today and yesterday in each patient's tz, computed from the
 * patient's primary parameter_config.timezone. (parameter_configs
 * carry their own tz column, so each row uses its config's tz —
 * works correctly even if a patient's BP and glucose configs have
 * different tzs, which shouldn't happen but isn't excluded by
 * schema.)
 */
const ROLLUP_SQL = `
WITH
-- 1. Day cells: yesterday + today in each parameter_config's tz.
day_cells AS (
  SELECT
    pc.patient_id,
    pc.parameter_name,
    pc.frequency_days,
    (NOW() AT TIME ZONE pc.timezone)::date     AS today,
    ((NOW() AT TIME ZONE pc.timezone)::date - INTERVAL '1 day')::date AS yesterday
  FROM parameter_configs pc
  WHERE pc.active = TRUE
),
target_days AS (
  SELECT patient_id, parameter_name, frequency_days, today AS day FROM day_cells
  UNION ALL
  SELECT patient_id, parameter_name, frequency_days, yesterday AS day FROM day_cells
),

-- 2. Actual counts for each (patient, parameter, day) cell from
--    observation_sync_log. We count any synced or pending observation,
--    rejected ones (sync_status='failed') still represent a logged
--    measurement so they count too — the sync state is a transport
--    issue, not a measurement issue.
actual AS (
  SELECT
    td.patient_id,
    td.parameter_name,
    td.day,
    td.frequency_days,
    COUNT(osl.id) AS actual_count
  FROM target_days td
  LEFT JOIN observation_sync_log osl
    ON osl.patient_id = td.patient_id
    AND osl.vital_type::text = td.parameter_name
    AND (osl.local_timestamp AT TIME ZONE 'UTC')::date = td.day
  GROUP BY td.patient_id, td.parameter_name, td.day, td.frequency_days
),

-- 3. Pull existing rows for the trailing 89-day window so we can
--    compute rolling 7/30/90-day pcts. Use the existing
--    vital_coverage_daily rows for prior days (cheaper than
--    re-querying observation_sync_log for each window).
prior_rows AS (
  SELECT
    a.patient_id,
    a.parameter_name,
    a.day                                      AS target_day,
    vcd.day                                    AS prior_day,
    vcd.actual_count                           AS prior_actual,
    vcd.expected_per_day                       AS prior_expected
  FROM actual a
  LEFT JOIN vital_coverage_daily vcd
    ON vcd.patient_id = a.patient_id
    AND vcd.parameter_name = a.parameter_name
    AND vcd.day BETWEEN (a.day - INTERVAL '89 days') AND (a.day - INTERVAL '1 day')
),

-- 4. Aggregate prior rows into rolling sums. We add today's row
--    in-line so the rolling pcts include the day we're upserting.
rolling AS (
  SELECT
    a.patient_id,
    a.parameter_name,
    a.day,
    a.actual_count,
    (1.0 / a.frequency_days)::numeric(6,3) AS expected_per_day,
    -- Rolling 7d (today + prior 6 days)
    (a.actual_count + COALESCE(SUM(pr.prior_actual)
      FILTER (WHERE pr.prior_day BETWEEN (a.day - INTERVAL '6 days') AND a.day - INTERVAL '1 day'), 0))
      AS sum_actual_7d,
    ((1.0 / a.frequency_days) + COALESCE(SUM(pr.prior_expected)
      FILTER (WHERE pr.prior_day BETWEEN (a.day - INTERVAL '6 days') AND a.day - INTERVAL '1 day'), 0))
      AS sum_expected_7d,
    (a.actual_count + COALESCE(SUM(pr.prior_actual)
      FILTER (WHERE pr.prior_day BETWEEN (a.day - INTERVAL '29 days') AND a.day - INTERVAL '1 day'), 0))
      AS sum_actual_30d,
    ((1.0 / a.frequency_days) + COALESCE(SUM(pr.prior_expected)
      FILTER (WHERE pr.prior_day BETWEEN (a.day - INTERVAL '29 days') AND a.day - INTERVAL '1 day'), 0))
      AS sum_expected_30d,
    (a.actual_count + COALESCE(SUM(pr.prior_actual)
      FILTER (WHERE pr.prior_day BETWEEN (a.day - INTERVAL '89 days') AND a.day - INTERVAL '1 day'), 0))
      AS sum_actual_90d,
    ((1.0 / a.frequency_days) + COALESCE(SUM(pr.prior_expected)
      FILTER (WHERE pr.prior_day BETWEEN (a.day - INTERVAL '89 days') AND a.day - INTERVAL '1 day'), 0))
      AS sum_expected_90d
  FROM actual a
  LEFT JOIN prior_rows pr
    ON pr.patient_id = a.patient_id
    AND pr.parameter_name = a.parameter_name
    AND pr.target_day = a.day
  GROUP BY a.patient_id, a.parameter_name, a.day, a.actual_count, a.frequency_days
)

-- 5. Upsert. NULLIF on the divisor protects against div-by-zero
--    (which can't actually happen here because expected_per_day > 0
--    when frequency_days > 0, but defensive).
INSERT INTO vital_coverage_daily (
  patient_id, day, parameter_name,
  actual_count, expected_per_day,
  rolling_7d_pct, rolling_30d_pct, rolling_90d_pct,
  computed_at
)
SELECT
  patient_id, day, parameter_name,
  actual_count, expected_per_day,
  ROUND((sum_actual_7d  / NULLIF(sum_expected_7d, 0))  * 100, 2) AS rolling_7d_pct,
  ROUND((sum_actual_30d / NULLIF(sum_expected_30d, 0)) * 100, 2) AS rolling_30d_pct,
  ROUND((sum_actual_90d / NULLIF(sum_expected_90d, 0)) * 100, 2) AS rolling_90d_pct,
  NOW()
FROM rolling
ON CONFLICT (patient_id, day, parameter_name) DO UPDATE SET
  actual_count     = EXCLUDED.actual_count,
  expected_per_day = EXCLUDED.expected_per_day,
  rolling_7d_pct   = EXCLUDED.rolling_7d_pct,
  rolling_30d_pct  = EXCLUDED.rolling_30d_pct,
  rolling_90d_pct  = EXCLUDED.rolling_90d_pct,
  computed_at      = EXCLUDED.computed_at
RETURNING patient_id, day, parameter_name;
`;

exports.handler = async () => {
  let client;
  try {
    client = await createDbConnection();

    // Count active param configs first so the return-payload shows the
    // intended scan size, not just the upsert count (the two are equal
    // unless something failed mid-rollup).
    const scanCountResult = await client.query(
      "SELECT COUNT(*)::int AS n FROM parameter_configs WHERE active = TRUE"
    );
    const paramConfigsScanned = scanCountResult.rows[0].n;

    if (paramConfigsScanned === 0) {
      console.log(JSON.stringify({
        msg: "no active parameter_configs; nothing to roll up",
        paramConfigsScanned: 0,
        rowsUpserted: 0,
      }));
      return { paramConfigsScanned: 0, rowsUpserted: 0 };
    }

    const result = await client.query(ROLLUP_SQL);
    const rowsUpserted = result.rowCount;

    // Pull window markers from the first returned row for the log
    // line. Days returned are DATEs in patient-tz, formatted YYYY-MM-DD.
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
      msg: "vital_coverage_daily rollup complete",
      paramConfigsScanned,
      rowsUpserted,
      daysWindowStart,
      daysWindowEnd,
    }));

    return { paramConfigsScanned, rowsUpserted, daysWindowStart, daysWindowEnd };
  } catch (err) {
    console.error(JSON.stringify({
      msg: "vital_coverage_daily rollup failed",
      error: err.message,
      stack: err.stack,
    }));
    throw err;
  } finally {
    if (client) await client.end();
  }
};

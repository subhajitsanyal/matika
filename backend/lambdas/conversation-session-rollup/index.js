/**
 * carelog-<env>-conversation-session-rollup Lambda
 *
 * Phase 2 telemetry rollup #2 (§4.7). Runs hourly via EventBridge,
 * recomputes `conversation_session_daily` for the last 2 days
 * (yesterday + today in UTC) for every patient that had any
 * model_call or interaction_session activity in that window.
 *
 * Read sources:
 *   - model_call (tier-scoped metrics)
 *   - interaction_sessions (session-scoped metrics, attributed to
 *     MAX-tier-touched per session)
 *
 * Write sink:
 *   - conversation_session_daily, INSERT … ON CONFLICT DO UPDATE
 *
 * Idempotent: re-running the same hour produces the same row content
 * (modulo `computed_at`).
 *
 * Returns small JSON for CloudWatch / EventBridge logging:
 *   { rowsUpserted, daysWindowStart, daysWindowEnd }
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

/**
 * Single-statement rollup. Two CTE branches feed the final upsert:
 *   - tier_metrics: aggregates from model_call where created_at lands
 *     in the target day (UTC). Tier-scoped.
 *   - session_metrics: enumerates sessions started in the target day,
 *     joins to model_call to find MAX-tier-touched, attributes the
 *     session to that tier's bucket. Session-scoped.
 *
 * The final SELECT FULL OUTER JOIN's the two so a (patient, day, tier)
 * cell appears in the output if EITHER branch produced data — covers
 * the edge case where a session spans midnight UTC (sessions row in
 * day D, model_call rows in day D+1).
 *
 * Window: today + yesterday in UTC. NOT patient-tz: cost rollups are
 * AWS-billing-period scoped (UTC); per-patient day boundaries make
 * total_cost_usd numbers harder to reconcile against AWS Cost Explorer.
 */
const ROLLUP_SQL = `
WITH
target_days AS (
  SELECT (NOW() AT TIME ZONE 'UTC')::date                    AS day UNION ALL
  SELECT ((NOW() AT TIME ZONE 'UTC') - INTERVAL '1 day')::date AS day
),

-- 1. Tier-scoped: aggregate model_call rows directly.
tier_metrics AS (
  SELECT
    mc.patient_id,
    (mc.created_at AT TIME ZONE 'UTC')::date AS day,
    mc.tier,
    COUNT(*)                                      AS model_call_count,
    SUM((mc.guardrail_blocked = TRUE)::int)::int  AS guardrail_block_count,
    SUM((mc.escalation_reason IS NOT NULL)::int)::int AS escalation_count,
    COALESCE(SUM(mc.input_tokens), 0)::bigint     AS total_input_tokens,
    COALESCE(SUM(mc.cached_input_tokens), 0)::bigint AS cached_input_tokens,
    COALESCE(SUM(mc.output_tokens), 0)::bigint    AS total_output_tokens,
    COALESCE(SUM(mc.cost_usd), 0)::numeric(10,4)  AS total_cost_usd,
    PERCENTILE_DISC(0.5)  WITHIN GROUP (ORDER BY mc.latency_ms)::int AS p50_latency_ms,
    PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY mc.latency_ms)::int AS p95_latency_ms
  FROM model_call mc
  WHERE mc.patient_id IS NOT NULL
    AND (mc.created_at AT TIME ZONE 'UTC')::date IN (SELECT day FROM target_days)
  GROUP BY mc.patient_id, (mc.created_at AT TIME ZONE 'UTC')::date, mc.tier
),

-- 2. Session-scoped: classify each session by MAX-tier touched.
--    Tier-rank: T3=4, T3_VISION=3, T2_VISION=2, T2=1, NULL=0
--    (sessions with no model_call rows fall through with rank 0 and
--    are bucketed under 'T2' as a safe default — should be rare).
session_max_tier AS (
  SELECT
    s.id        AS session_id,
    s.patient_id,
    (s.started_at AT TIME ZONE 'UTC')::date AS day,
    s.status,
    COALESCE(s.turn_count, 0) AS turn_count,
    COALESCE(MAX(
      CASE mc.tier
        WHEN 'T3'        THEN 4
        WHEN 'T3_VISION' THEN 3
        WHEN 'T2_VISION' THEN 2
        WHEN 'T2'        THEN 1
        ELSE 0
      END
    ), 0) AS max_tier_rank
  FROM interaction_sessions s
  LEFT JOIN model_call mc ON mc.session_id = s.id
  WHERE s.patient_id IS NOT NULL
    AND (s.started_at AT TIME ZONE 'UTC')::date IN (SELECT day FROM target_days)
  GROUP BY s.id, s.patient_id, (s.started_at AT TIME ZONE 'UTC')::date, s.status, s.turn_count
),
session_metrics AS (
  SELECT
    smt.patient_id,
    smt.day,
    CASE smt.max_tier_rank
      WHEN 4 THEN 'T3'
      WHEN 3 THEN 'T3_VISION'
      WHEN 2 THEN 'T2_VISION'
      ELSE 'T2'
    END AS tier,
    COUNT(*)::int                                              AS session_count,
    SUM((smt.status = 'complete')::int)::int                   AS completed_session_count,
    COALESCE(SUM(smt.turn_count), 0)::int                      AS total_turns
  FROM session_max_tier smt
  GROUP BY smt.patient_id, smt.day,
    CASE smt.max_tier_rank
      WHEN 4 THEN 'T3'
      WHEN 3 THEN 'T3_VISION'
      WHEN 2 THEN 'T2_VISION'
      ELSE 'T2'
    END
),

-- 3. FULL OUTER JOIN so a cell appears if either branch produced data.
combined AS (
  SELECT
    COALESCE(t.patient_id, s.patient_id) AS patient_id,
    COALESCE(t.day,        s.day)        AS day,
    COALESCE(t.tier,       s.tier)       AS tier,
    COALESCE(s.session_count,           0) AS session_count,
    COALESCE(s.completed_session_count, 0) AS completed_session_count,
    COALESCE(s.total_turns,             0) AS total_turns,
    COALESCE(t.model_call_count,        0) AS model_call_count,
    COALESCE(t.guardrail_block_count,   0) AS guardrail_block_count,
    COALESCE(t.escalation_count,        0) AS escalation_count,
    COALESCE(t.total_input_tokens,      0) AS total_input_tokens,
    COALESCE(t.cached_input_tokens,     0) AS cached_input_tokens,
    COALESCE(t.total_output_tokens,     0) AS total_output_tokens,
    COALESCE(t.total_cost_usd,          0) AS total_cost_usd,
    t.p50_latency_ms,
    t.p95_latency_ms
  FROM tier_metrics t
  FULL OUTER JOIN session_metrics s
    ON s.patient_id = t.patient_id AND s.day = t.day AND s.tier = t.tier
)

INSERT INTO conversation_session_daily (
  patient_id, day, tier,
  session_count, completed_session_count, total_turns,
  model_call_count, guardrail_block_count, escalation_count,
  total_input_tokens, cached_input_tokens, total_output_tokens,
  total_cost_usd, p50_latency_ms, p95_latency_ms,
  computed_at
)
SELECT
  patient_id, day, tier,
  session_count, completed_session_count, total_turns,
  model_call_count, guardrail_block_count, escalation_count,
  total_input_tokens, cached_input_tokens, total_output_tokens,
  total_cost_usd, p50_latency_ms, p95_latency_ms,
  NOW()
FROM combined
ON CONFLICT (patient_id, day, tier) DO UPDATE SET
  session_count           = EXCLUDED.session_count,
  completed_session_count = EXCLUDED.completed_session_count,
  total_turns             = EXCLUDED.total_turns,
  model_call_count        = EXCLUDED.model_call_count,
  guardrail_block_count   = EXCLUDED.guardrail_block_count,
  escalation_count        = EXCLUDED.escalation_count,
  total_input_tokens      = EXCLUDED.total_input_tokens,
  cached_input_tokens     = EXCLUDED.cached_input_tokens,
  total_output_tokens     = EXCLUDED.total_output_tokens,
  total_cost_usd          = EXCLUDED.total_cost_usd,
  p50_latency_ms          = EXCLUDED.p50_latency_ms,
  p95_latency_ms          = EXCLUDED.p95_latency_ms,
  computed_at             = EXCLUDED.computed_at
RETURNING patient_id, day, tier;
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
      msg: "conversation_session_daily rollup complete",
      rowsUpserted, daysWindowStart, daysWindowEnd,
    }));
    return { rowsUpserted, daysWindowStart, daysWindowEnd };
  } catch (err) {
    console.error(JSON.stringify({
      msg: "conversation_session_daily rollup failed",
      error: err.message, stack: err.stack,
    }));
    throw err;
  } finally {
    if (client) await client.end();
  }
};

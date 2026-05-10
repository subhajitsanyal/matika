/**
 * CareLog expire-stale-sessions Lambda
 *
 * Runs hourly via EventBridge. Sweeps any interaction_sessions row that
 * has been sitting in status='in_progress' for longer than the
 * configured idle window and flips it to status='terminal_incomplete'
 * with ended_at = NOW().
 *
 * Closes the half of F2 (docs/testing_todos_v2.md) that the
 * LLM-driven terminus path can't catch: app crashes, force-stops,
 * device shutdowns, network-drop mid-turn, and other paths where the
 * client never gets to send a final action and the bedrock-router
 * never sees a `complete_session` / emergency / pause.
 *
 * Status value: 'incomplete' — the V004 schema's CHECK constraint
 * accepts ('in_progress', 'paused', 'complete', 'incomplete'). The
 * F2 doc loosely says "terminal_incomplete" but that label isn't a
 * column value; it's a conceptual category that 'incomplete' covers.
 * Bedrock-router's emergency-terminus path uses the same 'incomplete'
 * value, so sessions ended by either the LLM (emergency) or this
 * sweep (idle timeout) are indistinguishable on this column. The
 * `escalations_triggered` JSONB carries the emergency reason when
 * relevant, and ended_at + the difference (NOW() - updated_at) at
 * sweep time differentiates a sweep close from any other path.
 *
 * Idle window: SESSION_IDLE_MINUTES env var (default 30). The
 * comparison is against `updated_at`, which is bumped on every turn
 * by sessionPersister.update — so a session with active turns is
 * never collected, only one that's gone quiet.
 *
 * Returns a small JSON object for CloudWatch / EventBridge logging:
 *   { sweptCount: <int>, idleWindowMinutes: <int> }
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
  });
  await client.connect();
  return client;
}

exports.handler = async () => {
  const idleWindowMinutes = parseInt(
    process.env.SESSION_IDLE_MINUTES || "30",
    10
  );

  let dbClient;
  try {
    dbClient = await createDbConnection();
    const result = await dbClient.query(
      `UPDATE interaction_sessions
         SET status = 'incomplete',
             ended_at = NOW(),
             updated_at = NOW()
       WHERE status = 'in_progress'
         AND updated_at < NOW() - ($1 || ' minutes')::interval
       RETURNING id, fsm_state`,
      [String(idleWindowMinutes)]
    );

    const sweptCount = result.rowCount ?? 0;
    if (sweptCount > 0) {
      console.log("expire-stale-sessions: swept rows", {
        sweptCount,
        idleWindowMinutes,
        ids: result.rows.map((r) => r.id),
      });
    } else {
      console.log("expire-stale-sessions: no stale rows", {
        idleWindowMinutes,
      });
    }

    return { sweptCount, idleWindowMinutes };
  } catch (err) {
    console.error("expire-stale-sessions: sweep failed", {
      message: err?.message,
    });
    // Re-throw so EventBridge / CloudWatch counts a failed invocation.
    // The next scheduled run will re-attempt; idempotent because the
    // WHERE filters by status='in_progress'.
    throw err;
  } finally {
    if (dbClient) {
      try {
        await dbClient.end();
      } catch (_) {
        /* ignore */
      }
    }
  }
};

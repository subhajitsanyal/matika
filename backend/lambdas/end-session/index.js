/**
 * CareLog end-session Lambda
 *
 * Backs the explicit-close half of F2: POST /sessions/{sessionId}/end.
 * The Android client calls this when the user navigates away from a
 * conversation that the LLM-driven terminus path won't catch (e.g.,
 * the patient hits the Stop button without saying "I'm done"). On
 * success, marks status='complete' and stamps ended_at = NOW().
 *
 * The companion expire-stale-sessions cron sweep handles the paths
 * where the client can't reach this endpoint (crash, force-stop,
 * network drop, app killed by OS) — those rows get 'incomplete'
 * after the configured idle window.
 *
 * Authorization: only the user who owns the session can close it.
 * The caller's Cognito sub comes from the API Gateway authorizer
 * claims; we resolve it to the matching users.id and require it to
 * equal interaction_sessions.user_id (the row's owner).
 *
 * Idempotent: a second call against a row that's already terminal
 * returns 200 with the existing terminal state. Errors:
 *   - 400 if the path param isn't a valid UUID
 *   - 401 if the request lacks Cognito claims (shouldn't happen
 *     with COGNITO_USER_POOLS auth on the route, but handled
 *     defensively)
 *   - 404 if the session doesn't exist or doesn't belong to caller
 *     (we deliberately conflate these to avoid leaking session-id
 *     existence to non-owners)
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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const sessionId = event?.pathParameters?.sessionId;
  if (!sessionId || !UUID_REGEX.test(sessionId)) {
    return jsonResponse(400, {
      error: "invalid_session_id",
      message: "sessionId must be a UUID",
    });
  }

  const cognitoSub = event?.requestContext?.authorizer?.claims?.sub;
  if (!cognitoSub) {
    return jsonResponse(401, {
      error: "unauthorized",
      message: "Cognito claims missing from request context",
    });
  }

  let dbClient;
  try {
    dbClient = await createDbConnection();

    // Single statement: update if status='in_progress' AND owner matches,
    // OR no-op (return existing row) if already terminal AND owner matches.
    // The CASE on status keeps idempotency: a second call returns the same
    // row unmodified. RETURNING surfaces the post-update state.
    const result = await dbClient.query(
      `WITH owned AS (
         SELECT s.id, s.status, s.ended_at
         FROM interaction_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND u.cognito_sub = $2
       )
       UPDATE interaction_sessions s
          SET status = 'complete',
              ended_at = NOW(),
              updated_at = NOW()
         FROM owned
        WHERE s.id = owned.id AND owned.status = 'in_progress'
       RETURNING s.id, s.status, s.ended_at, s.fsm_state, s.user_id`,
      [sessionId, cognitoSub]
    );

    if (result.rowCount > 0) {
      const row = result.rows[0];
      console.log("end-session: closed session", {
        sessionId: row.id,
        userId: row.user_id,
        fsmState: row.fsm_state,
      });
      return jsonResponse(200, {
        sessionId: row.id,
        status: row.status,
        endedAt: row.ended_at,
        fsmState: row.fsm_state,
      });
    }

    // Either: (a) row doesn't exist, (b) not the caller's session, or
    // (c) row exists & is owned by caller but already terminal. Re-read
    // to disambiguate (c) — that case returns 200 idempotently.
    const lookup = await dbClient.query(
      `SELECT s.id, s.status, s.ended_at, s.fsm_state, s.user_id
         FROM interaction_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND u.cognito_sub = $2`,
      [sessionId, cognitoSub]
    );

    if (lookup.rowCount > 0) {
      const row = lookup.rows[0];
      console.log("end-session: already terminal (idempotent no-op)", {
        sessionId: row.id,
        existingStatus: row.status,
      });
      return jsonResponse(200, {
        sessionId: row.id,
        status: row.status,
        endedAt: row.ended_at,
        fsmState: row.fsm_state,
      });
    }

    // Unknown id OR caller doesn't own it. Conflate to avoid leaking
    // existence of session ids belonging to other users.
    console.warn("end-session: not found or not owned by caller", {
      sessionId,
    });
    return jsonResponse(404, {
      error: "not_found",
      message: "Session not found",
    });
  } catch (err) {
    console.error("end-session: failed", { message: err?.message });
    return jsonResponse(500, {
      error: "internal_error",
      message: "Failed to end session",
    });
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

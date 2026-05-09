/**
 * CareLog Post-Authentication Lambda
 *
 * Triggered by Cognito on every successful sign-in (PostAuthentication
 * trigger). Single responsibility: stamp users.last_login_at = NOW()
 * for the authenticating user, identified by their Cognito sub.
 *
 * Fix for docs/testing_todos_v2.md F1 — surfaced by sweep
 * 20260508_215314: PT-V2-07 logged Jane in successfully but
 * users.last_login_at remained NULL because no path ever wrote it.
 *
 * HIPAA: no PHI logged. Failures are logged but not raised — Cognito
 * documents that throwing from a PostAuthentication trigger blocks
 * the user's sign-in, which is too aggressive for telemetry tracking.
 * If the DB write fails we still let auth succeed.
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

exports.handler = async (event) => {
  const cognitoSub = event?.request?.userAttributes?.sub;
  const triggerSource = event?.triggerSource;

  if (!cognitoSub) {
    console.warn(
      "post-authentication: no sub in event.request.userAttributes; skipping update",
      { triggerSource }
    );
    return event;
  }

  let dbClient;
  try {
    dbClient = await createDbConnection();
    const result = await dbClient.query(
      "UPDATE users SET last_login_at = NOW() WHERE cognito_sub = $1 RETURNING id",
      [cognitoSub]
    );
    if (result.rowCount === 0) {
      // The user authenticated against Cognito but has no RDS row yet.
      // Most likely a still-in-flight sign-up where post-confirmation
      // hasn't completed, or a stale Cognito user without a paired
      // RDS row. Log and return — auth succeeds either way.
      console.warn("post-authentication: no RDS user for cognito_sub", {
        triggerSource,
      });
    } else {
      console.log("post-authentication: stamped last_login_at", {
        userId: result.rows[0].id,
        triggerSource,
      });
    }
  } catch (err) {
    // Telemetry failure must not block sign-in. Log and swallow.
    console.error("post-authentication: DB update failed (auth proceeds)", {
      message: err?.message,
      triggerSource,
    });
  } finally {
    if (dbClient) {
      try { await dbClient.end(); } catch (_) { /* ignore */ }
    }
  }

  return event;
};

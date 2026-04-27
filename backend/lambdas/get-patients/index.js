/**
 * CareLog Get Patients Lambda
 *
 * Returns linked patients for the authenticated user (caregiver or doctor).
 * Response matches the Android PatientListItem model.
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
  const command = new GetSecretValueCommand({
    SecretId: process.env.DB_SECRET_NAME,
  });
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
  const claims = event.requestContext?.authorizer?.claims || {};
  const cognitoSub = claims.sub;

  if (!cognitoSub) {
    return resp(401, { error: "Unauthorized" });
  }

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    // Get user ID from cognito sub
    const userResult = await dbClient.query(
      `SELECT id FROM users WHERE cognito_sub = $1 AND is_active = true`,
      [cognitoSub]
    );

    if (userResult.rows.length === 0) {
      return resp(200, { patients: [] });
    }

    const userId = userResult.rows[0].id;

    // Get all linked patients for this user (works for caregivers and doctors)
    const result = await dbClient.query(
      `SELECT
         p.patient_id,
         u_patient.name,
         p.date_of_birth,
         p.medical_conditions,
         p.created_at
       FROM patients p
       JOIN users u_patient ON u_patient.id = p.user_id
       JOIN persona_links pl ON pl.patient_id = p.id
       WHERE pl.linked_user_id = $1
         AND pl.is_active = true
       ORDER BY p.created_at DESC`,
      [userId]
    );

    const patients = result.rows.map((row) => {
      let age = null;
      if (row.date_of_birth) {
        const dob = new Date(row.date_of_birth);
        const now = new Date();
        age = Math.floor((now - dob) / (365.25 * 24 * 60 * 60 * 1000));
      }

      return {
        patient_id: row.patient_id,
        name: row.name,
        age,
        conditions: row.medical_conditions || [],
        last_check_in: null,
        alert_count: 0,
      };
    });

    return resp(200, { patients });
  } catch (error) {
    console.error("Error fetching patients:", error);
    return resp(500, { error: "Internal server error" });
  } finally {
    if (dbClient) await dbClient.end();
  }
};

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

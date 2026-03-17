/**
 * CareLog Delete Patient Lambda
 *
 * Deletes a patient and cascades to remove all associated personas:
 * 1. Validates caregiver (relative) owns this patient
 * 2. Disables/deletes associated attendant and doctor Cognito users
 * 3. Deactivates all persona_links for this patient
 * 4. Soft-deletes invite records
 * 5. Soft-deletes the patient record
 * 6. Audit logs the cascade
 *
 * HIPAA Compliance:
 * - Soft-delete preserves audit trail
 * - All operations within a transaction
 * - Audit logging for every deletion
 */

const {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { Client } = require("pg");

const cognitoClient = new CognitoIdentityProviderClient({});
const sesClient = new SESClient({});
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
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  return client;
}

/**
 * Disable a Cognito user (soft-delete — preserves the account but prevents login).
 */
async function disableCognitoUser(email) {
  try {
    await cognitoClient.send(
      new AdminDisableUserCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: email,
      })
    );
  } catch (error) {
    // User may not exist in Cognito (e.g. invite was never accepted)
    console.warn(`Could not disable Cognito user ${email}:`, error.message);
  }
}

/**
 * Send removal notification email.
 */
async function sendRemovalEmail(email, name, patientName, role) {
  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: process.env.FROM_EMAIL || "noreply@carelog.com",
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: {
            Data: `Your CareLog ${role} access has been removed`,
            Charset: "UTF-8",
          },
          Body: {
            Text: {
              Data: `Hello ${name},\n\nYour ${role} access to ${patientName}'s care record on CareLog has been removed by the caregiver.\n\nIf you believe this was done in error, please contact the caregiver directly.\n\nCareLog - Health monitoring made simple`,
              Charset: "UTF-8",
            },
          },
        },
      })
    );
  } catch (error) {
    console.warn(`Failed to send removal email to ${email}:`, error.message);
  }
}

exports.handler = async (event) => {
  console.log("Delete patient request received");

  const patientId =
    event.pathParameters?.patientId ||
    JSON.parse(event.body || "{}").patientId;
  const relativeCognitoSub = event.requestContext.authorizer.claims.sub;

  if (!patientId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Patient ID is required" }),
    };
  }

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    // Verify relative owns this patient
    const accessCheck = await dbClient.query(
      `SELECT p.id as patient_db_id, p.patient_id, u.name as patient_name
       FROM patients p
       JOIN persona_links pl ON pl.patient_id = p.id
       JOIN users u ON u.id = p.user_id
       WHERE p.patient_id = $1
         AND pl.linked_user_id = (SELECT id FROM users WHERE cognito_sub = $2)
         AND pl.relationship = 'relative'
         AND pl.is_primary = true
         AND pl.is_active = true`,
      [patientId, relativeCognitoSub]
    );

    if (accessCheck.rows.length === 0) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error:
            "You do not have permission to delete this patient. Only the primary caregiver can do this.",
        }),
      };
    }

    const patientDbId = accessCheck.rows[0].patient_db_id;
    const patientName = accessCheck.rows[0].patient_name;

    await dbClient.query("BEGIN");

    try {
      // 1. Find all linked attendants and doctors
      const linkedUsers = await dbClient.query(
        `SELECT u.id, u.email, u.name, u.cognito_sub, pl.relationship
         FROM persona_links pl
         JOIN users u ON u.id = pl.linked_user_id
         WHERE pl.patient_id = $1
           AND pl.relationship IN ('attendant', 'doctor')
           AND pl.is_active = true`,
        [patientDbId]
      );

      // 2. Disable each linked user in Cognito and send notification
      for (const linkedUser of linkedUsers.rows) {
        await disableCognitoUser(linkedUser.email);
        await sendRemovalEmail(
          linkedUser.email,
          linkedUser.name,
          patientName,
          linkedUser.relationship
        );

        // Deactivate their user record
        await dbClient.query(
          `UPDATE users SET is_active = false, deactivated_at = NOW() WHERE id = $1`,
          [linkedUser.id]
        );
      }

      // 3. Deactivate all persona_links for this patient
      await dbClient.query(
        `UPDATE persona_links SET is_active = false WHERE patient_id = $1`,
        [patientDbId]
      );

      // 4. Cancel all pending invites
      await dbClient.query(
        `UPDATE attendant_invites SET status = 'cancelled' WHERE patient_id = $1 AND status = 'pending'`,
        [patientDbId]
      );
      await dbClient.query(
        `UPDATE doctor_invites SET status = 'cancelled' WHERE patient_id = $1 AND status = 'pending'`,
        [patientDbId]
      );

      // 5. Soft-delete the patient record
      await dbClient.query(
        `UPDATE patients SET is_active = false, deleted_at = NOW() WHERE id = $1`,
        [patientDbId]
      );

      // 6. Disable patient's own Cognito user
      const patientUser = await dbClient.query(
        `SELECT u.cognito_sub, u.email FROM users u
         JOIN patients p ON p.user_id = u.id
         WHERE p.id = $1`,
        [patientDbId]
      );
      if (patientUser.rows.length > 0) {
        await disableCognitoUser(patientUser.rows[0].email);
        await dbClient.query(
          `UPDATE users SET is_active = false, deactivated_at = NOW()
           WHERE cognito_sub = $1`,
          [patientUser.rows[0].cognito_sub]
        );
      }

      // 7. Audit log
      await dbClient.query(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
         VALUES (
           (SELECT id FROM users WHERE cognito_sub = $1),
           'DELETE_CASCADE',
           'patient',
           $2,
           $3
         )`,
        [
          relativeCognitoSub,
          patientId,
          JSON.stringify({
            patientName,
            removedAttendants: linkedUsers.rows
              .filter((u) => u.relationship === "attendant")
              .map((u) => u.email),
            removedDoctors: linkedUsers.rows
              .filter((u) => u.relationship === "doctor")
              .map((u) => u.email),
          }),
        ]
      );

      await dbClient.query("COMMIT");

      console.log(
        `Patient ${patientId} deleted with cascade: ${linkedUsers.rows.length} linked users removed`
      );

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Patient and all associated personas have been removed",
          removedCount: linkedUsers.rows.length,
        }),
      };
    } catch (error) {
      await dbClient.query("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error("Error deleting patient:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to delete patient" }),
    };
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

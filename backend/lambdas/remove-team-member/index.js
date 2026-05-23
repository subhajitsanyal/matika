/**
 * CareLog Remove Team Member Lambda
 *
 * Removes an attendant or doctor from a patient's care team:
 * 1. Validates caregiver owns this patient
 * 2. Disables the member's Cognito account
 * 3. Deactivates persona_link
 * 4. Deactivates user record
 * 5. Sends notification email
 * 6. Audit logs the removal
 *
 * Route: DELETE /patients/{patientId}/team/{memberId}
 *
 * HIPAA Compliance:
 * - Soft-delete preserves audit trail
 * - Notification sent to removed member
 * - Audit logging for every removal
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
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

async function disableCognitoUser(email) {
  try {
    await cognitoClient.send(
      new AdminDisableUserCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: email,
      })
    );
  } catch (error) {
    console.warn(`Could not disable Cognito user ${email}:`, error.message);
  }
}

async function sendRemovalEmail(email, name, patientName, role, caregiverName) {
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
            Html: {
              Data: `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="utf-8">
                  <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #dc3545; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                    .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="header">
                      <h2>Access Removed</h2>
                    </div>
                    <div class="content">
                      <p>Hello ${name},</p>
                      <p>Your ${role} access to <strong>${patientName}</strong>'s care record on CareLog has been removed by ${caregiverName}.</p>
                      <p>You will no longer be able to log in or access this patient's data.</p>
                      <p>If you believe this was done in error, please contact ${caregiverName} directly.</p>
                    </div>
                    <div class="footer">
                      <p>CareLog - Health monitoring made simple</p>
                    </div>
                  </div>
                </body>
                </html>
              `,
              Charset: "UTF-8",
            },
            Text: {
              Data: `Hello ${name},\n\nYour ${role} access to ${patientName}'s care record on CareLog has been removed by ${caregiverName}.\n\nYou will no longer be able to log in or access this patient's data.\n\nIf you believe this was done in error, please contact ${caregiverName} directly.\n\nCareLog - Health monitoring made simple`,
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
  console.log("Remove team member request received");

  const patientId = event.pathParameters?.patientId;
  const memberId = event.pathParameters?.memberId;
  const relativeCognitoSub = event.requestContext.authorizer.claims.sub;

  if (!patientId || !memberId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Patient ID and member ID are required",
      }),
    };
  }

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    // Verify caregiver owns this patient.
    //
    // F52 sub-issue 2 (2026-05-18): callers from the caregiver app send
    // the patient short-code (CL-XXXXXX) from custom:linked_patient_id,
    // not the patients.id UUID. The old `$1::uuid` cast crashed with
    // 22P02 on non-UUID input. Accept either format — same shape as
    // the invite-attendant fix.
    const accessCheck = await dbClient.query(
      `SELECT p.id as patient_db_id, p.patient_id, up.name as patient_name, ur.name as relative_name
       FROM patients p
       JOIN persona_links pl ON pl.patient_id = p.id
       JOIN users up ON up.id = p.user_id
       JOIN users ur ON ur.cognito_sub = $2
       WHERE (p.patient_id = $1 OR p.id::text = $1)
         AND pl.linked_user_id = ur.id
         AND pl.relationship = 'caregiver'
         AND pl.is_active = true`,
      [patientId, relativeCognitoSub]
    );

    if (accessCheck.rows.length === 0) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "You do not have permission to manage this patient's care team",
        }),
      };
    }

    const patientDbId = accessCheck.rows[0].patient_db_id;
    const patientName = accessCheck.rows[0].patient_name;
    const relativeName = accessCheck.rows[0].relative_name;

    // Find the member to remove.
    //
    // v2 reality: there is no `attendant` persona. invite-attendant always
    // writes persona_links.relationship='caregiver' (and users.persona_type
    // ='caregiver'). The doctor flow is Phase 2 but the enum value is
    // already populated for forward-compat. Excluding `is_primary=true`
    // protects the primary caregiver row (the inviter) from being
    // removed via this lambda.
    const memberQuery = await dbClient.query(
      `SELECT u.id, u.email, u.name, u.cognito_sub, pl.relationship, pl.id as link_id
       FROM persona_links pl
       JOIN users u ON u.id = pl.linked_user_id
       WHERE pl.patient_id = $1
         AND u.id = $2
         AND pl.relationship IN ('caregiver', 'doctor')
         AND pl.is_primary = false
         AND pl.is_active = true`,
      [patientDbId, memberId]
    );

    if (memberQuery.rows.length === 0) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Team member not found" }),
      };
    }

    const member = memberQuery.rows[0];

    await dbClient.query("BEGIN");

    try {
      // 1. Deactivate persona_link
      await dbClient.query(
        `UPDATE persona_links SET is_active = false WHERE id = $1`,
        [member.link_id]
      );

      // 2. Deactivate user record.
      //
      // F53 (2026-05-18): the v2 `users` schema has no `deactivated_at`
      // column — only `is_active`, `created_at`, `updated_at`,
      // `last_login_at`. The previous UPDATE referenced a column from a
      // pre-v2 schema, so any actual invocation of this lambda would
      // have thrown `42703 column "deactivated_at" does not exist` and
      // rolled the whole removal back. The DELETE route was masked as a
      // MOCK in API Gateway (also F53) so the lambda was never invoked
      // and the bug went undetected. If a future migration restores
      // `deactivated_at`, add it back here (or fold via `updated_at`
      // which the row gets implicitly).
      await dbClient.query(
        `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
        [member.id]
      );

      // 3. Disable Cognito user
      await disableCognitoUser(member.email);

      // 4. Audit log
      await dbClient.query(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
         VALUES (
           (SELECT id FROM users WHERE cognito_sub = $1),
           'REMOVE_MEMBER',
           $2,
           $3,
           $4
         )`,
        [
          relativeCognitoSub,
          member.relationship,
          member.id.toString(),
          JSON.stringify({
            patientId,
            memberEmail: member.email,
            memberName: member.name,
            role: member.relationship,
          }),
        ]
      );

      await dbClient.query("COMMIT");

      // 5. Send notification email (outside transaction — non-critical)
      await sendRemovalEmail(
        member.email,
        member.name,
        patientName,
        member.relationship,
        relativeName
      );

      console.log(
        `Team member removed: ${member.email} (${member.relationship}) from patient ${patientId}`
      );

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `${member.relationship} removed successfully`,
          removedMember: {
            id: member.id,
            name: member.name,
            email: member.email,
            role: member.relationship,
          },
        }),
      };
    } catch (error) {
      await dbClient.query("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error("Error removing team member:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to remove team member" }),
    };
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

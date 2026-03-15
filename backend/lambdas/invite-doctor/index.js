/**
 * CareLog Invite Doctor Lambda
 *
 * Sends invites to doctors for a patient:
 * 1. Validates relative has permission to invite
 * 2. Creates invite record in RDS
 * 3. Sends email via SES with link to web portal
 *
 * HIPAA Compliance:
 * - Invite tokens are cryptographically secure
 * - Invites expire after 14 days (longer for doctors)
 * - Audit logging for invite actions
 */

const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { Client } = require("pg");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

const sesClient = new SESClient({});
const secretsClient = new SecretsManagerClient({});

let dbCredentials = null;

/**
 * Get database credentials from Secrets Manager.
 */
async function getDatabaseCredentials() {
  if (dbCredentials) return dbCredentials;

  const command = new GetSecretValueCommand({
    SecretId: process.env.DB_SECRET_NAME,
  });
  const response = await secretsClient.send(command);
  dbCredentials = JSON.parse(response.SecretString);
  return dbCredentials;
}

/**
 * Create database connection.
 */
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
 * Generate a secure invite token.
 */
function generateInviteToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Send doctor invite email via SES.
 */
async function sendDoctorInviteEmail(
  email,
  doctorName,
  patientName,
  relativeName,
  inviteLink
) {
  const params = {
    Source: process.env.FROM_EMAIL || "noreply@carelog.com",
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Subject: {
        Data: `Invitation to join ${patientName}'s care team on CareLog`,
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
                .header { background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .button { display: inline-block; background: #1e3a5f; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
                .highlight { background: #e8f4f8; padding: 16px; border-radius: 8px; margin: 16px 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>CareLog for Physicians</h1>
                </div>
                <div class="content">
                  <p>Dear Dr. ${doctorName},</p>

                  <p>${relativeName} has invited you to join the care team for <strong>${patientName}</strong> on CareLog.</p>

                  <div class="highlight">
                    <p><strong>What is CareLog?</strong></p>
                    <p>CareLog is a HIPAA-compliant health monitoring platform that allows patients, caregivers, and physicians to collaborate on care.</p>
                  </div>

                  <p>As a physician on CareLog, you'll be able to:</p>
                  <ul>
                    <li>Review patient vitals and health trends</li>
                    <li>Configure health alert thresholds</li>
                    <li>Receive notifications for concerning changes</li>
                    <li>Access FHIR-compliant health records</li>
                    <li>Collaborate with the care team</li>
                  </ul>

                  <p>Click the button below to accept this invitation and create your physician account:</p>

                  <p style="text-align: center;">
                    <a href="${inviteLink}" class="button">Accept Invitation</a>
                  </p>

                  <p><em>This invitation expires in 14 days.</em></p>

                  <p>If you have questions or did not expect this invitation, please contact our support team.</p>
                </div>
                <div class="footer">
                  <p>CareLog - HIPAA-Compliant Health Monitoring</p>
                  <p>&copy; ${new Date().getFullYear()} CareLog. All rights reserved.</p>
                </div>
              </div>
            </body>
            </html>
          `,
          Charset: "UTF-8",
        },
        Text: {
          Data: `
Dear Dr. ${doctorName},

${relativeName} has invited you to join the care team for ${patientName} on CareLog.

What is CareLog?
CareLog is a HIPAA-compliant health monitoring platform that allows patients, caregivers, and physicians to collaborate on care.

As a physician on CareLog, you'll be able to:
- Review patient vitals and health trends
- Configure health alert thresholds
- Receive notifications for concerning changes
- Access FHIR-compliant health records
- Collaborate with the care team

Click the link below to accept this invitation:
${inviteLink}

This invitation expires in 14 days.

If you have questions or did not expect this invitation, please contact our support team.

CareLog - HIPAA-Compliant Health Monitoring
          `,
          Charset: "UTF-8",
        },
      },
    },
  };

  await sesClient.send(new SendEmailCommand(params));
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log("Invite doctor request received");

  const body = JSON.parse(event.body);
  const relativeCognitoSub = event.requestContext.authorizer.claims.sub;

  // Validate required fields
  if (!body.patientId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Patient ID is required" }),
    };
  }

  if (!body.doctorName) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Doctor name is required" }),
    };
  }

  if (!body.doctorEmail) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Doctor email is required" }),
    };
  }

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    // Verify relative has access to this patient
    const accessCheck = await dbClient.query(
      `SELECT p.id, p.patient_id, up.name as patient_name, ur.name as relative_name
       FROM patients p
       JOIN persona_links pl ON pl.patient_id = p.id
       JOIN users up ON up.id = p.user_id
       JOIN users ur ON ur.cognito_sub = $2
       WHERE p.patient_id = $1
         AND pl.linked_user_id = ur.id
         AND pl.relationship = 'relative'
         AND pl.is_active = true`,
      [body.patientId, relativeCognitoSub]
    );

    if (accessCheck.rows.length === 0) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "You do not have permission to invite doctors for this patient",
        }),
      };
    }

    const patientDbId = accessCheck.rows[0].id;
    const patientName = accessCheck.rows[0].patient_name;
    const relativeName = accessCheck.rows[0].relative_name;

    // Check if doctor already invited or linked
    const existingInvite = await dbClient.query(
      `SELECT id, status FROM doctor_invites
       WHERE patient_id = $1 AND doctor_email = $2 AND status IN ('pending', 'accepted')`,
      [patientDbId, body.doctorEmail]
    );

    if (existingInvite.rows.length > 0) {
      const status = existingInvite.rows[0].status;
      return {
        statusCode: 409,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error:
            status === "accepted"
              ? "This doctor is already linked to the patient"
              : "An invitation has already been sent to this email",
        }),
      };
    }

    // Generate invite token
    const inviteToken = generateInviteToken();
    const inviteId = uuidv4();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    // Create invite record
    await dbClient.query(
      `INSERT INTO doctor_invites (
        id, patient_id, invite_token, doctor_name, doctor_email, specialty,
        invited_by, expires_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
      [
        inviteId,
        patientDbId,
        inviteToken,
        body.doctorName,
        body.doctorEmail,
        body.specialty || null,
        relativeCognitoSub,
        expiresAt,
      ]
    );

    // Create audit log
    await dbClient.query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
       VALUES (
         (SELECT id FROM users WHERE cognito_sub = $1),
         'INVITE',
         'doctor',
         $2,
         $3
       )`,
      [
        relativeCognitoSub,
        inviteId,
        JSON.stringify({
          patientId: body.patientId,
          doctorName: body.doctorName,
          doctorEmail: body.doctorEmail,
          specialty: body.specialty,
        }),
      ]
    );

    // Generate invite link (web portal for doctors)
    const baseUrl = process.env.WEB_PORTAL_URL || "https://portal.carelog.com";
    const inviteLink = `${baseUrl}/doctor/invite/accept?token=${inviteToken}`;

    // Send invite email
    await sendDoctorInviteEmail(
      body.doctorEmail,
      body.doctorName,
      patientName,
      relativeName,
      inviteLink
    );

    console.log(`Doctor invite sent: ${inviteId}`);

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviteId,
        message: "Invitation sent successfully",
        expiresAt: expiresAt.toISOString(),
      }),
    };
  } catch (error) {
    console.error("Error sending doctor invite:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to send invitation" }),
    };
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

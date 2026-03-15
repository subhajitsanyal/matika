/**
 * CareLog Invite Attendant Lambda
 *
 * Sends invites to attendants for a patient:
 * 1. Validates relative has permission to invite
 * 2. Creates invite record in RDS
 * 3. Sends email via SES or SMS via SNS
 *
 * HIPAA Compliance:
 * - Invite tokens are cryptographically secure
 * - Invites expire after 7 days
 * - Audit logging for invite actions
 */

const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { Client } = require("pg");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

const sesClient = new SESClient({});
const snsClient = new SNSClient({});
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
 * Send invite email via SES.
 */
async function sendInviteEmail(email, attendantName, patientName, inviteLink) {
  const params = {
    Source: process.env.FROM_EMAIL || "noreply@carelog.com",
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Subject: {
        Data: `You've been invited to care for ${patientName} on CareLog`,
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
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .button { display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>Welcome to CareLog</h1>
                </div>
                <div class="content">
                  <p>Hello ${attendantName},</p>

                  <p>You've been invited to join CareLog as an attendant for <strong>${patientName}</strong>.</p>

                  <p>As an attendant, you'll be able to:</p>
                  <ul>
                    <li>Log vital signs and health observations</li>
                    <li>Track medication and care activities</li>
                    <li>Receive health alerts and reminders</li>
                    <li>Communicate with the care team</li>
                  </ul>

                  <p>Click the button below to accept this invitation and create your account:</p>

                  <p style="text-align: center;">
                    <a href="${inviteLink}" class="button">Accept Invitation</a>
                  </p>

                  <p><em>This invitation expires in 7 days.</em></p>

                  <p>If you didn't expect this invitation, you can safely ignore this email.</p>
                </div>
                <div class="footer">
                  <p>CareLog - Health monitoring made simple</p>
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
Hello ${attendantName},

You've been invited to join CareLog as an attendant for ${patientName}.

As an attendant, you'll be able to:
- Log vital signs and health observations
- Track medication and care activities
- Receive health alerts and reminders
- Communicate with the care team

Click the link below to accept this invitation:
${inviteLink}

This invitation expires in 7 days.

If you didn't expect this invitation, you can safely ignore this email.

CareLog - Health monitoring made simple
          `,
          Charset: "UTF-8",
        },
      },
    },
  };

  await sesClient.send(new SendEmailCommand(params));
}

/**
 * Send invite SMS via SNS.
 */
async function sendInviteSMS(phone, attendantName, patientName, inviteLink) {
  const message = `Hi ${attendantName}, you've been invited to care for ${patientName} on CareLog. Accept here: ${inviteLink}`;

  const params = {
    Message: message,
    PhoneNumber: phone,
    MessageAttributes: {
      "AWS.SNS.SMS.SMSType": {
        DataType: "String",
        StringValue: "Transactional",
      },
    },
  };

  await snsClient.send(new PublishCommand(params));
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log("Invite attendant request received");

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

  if (!body.attendantName) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Attendant name is required" }),
    };
  }

  if (!body.email && !body.phone) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Either email or phone number is required",
      }),
    };
  }

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    // Verify relative has access to this patient
    const accessCheck = await dbClient.query(
      `SELECT p.id, p.patient_id, u.name as patient_name
       FROM patients p
       JOIN persona_links pl ON pl.patient_id = p.id
       JOIN users u ON u.id = p.user_id
       WHERE p.patient_id = $1
         AND pl.linked_user_id = (SELECT id FROM users WHERE cognito_sub = $2)
         AND pl.relationship = 'relative'
         AND pl.is_active = true`,
      [body.patientId, relativeCognitoSub]
    );

    if (accessCheck.rows.length === 0) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "You do not have permission to invite attendants for this patient",
        }),
      };
    }

    const patientDbId = accessCheck.rows[0].id;
    const patientName = accessCheck.rows[0].patient_name;

    // Generate invite token
    const inviteToken = generateInviteToken();
    const inviteId = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create invite record
    await dbClient.query(
      `INSERT INTO attendant_invites (
        id, patient_id, invite_token, attendant_name, attendant_email, attendant_phone,
        invited_by, expires_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
      [
        inviteId,
        patientDbId,
        inviteToken,
        body.attendantName,
        body.email || null,
        body.phone || null,
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
         'attendant',
         $2,
         $3
       )`,
      [
        relativeCognitoSub,
        inviteId,
        JSON.stringify({
          patientId: body.patientId,
          attendantName: body.attendantName,
          method: body.email ? "email" : "sms",
        }),
      ]
    );

    // Generate invite link
    const baseUrl = process.env.WEB_PORTAL_URL || "https://portal.carelog.com";
    const inviteLink = `${baseUrl}/invite/accept?token=${inviteToken}`;

    // Send invite
    if (body.email) {
      await sendInviteEmail(
        body.email,
        body.attendantName,
        patientName,
        inviteLink
      );
    } else if (body.phone) {
      await sendInviteSMS(
        body.phone,
        body.attendantName,
        patientName,
        inviteLink
      );
    }

    console.log(`Attendant invite sent: ${inviteId}`);

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
    console.error("Error sending invite:", error);
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

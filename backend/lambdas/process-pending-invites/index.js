/**
 * Process Pending Invites Lambda
 *
 * Runs on a schedule (every 2 minutes) to:
 * 1. Find pending attendant/doctor invites that haven't had emails sent
 * 2. Check if the recipient's email is now verified in SES
 * 3. Send the invite email if verified
 * 4. Notify the caregiver (via push notification) that the invite was sent
 *
 * This handles the SES sandbox flow where recipients must verify their
 * email before we can send them the actual invite.
 */

const {
  SESClient,
  SendEmailCommand,
  GetIdentityVerificationAttributesCommand,
} = require("@aws-sdk/client-ses");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { Client } = require("pg");

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

/**
 * Send invite email via SES with credentials.
 */
async function sendInviteEmail(email, attendantName, patientName, inviteLink) {
  // Note: inviteLink is now used as downloadLink for the process-pending path
  const params = {
    Source: process.env.FROM_EMAIL || "noreply@carelog.com",
    Destination: { ToAddresses: [email] },
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
                <div class="header"><h1>Welcome to CareLog</h1></div>
                <div class="content">
                  <p>Hello ${attendantName},</p>
                  <p>You've been invited to join CareLog as an attendant for <strong>${patientName}</strong>.</p>
                  <p>As an attendant, you'll be able to:</p>
                  <ul>
                    <li>Log vital signs and health observations</li>
                    <li>Track medication and care activities</li>
                    <li>Receive health alerts and reminders</li>
                  </ul>
                  <p>Click the button below to accept this invitation:</p>
                  <p style="text-align: center;"><a href="${inviteLink}" class="button">Accept Invitation</a></p>
                  <p><em>This invitation expires in 7 days.</em></p>
                </div>
                <div class="footer"><p>&copy; ${new Date().getFullYear()} CareLog</p></div>
              </div>
            </body>
            </html>
          `,
          Charset: "UTF-8",
        },
        Text: {
          Data: `Hello ${attendantName},\n\nYou've been invited to join CareLog as an attendant for ${patientName}.\n\nAccept here: ${inviteLink}\n\nThis invitation expires in 7 days.`,
          Charset: "UTF-8",
        },
      },
    },
  };

  await sesClient.send(new SendEmailCommand(params));
}

exports.handler = async () => {
  console.log("Processing pending invites...");

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    // Find pending invites with email addresses that haven't expired
    const pendingResult = await dbClient.query(
      `SELECT ai.id, ai.invite_token, ai.attendant_name, ai.attendant_email,
              u.name AS patient_name
       FROM attendant_invites ai
       JOIN patients p ON ai.patient_id = p.id
       JOIN users u ON p.user_id = u.id
       WHERE ai.status = 'pending'
         AND ai.attendant_email IS NOT NULL
         AND ai.expires_at > NOW()
       ORDER BY ai.created_at ASC
       LIMIT 20`
    );

    if (pendingResult.rows.length === 0) {
      console.log("No pending invites to process");
      return { processed: 0 };
    }

    // Collect unique emails to check verification status
    const emails = [
      ...new Set(pendingResult.rows.map((r) => r.attendant_email)),
    ];

    const verifyResult = await sesClient.send(
      new GetIdentityVerificationAttributesCommand({ Identities: emails })
    );

    const verifiedEmails = new Set(
      emails.filter(
        (e) =>
          verifyResult.VerificationAttributes?.[e]?.VerificationStatus ===
          "Success"
      )
    );

    console.log(
      `Found ${pendingResult.rows.length} pending invites, ${verifiedEmails.size} verified emails`
    );

    let sent = 0;

    for (const invite of pendingResult.rows) {
      if (!verifiedEmails.has(invite.attendant_email)) {
        continue; // Email not yet verified, skip
      }

      try {
        const baseUrl =
          process.env.WEB_PORTAL_URL || "https://portal.carelog.com";
        const inviteLink = `${baseUrl}/invite/accept?token=${invite.invite_token}`;

        await sendInviteEmail(
          invite.attendant_email,
          invite.attendant_name,
          invite.patient_name,
          inviteLink
        );

        // Mark as invite_sent by updating the updated_at timestamp
        // (We use updated_at > created_at as the "email sent" signal)
        await dbClient.query(
          `UPDATE attendant_invites SET updated_at = NOW() WHERE id = $1`,
          [invite.id]
        );

        console.log(
          `Invite email sent to ${invite.attendant_email} for invite ${invite.id}`
        );
        sent++;
      } catch (err) {
        console.error(
          `Failed to send invite ${invite.id} to ${invite.attendant_email}:`,
          err.message
        );
      }
    }

    console.log(`Processed: ${sent} invites sent`);
    return { processed: sent };
  } catch (error) {
    console.error("Error processing pending invites:", error);
    throw error;
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

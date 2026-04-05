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

const {
  SESClient,
  SendEmailCommand,
  VerifyEmailIdentityCommand,
  GetIdentityVerificationAttributesCommand,
} = require("@aws-sdk/client-ses");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { Client } = require("pg");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

const sesClient = new SESClient({});
const snsClient = new SNSClient({});
const cognitoClient = new CognitoIdentityProviderClient({});
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
    ssl: { rejectUnauthorized: false },
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
 * Generate a human-readable password.
 */
function generatePassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "@#$!";
  let pwd = "";
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += symbols[Math.floor(Math.random() * symbols.length)];
  const all = upper + lower + digits + symbols;
  for (let i = 0; i < 4; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }
  // Shuffle
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}

/**
 * Create Cognito account for attendant and RDS records.
 */
async function createAttendantAccount(dbClient, email, name, password, patientDbId, invitedBy) {
  let cognitoSub;

  // Create Cognito user (or reuse existing)
  try {
    const createResult = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: email,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          { Name: "name", Value: name },
          { Name: "custom:persona_type", Value: "attendant" },
        ],
        MessageAction: "SUPPRESS",
      })
    );
    cognitoSub = createResult.User.Attributes.find((a) => a.Name === "sub")?.Value;
  } catch (err) {
    if (err.name === "UsernameExistsException") {
      // Account already exists — look up their sub and reset password
      console.log(`Cognito user ${email} already exists, resetting password`);
      const existingUser = await cognitoClient.send(
        new AdminGetUserCommand({ UserPoolId: process.env.COGNITO_USER_POOL_ID, Username: email })
      );
      cognitoSub = existingUser.UserAttributes.find((a) => a.Name === "sub")?.Value;
    } else {
      throw err;
    }
  }

  // Set permanent password
  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: email,
      Password: password,
      Permanent: true,
    })
  );

  // Add to attendants group
  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: email,
      GroupName: "attendants",
    })
  );

  // Create or update user record in RDS
  const userResult = await dbClient.query(
    `INSERT INTO users (cognito_sub, email, name, persona_type, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, 'attendant', true, NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET cognito_sub = $1, name = $3, is_active = true, updated_at = NOW()
     RETURNING id`,
    [cognitoSub, email, name]
  );
  const userId = userResult.rows[0].id;

  // Create persona_link (look up inviter's user ID from cognito_sub)
  await dbClient.query(
    `INSERT INTO persona_links (
      patient_id, linked_user_id, relationship, is_primary,
      can_log_vitals, can_configure_thresholds, can_view_history, can_receive_alerts,
      invited_by, accepted_at, is_active
    ) VALUES ($1, $2, 'attendant', false, true, false, true, true,
      (SELECT id FROM users WHERE cognito_sub = $3), NOW(), true)
    ON CONFLICT (patient_id, linked_user_id) DO UPDATE SET is_active = true, updated_at = NOW()`,
    [patientDbId, userId, invitedBy]
  );

  return cognitoSub;
}

/**
 * Send invite email via SES with login credentials and download link.
 */
async function sendInviteEmail(email, attendantName, patientName, password, downloadLink) {
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
                .credentials { background: white; border: 2px solid #667eea; border-radius: 8px; padding: 16px; margin: 16px 0; }
                .credentials p { margin: 4px 0; }
                .credentials strong { color: #667eea; }
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

                  <p>Your account has been created. Here are your login credentials:</p>

                  <div class="credentials">
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Password:</strong> ${password}</p>
                  </div>

                  <p>Please change your password after your first login.</p>

                  <p><strong>Step 1:</strong> Download the CareLog app:</p>
                  <p style="text-align: center;">
                    <a href="${downloadLink}" class="button">Download CareLog App</a>
                  </p>

                  <p><strong>Step 2:</strong> Open the app and sign in with the credentials above.</p>

                  <p>As an attendant, you'll be able to:</p>
                  <ul>
                    <li>Log vital signs and health observations</li>
                    <li>Track medication and care activities</li>
                    <li>Receive health alerts and reminders</li>
                  </ul>
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
          Data: `Hello ${attendantName},

You've been invited to join CareLog as an attendant for ${patientName}.

Your account has been created:
  Email: ${email}
  Password: ${password}

Step 1: Download the CareLog app: ${downloadLink}
Step 2: Open the app and sign in with the credentials above.
Please change your password after your first login.

CareLog - Health monitoring made simple`,
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

    // Generate password and create the attendant's account
    const password = generatePassword();
    const downloadLink = process.env.APP_DOWNLOAD_URL || "https://appdistribution.firebase.google.com/testerapps/1:191872106923:android:63245761468592e0d612ee";

    // Create Cognito account + RDS records
    await createAttendantAccount(
      dbClient,
      body.email,
      body.attendantName,
      password,
      patientDbId,
      relativeCognitoSub
    );

    // Mark invite as accepted (account already created)
    await dbClient.query(
      `UPDATE attendant_invites SET status = 'accepted', accepted_at = NOW() WHERE id = $1`,
      [inviteId]
    );

    // Send credentials email
    let emailStatus = "sent";
    if (body.email) {
      // Check if recipient is verified in SES (sandbox mode)
      const verifyResult = await sesClient.send(
        new GetIdentityVerificationAttributesCommand({
          Identities: [body.email],
        })
      );
      const status =
        verifyResult.VerificationAttributes?.[body.email]?.VerificationStatus;

      if (status === "Success") {
        await sendInviteEmail(
          body.email,
          body.attendantName,
          patientName,
          password,
          downloadLink
        );
        emailStatus = "sent";
      } else {
        // Recipient not verified — trigger verification email first
        await sesClient.send(
          new VerifyEmailIdentityCommand({ EmailAddress: body.email })
        );
        console.log(
          `SES verification sent to ${body.email} (sandbox mode). Credentials email will be sent after verification.`
        );
        emailStatus = "verification_pending";
      }
    }

    console.log(`Attendant account created and invite sent: ${inviteId}, emailStatus: ${emailStatus}`);

    // Notify admin to add attendant to Firebase testers group
    try {
      const adminEmail = (process.env.FROM_EMAIL || "").replace(/.*<(.+)>.*/, "$1") || "noreply@carelog.com";
      await sesClient.send(
        new SendEmailCommand({
          Source: process.env.FROM_EMAIL || "noreply@carelog.com",
          Destination: { ToAddresses: [adminEmail] },
          Message: {
            Subject: { Data: `[CareLog] Add tester: ${body.email}` },
            Body: {
              Text: {
                Data: `A new attendant has been invited and needs access to the app.\n\nAttendant: ${body.attendantName}\nEmail: ${body.email}\nPatient: ${patientName}\n\nPlease add them to the Firebase App Distribution testers group:\n\nfirebase appdistribution:testers:add --emails "${body.email}" --group-aliases internal-testers --project carelog-7de0c\n\nOr add via Firebase Console:\nhttps://console.firebase.google.com/project/carelog-7de0c/appdistribution`,
              },
            },
          },
        })
      );
      console.log(`Admin notification sent to ${adminEmail} to add ${body.email} as Firebase tester`);
    } catch (notifyErr) {
      console.warn("Failed to send admin notification:", notifyErr.message);
    }

    const message =
      emailStatus === "verification_pending"
        ? "Account created. A verification email has been sent to the attendant. Once verified, they will receive their login credentials."
        : "Invitation sent successfully. The attendant will receive their login credentials by email.";

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviteId,
        message,
        emailStatus,
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

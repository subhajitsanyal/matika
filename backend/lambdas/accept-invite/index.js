/**
 * CareLog Accept Invite Lambda
 *
 * Handles invite acceptance and registration:
 * 1. Validates invite token
 * 2. Creates Cognito user for attendant/doctor
 * 3. Creates user record in RDS
 * 4. Creates persona_link between caregiver and patient
 * 5. Marks invite as accepted
 *
 * HIPAA Compliance:
 * - All PHI encrypted in transit and at rest
 * - Audit logging for account creation
 */

const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminSetUserPasswordCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { Client } = require("pg");

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
 * Create Cognito user for attendant/doctor.
 */
async function createCognitoUser(email, password, name, personaType) {
  // Create user
  const createCommand = new AdminCreateUserCommand({
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    Username: email,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" },
      { Name: "name", Value: name },
      { Name: "custom:persona_type", Value: personaType },
    ],
    MessageAction: "SUPPRESS", // Don't send welcome email
  });

  const result = await cognitoClient.send(createCommand);
  const cognitoSub = result.User.Attributes.find((a) => a.Name === "sub")?.Value;

  // Set permanent password
  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: email,
      Password: password,
      Permanent: true,
    })
  );

  // Add to appropriate group
  const groupName = personaType === "attendant" ? "attendants" : "doctors";
  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: email,
      GroupName: groupName,
    })
  );

  return cognitoSub;
}

/**
 * Serve the HTML registration page for GET requests.
 */
function serveRegistrationPage(token) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Accept CareLog Invitation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: white; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); max-width: 420px; width: 100%; overflow: hidden; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 24px; text-align: center; }
    .header h1 { font-size: 22px; margin-bottom: 4px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .form { padding: 24px; }
    .field { margin-bottom: 16px; }
    .field label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px; color: #333; }
    .field input { width: 100%; padding: 10px 12px; border: 1.5px solid #ddd; border-radius: 8px; font-size: 15px; transition: border-color 0.2s; }
    .field input:focus { outline: none; border-color: #667eea; }
    .hint { font-size: 12px; color: #888; margin-top: 4px; }
    .btn { width: 100%; padding: 12px; background: #667eea; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .btn:hover { background: #5a6fd6; }
    .btn:disabled { background: #ccc; cursor: not-allowed; }
    .error { background: #fee; color: #c33; padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; display: none; }
    .success { background: #efe; color: #363; padding: 16px; border-radius: 8px; text-align: center; font-size: 15px; display: none; }
    .success h3 { margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Welcome to CareLog</h1>
      <p>Create your attendant account</p>
    </div>
    <div class="form" id="form-section">
      <div class="error" id="error-msg"></div>
      <form id="reg-form" onsubmit="return handleSubmit(event)">
        <div class="field">
          <label>Full Name</label>
          <input type="text" id="name" required placeholder="Your full name">
        </div>
        <div class="field">
          <label>Email</label>
          <input type="email" id="email" required placeholder="your@email.com">
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" id="password" required placeholder="Create a password">
          <div class="hint">Min 8 chars: uppercase, lowercase, number, and symbol</div>
        </div>
        <div class="field">
          <label>Phone (optional)</label>
          <input type="tel" id="phone" placeholder="+91...">
        </div>
        <button type="submit" class="btn" id="submit-btn">Create Account</button>
      </form>
    </div>
    <div class="success" id="success-section">
      <h3>Account Created!</h3>
      <p>You can now log in to the CareLog app as an attendant.</p>
      <p style="margin-top:12px;font-size:13px;color:#666;">Download the CareLog app and sign in with your email and password.</p>
    </div>
  </div>
  <script>
    async function handleSubmit(e) {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const err = document.getElementById('error-msg');
      btn.disabled = true;
      btn.textContent = 'Creating account...';
      err.style.display = 'none';
      try {
        const res = await fetch(window.location.pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: '${token}',
            name: document.getElementById('name').value,
            email: document.getElementById('email').value,
            password: document.getElementById('password').value,
            phone: document.getElementById('phone').value || undefined
          })
        });
        const data = await res.json();
        if (res.ok) {
          document.getElementById('form-section').style.display = 'none';
          document.getElementById('success-section').style.display = 'block';
        } else {
          err.textContent = data.error || 'Registration failed';
          err.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Create Account';
        }
      } catch (ex) {
        err.textContent = 'Network error. Please try again.';
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Create Account';
      }
    }
  </script>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: html,
  };
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log("Accept invite request received");

  const httpMethod = event.httpMethod || event.requestContext?.http?.method;

  // GET — serve registration HTML page
  if (httpMethod === "GET") {
    const token = event.queryStringParameters?.token;
    if (!token) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/html" },
        body: "<h1>Invalid invitation link</h1><p>No token provided.</p>",
      };
    }
    return serveRegistrationPage(token);
  }

  const body = JSON.parse(event.body);

  // Validate required fields
  if (!body.token) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invite token is required" }),
    };
  }

  if (!body.email || !body.password || !body.name) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Email, password, and name are required" }),
    };
  }

  // Validate password strength
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  if (!passwordRegex.test(body.password)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Password must be at least 8 characters with uppercase, lowercase, number, and symbol",
      }),
    };
  }

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    // Check attendant invite first
    let invite = null;
    let inviteType = null;

    const attendantInvite = await dbClient.query(
      `SELECT ai.*, p.id as patient_db_id, p.patient_id, u.name as patient_name
       FROM attendant_invites ai
       JOIN patients p ON p.id = ai.patient_id
       JOIN users u ON u.id = p.user_id
       WHERE ai.invite_token = $1
         AND ai.status = 'pending'
         AND ai.expires_at > NOW()`,
      [body.token]
    );

    if (attendantInvite.rows.length > 0) {
      invite = attendantInvite.rows[0];
      inviteType = "attendant";
    } else {
      // Check doctor invite
      const doctorInvite = await dbClient.query(
        `SELECT di.*, p.id as patient_db_id, p.patient_id, u.name as patient_name
         FROM doctor_invites di
         JOIN patients p ON p.id = di.patient_id
         JOIN users u ON u.id = p.user_id
         WHERE di.invite_token = $1
           AND di.status = 'pending'
           AND di.expires_at > NOW()`,
        [body.token]
      );

      if (doctorInvite.rows.length > 0) {
        invite = doctorInvite.rows[0];
        inviteType = "doctor";
      }
    }

    if (!invite) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Invalid or expired invitation",
        }),
      };
    }

    // Start transaction
    await dbClient.query("BEGIN");

    try {
      // Create Cognito user
      const cognitoSub = await createCognitoUser(
        body.email,
        body.password,
        body.name,
        inviteType
      );

      // Create user record
      const userResult = await dbClient.query(
        `INSERT INTO users (cognito_sub, email, name, phone, persona_type, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id`,
        [
          cognitoSub,
          body.email,
          body.name,
          body.phone || null,
          inviteType,
        ]
      );
      const userId = userResult.rows[0].id;

      // Create persona_link
      const permissions = inviteType === "attendant"
        ? { canLogVitals: true, canViewHistory: true, canReceiveAlerts: true }
        : { canConfigureThresholds: true, canViewHistory: true, canReceiveAlerts: true };

      await dbClient.query(
        `INSERT INTO persona_links (
          patient_id, linked_user_id, relationship, is_primary,
          can_log_vitals, can_configure_thresholds, can_view_history, can_receive_alerts,
          invited_by, accepted_at, is_active
        ) VALUES ($1, $2, $3, false, $4, $5, $6, $7, $8, NOW(), true)`,
        [
          invite.patient_db_id,
          userId,
          inviteType,
          permissions.canLogVitals || false,
          permissions.canConfigureThresholds || false,
          permissions.canViewHistory || true,
          permissions.canReceiveAlerts || true,
          invite.invited_by,
        ]
      );

      // Update invite status
      const inviteTable = inviteType === "attendant" ? "attendant_invites" : "doctor_invites";
      await dbClient.query(
        `UPDATE ${inviteTable}
         SET status = 'accepted', accepted_by_user_id = $1, accepted_at = NOW()
         WHERE invite_token = $2`,
        [userId, body.token]
      );

      // Create audit log
      await dbClient.query(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
         VALUES ($1, 'ACCEPT_INVITE', $2, $3, $4)`,
        [
          userId,
          inviteType,
          invite.id,
          JSON.stringify({
            patientId: invite.patient_id,
            invitedBy: invite.invited_by,
          }),
        ]
      );

      await dbClient.query("COMMIT");

      console.log(`Invite accepted: ${inviteType} registered for patient ${invite.patient_id}`);

      return {
        statusCode: 201,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Registration successful",
          personaType: inviteType,
          patientId: invite.patient_id,
          patientName: invite.patient_name,
        }),
      };
    } catch (error) {
      await dbClient.query("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error("Error accepting invite:", error);

    if (error.name === "UsernameExistsException") {
      return {
        statusCode: 409,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "An account with this email already exists" }),
      };
    }

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to complete registration" }),
    };
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

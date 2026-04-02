/**
 * CareLog Post-Confirmation Lambda
 *
 * Triggered by Cognito after user confirms their email.
 * Responsibilities:
 * 1. Add user to appropriate Cognito group based on persona_type
 * 2. Create user record in RDS database
 *
 * HIPAA Compliance:
 * - No PHI logged
 * - Secure database connections
 * - Audit trail for user creation
 */

const {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminUpdateUserAttributesCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { Client } = require("pg");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const cognitoClient = new CognitoIdentityProviderClient({});
const secretsClient = new SecretsManagerClient({});

// Cache database credentials
let dbCredentials = null;

/**
 * Get database credentials from Secrets Manager.
 */
async function getDatabaseCredentials() {
  if (dbCredentials) {
    return dbCredentials;
  }

  const secretName = process.env.DB_SECRET_NAME;
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await secretsClient.send(command);
  dbCredentials = JSON.parse(response.SecretString);
  return dbCredentials;
}

/**
 * Create a database connection.
 */
async function createDbConnection() {
  const credentials = await getDatabaseCredentials();

  const client = new Client({
    host: credentials.host,
    port: credentials.port,
    database: credentials.dbname,
    user: credentials.username,
    password: credentials.password,
    ssl: {
      rejectUnauthorized: true,
    },
  });

  await client.connect();
  return client;
}

/**
 * Set custom:persona_type attribute on the user.
 * This ensures the app can read the persona for dashboard routing.
 */
async function setPersonaAttribute(userPoolId, username, personaType) {
  const command = new AdminUpdateUserAttributesCommand({
    UserPoolId: userPoolId,
    Username: username,
    UserAttributes: [
      { Name: "custom:persona_type", Value: personaType },
    ],
  });

  await cognitoClient.send(command);
  console.log(`Set custom:persona_type=${personaType} for user ${username}`);
}

/**
 * Add user to Cognito group based on persona type.
 */
async function addUserToGroup(userPoolId, username, personaType) {
  const groupName = getGroupName(personaType);

  if (!groupName) {
    console.warn(`Unknown persona type: ${personaType}, defaulting to 'relatives'`);
  }

  const command = new AdminAddUserToGroupCommand({
    UserPoolId: userPoolId,
    Username: username,
    GroupName: groupName || "relatives",
  });

  await cognitoClient.send(command);
  console.log(`Added user ${username} to group ${groupName}`);
}

/**
 * Map persona type to Cognito group name.
 */
function getGroupName(personaType) {
  const mapping = {
    patient: "patients",
    attendant: "attendants",
    relative: "relatives",
    doctor: "doctors",
  };
  return mapping[personaType?.toLowerCase()];
}

/**
 * Create user record in RDS database.
 */
async function createUserRecord(client, userData) {
  const query = `
    INSERT INTO users (
      cognito_sub,
      email,
      name,
      phone_number,
      persona_type,
      is_active,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
    ON CONFLICT (cognito_sub) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      phone_number = EXCLUDED.phone_number,
      updated_at = NOW()
    RETURNING id
  `;

  const values = [
    userData.cognitoSub,
    userData.email,
    userData.name,
    userData.phoneNumber || null,
    userData.personaType || "relative",
  ];

  const result = await client.query(query, values);
  console.log(`Created/updated user record with ID: ${result.rows[0].id}`);
  return result.rows[0].id;
}

/**
 * Create audit log entry.
 */
async function createAuditLog(client, userId, cognitoSub, action) {
  const query = `
    INSERT INTO audit_log (
      user_id,
      action,
      resource_type,
      resource_id,
      details,
      created_at
    ) VALUES (
      (SELECT id FROM users WHERE cognito_sub = $1),
      $2,
      'user',
      $3,
      $4,
      NOW()
    )
  `;

  const values = [
    cognitoSub,
    action,
    userId,
    JSON.stringify({ event: "post_confirmation", timestamp: new Date().toISOString() }),
  ];

  await client.query(query, values);
}

/**
 * Lambda handler for Cognito Post-Confirmation trigger.
 */
exports.handler = async (event) => {
  console.log("Post-confirmation trigger received");

  // Only process confirmed sign-ups
  if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") {
    console.log(`Skipping trigger source: ${event.triggerSource}`);
    return event;
  }

  const userPoolId = event.userPoolId;
  const username = event.userName;
  const userAttributes = event.request.userAttributes;

  const userData = {
    cognitoSub: userAttributes.sub,
    email: userAttributes.email,
    name: userAttributes.name || userAttributes.email.split("@")[0],
    phoneNumber: userAttributes.phone_number,
    personaType: userAttributes["custom:persona_type"] || "relative",
  };

  let dbClient = null;

  try {
    // Set custom:persona_type attribute if not already set
    if (!userAttributes["custom:persona_type"]) {
      await setPersonaAttribute(userPoolId, username, userData.personaType);
    }

    // Add user to Cognito group
    await addUserToGroup(userPoolId, username, userData.personaType);

    // Create user record in RDS
    dbClient = await createDbConnection();
    const userId = await createUserRecord(dbClient, userData);

    // Create audit log entry
    await createAuditLog(dbClient, userId, userData.cognitoSub, "CREATE");

    console.log("Post-confirmation processing complete");
  } catch (error) {
    console.error("Error in post-confirmation:", error);
    // Don't throw - allow user creation to succeed
    // Errors here will be logged and can be reconciled later
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }

  return event;
};

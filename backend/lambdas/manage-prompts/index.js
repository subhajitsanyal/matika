/**
 * CareLog Manage Prompts Lambda
 *
 * GET /prompts              — Fetch all conversation prompts (any authenticated user)
 * PUT /prompts/{promptType} — Update a prompt (doctor only)
 *
 * HIPAA Compliance:
 * - All data encrypted in transit and at rest
 * - Access restricted to authenticated users via Cognito
 */

const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secretsClient = new SecretsManagerClient({});
let dbCredentials = null;

const VALID_PROMPT_TYPES = ['patient_logging', 'caregiver_config', 'caregiver_onboarding'];

async function getDatabaseCredentials() {
  if (dbCredentials) return dbCredentials;
  const command = new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_NAME });
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
 * Check if the user is a doctor by persona_type.
 */
async function isUserDoctor(dbClient, cognitoSub) {
  const result = await dbClient.query(
    `SELECT persona_type FROM users WHERE cognito_sub = $1`,
    [cognitoSub]
  );
  if (result.rows.length === 0) return false;
  return result.rows[0].persona_type === 'doctor';
}

/**
 * GET — Fetch all conversation prompts grouped by type.
 */
async function listPrompts(dbClient) {
  const result = await dbClient.query(
    `SELECT prompt_type, system_prompt, version, updated_at
     FROM conversation_prompts
     ORDER BY prompt_type`
  );

  const prompts = {};
  for (const row of result.rows) {
    prompts[row.prompt_type] = {
      version: row.version,
      system_prompt: row.system_prompt,
      updated_at: row.updated_at,
    };
  }

  return successResponse(200, { prompts });
}

/**
 * PUT — Update a prompt's system_prompt text and bump version.
 */
async function updatePrompt(dbClient, event) {
  const promptType = event.pathParameters?.promptType;
  if (!promptType) {
    return errorResponse(400, 'Prompt type required');
  }

  if (!VALID_PROMPT_TYPES.includes(promptType)) {
    return errorResponse(400, `Invalid prompt type. Must be one of: ${VALID_PROMPT_TYPES.join(', ')}`);
  }

  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  const { system_prompt } = body || {};

  if (!system_prompt || typeof system_prompt !== 'string') {
    return errorResponse(400, 'Missing required field: system_prompt (string)');
  }

  // Get current version and bump
  const existing = await dbClient.query(
    `SELECT version FROM conversation_prompts WHERE prompt_type = $1`,
    [promptType]
  );

  let newVersion;
  if (existing.rows.length > 0) {
    const currentVersion = existing.rows[0].version || '1.0';
    const parts = currentVersion.split('.');
    const major = parseInt(parts[0], 10) || 1;
    const minor = (parseInt(parts[1], 10) || 0) + 1;
    newVersion = `${major}.${minor}`;

    await dbClient.query(
      `UPDATE conversation_prompts
       SET system_prompt = $1, version = $2, updated_at = NOW()
       WHERE prompt_type = $3`,
      [system_prompt, newVersion, promptType]
    );
  } else {
    newVersion = '1.0';
    await dbClient.query(
      `INSERT INTO conversation_prompts (prompt_type, system_prompt, version, updated_at)
       VALUES ($1, $2, $3, NOW())`,
      [promptType, system_prompt, newVersion]
    );
  }

  return successResponse(200, {
    prompt_type: promptType,
    version: newVersion,
    system_prompt,
    message: 'Prompt updated successfully',
  });
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log('Manage prompts request:', event.httpMethod, event.path);

  const claims = event.requestContext?.authorizer?.claims || {};
  const cognitoSub = claims.sub;

  if (!cognitoSub) {
    return errorResponse(401, 'Unauthorized');
  }

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    const httpMethod = event.httpMethod || event.requestContext?.http?.method;

    switch (httpMethod) {
      case 'GET':
        return await listPrompts(dbClient);

      case 'PUT': {
        const isDoctor = await isUserDoctor(dbClient, cognitoSub);
        if (!isDoctor) {
          return errorResponse(403, 'Only doctors can update prompts');
        }
        return await updatePrompt(dbClient, event);
      }

      default:
        return errorResponse(405, 'Method not allowed');
    }
  } catch (error) {
    console.error('Error managing prompts:', error);
    return errorResponse(500, 'Internal server error');
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

function successResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ error: message }),
  };
}

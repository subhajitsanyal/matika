/**
 * CareLog Manage Parameter Configs Lambda
 *
 * GET    /patients/{patientId}/parameter-configs        — List active configs (caregiver or doctor)
 * POST   /patients/{patientId}/parameter-configs        — Create config (caregiver or doctor)
 * PUT    /patients/{patientId}/parameter-configs/{id}   — Update config (caregiver or doctor)
 * DELETE /patients/{patientId}/parameter-configs/{id}   — Soft delete (caregiver or doctor)
 *
 * HIPAA Compliance:
 * - All PHI encrypted in transit and at rest
 * - Access restricted to authorized users via Cognito + persona_links
 */

const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secretsClient = new SecretsManagerClient({});
let dbCredentials = null;

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

async function resolvePatientDbId(dbClient, patientIdParam) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(patientIdParam)) {
    const result = await dbClient.query(
      `SELECT id, patient_id FROM patients WHERE id = $1`,
      [patientIdParam]
    );
    if (result.rows.length > 0) return result.rows[0];
  }

  const result = await dbClient.query(
    `SELECT id, patient_id FROM patients WHERE patient_id = $1`,
    [patientIdParam]
  );
  if (result.rows.length > 0) return result.rows[0];
  return null;
}

/**
 * Check if user is a caregiver or doctor linked to the patient.
 * Returns { hasAccess, isDoctor, userId (DB id) }
 */
async function checkAccessAndRole(dbClient, cognitoSub, patientDbId) {
  const userResult = await dbClient.query(
    `SELECT id, persona_type FROM users WHERE cognito_sub = $1`,
    [cognitoSub]
  );
  if (userResult.rows.length === 0) {
    return { hasAccess: false, isDoctor: false, userId: null };
  }

  const user = userResult.rows[0];
  const isDoctor = user.persona_type === 'doctor';

  const linkCheck = await dbClient.query(
    `SELECT 1 FROM persona_links
     WHERE linked_user_id = $1 AND patient_id = $2 AND is_active = true`,
    [user.id, patientDbId]
  );

  if (linkCheck.rows.length > 0) {
    return { hasAccess: true, isDoctor, userId: user.id };
  }

  // Check if user is the patient themselves (patients cannot manage configs)
  return { hasAccess: false, isDoctor: false, userId: user.id };
}

/**
 * GET — List active parameter configs for a patient.
 */
async function listParameterConfigs(dbClient, patientDbId) {
  const result = await dbClient.query(
    `SELECT
       pc.id,
       pc.parameter_name,
       pc.display_name,
       pc.loinc_codes,
       pc.unit,
       pc.frequency_days,
       pc.daily_deadline,
       pc.timezone,
       pc.threshold_min,
       pc.threshold_max,
       pc.threshold_set_by,
       pc.active,
       pc.created_at,
       pc.updated_at
     FROM parameter_configs pc
     WHERE pc.patient_id = $1 AND pc.active = true
     ORDER BY pc.created_at`,
    [patientDbId]
  );

  return successResponse(200, { parameter_configs: result.rows });
}

/**
 * POST — Create a new parameter config.
 */
async function createParameterConfig(dbClient, event, patientDbId, userId, isDoctor) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

  const {
    parameter_name,
    display_name,
    loinc_codes,
    unit,
    frequency_days,
    daily_deadline,
    timezone,
    threshold_min,
    threshold_max,
  } = body || {};

  // Validate required fields
  if (!parameter_name || !display_name || !loinc_codes || !unit || frequency_days === undefined) {
    return errorResponse(400, 'Missing required fields: parameter_name, display_name, loinc_codes, unit, frequency_days');
  }

  const thresholdSetBy = (threshold_min !== undefined || threshold_max !== undefined) && isDoctor
    ? userId
    : null;

  const result = await dbClient.query(
    `INSERT INTO parameter_configs
       (patient_id, parameter_name, display_name, loinc_codes, unit, frequency_days,
        daily_deadline, timezone, threshold_min, threshold_max, threshold_set_by, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
     RETURNING *`,
    [
      patientDbId,
      parameter_name,
      display_name,
      typeof loinc_codes === 'string' ? loinc_codes : JSON.stringify(loinc_codes),
      unit,
      frequency_days,
      daily_deadline || null,
      timezone || null,
      threshold_min !== undefined ? threshold_min : null,
      threshold_max !== undefined ? threshold_max : null,
      thresholdSetBy,
    ]
  );

  return successResponse(201, result.rows[0]);
}

/**
 * PUT — Update a parameter config.
 */
async function updateParameterConfig(dbClient, event, patientDbId, userId, isDoctor) {
  const configId = event.pathParameters?.configId || event.pathParameters?.id;
  if (!configId) {
    return errorResponse(400, 'Config ID required');
  }

  // Verify config belongs to this patient
  const existing = await dbClient.query(
    `SELECT id FROM parameter_configs WHERE id = $1 AND patient_id = $2`,
    [configId, patientDbId]
  );
  if (existing.rows.length === 0) {
    return errorResponse(404, 'Parameter config not found');
  }

  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  if (!body || Object.keys(body).length === 0) {
    return errorResponse(400, 'Request body is empty');
  }

  // Build dynamic update
  const updates = [];
  const values = [];
  let paramIdx = 1;

  const allowedFields = [
    'parameter_name', 'display_name', 'loinc_codes', 'unit', 'frequency_days',
    'daily_deadline', 'timezone', 'threshold_min', 'threshold_max',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      let value = body[field];
      if (field === 'loinc_codes' && typeof value !== 'string') {
        value = JSON.stringify(value);
      }
      updates.push(`${field} = $${paramIdx}`);
      values.push(value);
      paramIdx++;
    }
  }

  // If doctor updates thresholds, update threshold_set_by
  if (isDoctor && (body.threshold_min !== undefined || body.threshold_max !== undefined)) {
    updates.push(`threshold_set_by = $${paramIdx}`);
    values.push(userId);
    paramIdx++;
  }

  updates.push(`updated_at = NOW()`);

  values.push(configId);
  values.push(patientDbId);

  const result = await dbClient.query(
    `UPDATE parameter_configs
     SET ${updates.join(', ')}
     WHERE id = $${paramIdx} AND patient_id = $${paramIdx + 1}
     RETURNING *`,
    values
  );

  return successResponse(200, result.rows[0]);
}

/**
 * DELETE — Soft delete a parameter config.
 */
async function deleteParameterConfig(dbClient, event, patientDbId) {
  const configId = event.pathParameters?.configId || event.pathParameters?.id;
  if (!configId) {
    return errorResponse(400, 'Config ID required');
  }

  const result = await dbClient.query(
    `UPDATE parameter_configs
     SET active = false, updated_at = NOW()
     WHERE id = $1 AND patient_id = $2
     RETURNING id, active`,
    [configId, patientDbId]
  );

  if (result.rows.length === 0) {
    return errorResponse(404, 'Parameter config not found');
  }

  return successResponse(200, { message: 'Parameter config deactivated', id: result.rows[0].id });
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log('Manage parameter-configs request:', event.httpMethod, event.path);

  const claims = event.requestContext?.authorizer?.claims || {};
  const cognitoSub = claims.sub;

  if (!cognitoSub) {
    return errorResponse(401, 'Unauthorized');
  }

  const patientIdParam = event.pathParameters?.patientId;
  if (!patientIdParam) {
    return errorResponse(400, 'Patient ID required');
  }

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    const patient = await resolvePatientDbId(dbClient, patientIdParam);
    if (!patient) {
      return errorResponse(404, 'Patient not found');
    }

    const patientDbId = patient.id;
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;

    const access = await checkAccessAndRole(dbClient, cognitoSub, patientDbId);
    if (!access.hasAccess) {
      return errorResponse(403, 'Access denied');
    }

    switch (httpMethod) {
      case 'GET':
        return await listParameterConfigs(dbClient, patientDbId);

      case 'POST':
        return await createParameterConfig(dbClient, event, patientDbId, access.userId, access.isDoctor);

      case 'PUT':
        return await updateParameterConfig(dbClient, event, patientDbId, access.userId, access.isDoctor);

      case 'DELETE':
        return await deleteParameterConfig(dbClient, event, patientDbId);

      default:
        return errorResponse(405, 'Method not allowed');
    }
  } catch (error) {
    console.error('Error managing parameter configs:', error);
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

/**
 * CareLog Manage Recommendations Lambda
 *
 * GET  /patients/{patientId}/recommendations       — List recommendations (caregiver or doctor)
 * POST /patients/{patientId}/recommendations       — Create recommendation (doctor only)
 * PUT  /patients/{patientId}/recommendations/{id}  — Accept/reject recommendation (caregiver)
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

/**
 * Resolve patientId path parameter to the internal patient DB UUID.
 */
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
 * Returns { hasAccess, isDoctor, isCaregiverOrAttendant, userId (DB id) }
 */
async function checkAccessAndRole(dbClient, cognitoSub, patientDbId) {
  // Get user record
  const userResult = await dbClient.query(
    `SELECT id, persona_type FROM users WHERE cognito_sub = $1`,
    [cognitoSub]
  );
  if (userResult.rows.length === 0) {
    return { hasAccess: false, isDoctor: false, isCaregiverOrAttendant: false, userId: null };
  }

  const user = userResult.rows[0];
  const isDoctor = user.persona_type === 'doctor';

  // Check if linked to patient via persona_links
  const linkCheck = await dbClient.query(
    `SELECT 1 FROM persona_links
     WHERE linked_user_id = $1 AND patient_id = $2 AND is_active = true`,
    [user.id, patientDbId]
  );

  if (linkCheck.rows.length > 0) {
    return {
      hasAccess: true,
      isDoctor,
      isCaregiverOrAttendant: !isDoctor,
      userId: user.id,
    };
  }

  // Check if user is the patient themselves
  const patientCheck = await dbClient.query(
    `SELECT 1 FROM patients WHERE id = $1 AND user_id = $2`,
    [patientDbId, user.id]
  );
  if (patientCheck.rows.length > 0) {
    return {
      hasAccess: true,
      isDoctor: false,
      isCaregiverOrAttendant: false,
      userId: user.id,
    };
  }

  return { hasAccess: false, isDoctor: false, isCaregiverOrAttendant: false, userId: user.id };
}

/**
 * GET — List recommendations for a patient.
 */
async function listRecommendations(dbClient, patientDbId) {
  const result = await dbClient.query(
    `SELECT
       r.id,
       r.source,
       r.source_doctor_id,
       r.parameter_name,
       r.loinc_code,
       r.rationale,
       r.suggested_frequency_days,
       r.status,
       r.resolved_at,
       r.resolved_by,
       r.created_at,
       r.updated_at
     FROM recommendations r
     WHERE r.patient_id = $1
     ORDER BY r.created_at DESC`,
    [patientDbId]
  );

  return successResponse(200, { recommendations: result.rows });
}

/**
 * POST — Create a recommendation (doctor only).
 */
async function createRecommendation(dbClient, event, patientDbId, userId) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

  const { parameter_name, loinc_code, rationale, suggested_frequency_days } = body || {};

  if (!parameter_name) {
    return errorResponse(400, 'Missing required field: parameter_name');
  }

  const result = await dbClient.query(
    `INSERT INTO recommendations
       (patient_id, source, source_doctor_id, parameter_name, loinc_code, rationale, suggested_frequency_days, status)
     VALUES ($1, 'doctor', $2, $3, $4, $5, $6, 'pending')
     RETURNING *`,
    [patientDbId, userId, parameter_name, loinc_code || null, rationale || null, suggested_frequency_days || null]
  );

  return successResponse(201, result.rows[0]);
}

/**
 * PUT — Accept or reject a recommendation (caregiver).
 */
async function updateRecommendation(dbClient, event, patientDbId, userId) {
  const recommendationId = event.pathParameters?.recommendationId || event.pathParameters?.id;
  if (!recommendationId) {
    return errorResponse(400, 'Recommendation ID required');
  }

  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  const { status } = body || {};

  if (!status || !['accepted', 'rejected'].includes(status)) {
    return errorResponse(400, 'Status must be "accepted" or "rejected"');
  }

  // Verify recommendation belongs to this patient
  const existing = await dbClient.query(
    `SELECT id, parameter_name, loinc_code, suggested_frequency_days FROM recommendations
     WHERE id = $1 AND patient_id = $2`,
    [recommendationId, patientDbId]
  );

  if (existing.rows.length === 0) {
    return errorResponse(404, 'Recommendation not found');
  }

  const result = await dbClient.query(
    `UPDATE recommendations
     SET status = $1, resolved_at = NOW(), resolved_by = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [status, userId, recommendationId]
  );

  // If accepted, optionally auto-create a parameter_config
  if (status === 'accepted') {
    const rec = existing.rows[0];
    try {
      await dbClient.query(
        `INSERT INTO parameter_configs
           (patient_id, parameter_name, display_name, loinc_codes, unit, frequency_days, active)
         VALUES ($1, $2, $3, $4, '', $5, true)
         ON CONFLICT DO NOTHING`,
        [
          patientDbId,
          rec.parameter_name,
          rec.parameter_name,
          rec.loinc_code ? JSON.stringify([rec.loinc_code]) : '[]',
          rec.suggested_frequency_days || 1,
        ]
      );
    } catch (err) {
      console.warn('Auto-create parameter_config skipped:', err.message);
    }
  }

  return successResponse(200, result.rows[0]);
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log('Manage recommendations request:', event.httpMethod, event.path);

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
        return await listRecommendations(dbClient, patientDbId);

      case 'POST':
        if (!access.isDoctor) {
          return errorResponse(403, 'Only doctors can create recommendations');
        }
        return await createRecommendation(dbClient, event, patientDbId, access.userId);

      case 'PUT':
        if (!access.isCaregiverOrAttendant) {
          return errorResponse(403, 'Only caregivers can accept/reject recommendations');
        }
        return await updateRecommendation(dbClient, event, patientDbId, access.userId);

      default:
        return errorResponse(405, 'Method not allowed');
    }
  } catch (error) {
    console.error('Error managing recommendations:', error);
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

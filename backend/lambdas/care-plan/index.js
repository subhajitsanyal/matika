/**
 * Care Plan Lambda
 *
 * CRUD operations for patient care plans (FHIR CarePlan resources).
 * Doctors can create and update care plans with version history.
 */

const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');

const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
};

const HEALTHLAKE_ENDPOINT = process.env.HEALTHLAKE_ENDPOINT;

exports.handler = async (event) => {
  console.log('Care plan request:', event.httpMethod, event.path);

  const client = new Client(dbConfig);

  try {
    await client.connect();

    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;
    const userName = claims.name || 'Unknown';
    const userGroups = (claims['cognito:groups'] || '').split(',').map((g) => g.trim());

    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    if (!userGroups.includes('doctors')) {
      return errorResponse(403, 'Only doctors can manage care plans');
    }

    const patientId = event.pathParameters?.patientId;

    if (!patientId) {
      return errorResponse(400, 'Patient ID required');
    }

    // Verify doctor has access to patient
    const hasAccess = await checkAccess(client, userId, patientId);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied');
    }

    const path = event.path || '';

    switch (httpMethod) {
      case 'GET':
        if (path.endsWith('/history')) {
          return await getCarePlanHistory(client, patientId);
        }
        return await getCarePlan(client, patientId);
      case 'PUT':
        return await saveCarePlan(client, event, patientId, userId, userName);
      default:
        return errorResponse(405, 'Method not allowed');
    }
  } catch (error) {
    console.error('Error:', error);
    return errorResponse(500, 'Internal server error');
  } finally {
    await client.end();
  }
};

/**
 * Get current care plan for patient.
 */
async function getCarePlan(client, patientId) {
  const result = await client.query(
    `SELECT
       id,
       content,
       updated_at,
       updated_by_name as updated_by,
       version
     FROM care_plans
     WHERE patient_id = $1 AND is_current = true`,
    [patientId]
  );

  if (result.rows.length === 0) {
    return errorResponse(404, 'No care plan found');
  }

  const carePlan = result.rows[0];

  return successResponse(200, {
    id: carePlan.id,
    content: carePlan.content,
    updatedAt: carePlan.updated_at,
    updatedBy: carePlan.updated_by,
    version: carePlan.version,
  });
}

/**
 * Get care plan version history.
 */
async function getCarePlanHistory(client, patientId) {
  const result = await client.query(
    `SELECT
       id,
       content,
       updated_at,
       updated_by_name as updated_by,
       version
     FROM care_plans
     WHERE patient_id = $1
     ORDER BY version DESC
     LIMIT 20`,
    [patientId]
  );

  const versions = result.rows.map((row) => ({
    id: row.id,
    content: row.content,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    version: row.version,
  }));

  return successResponse(200, { versions });
}

/**
 * Create or update care plan.
 */
async function saveCarePlan(client, event, patientId, userId, userName) {
  const body = JSON.parse(event.body || '{}');
  const { content } = body;

  if (!content || typeof content !== 'string') {
    return errorResponse(400, 'Content is required');
  }

  // Mark existing care plan as not current
  await client.query(
    `UPDATE care_plans SET is_current = false WHERE patient_id = $1 AND is_current = true`,
    [patientId]
  );

  // Get current max version
  const versionResult = await client.query(
    `SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM care_plans WHERE patient_id = $1`,
    [patientId]
  );
  const nextVersion = versionResult.rows[0].next_version;

  // Insert new care plan
  const id = uuidv4();
  const result = await client.query(
    `INSERT INTO care_plans (
       id,
       patient_id,
       content,
       updated_by,
       updated_by_name,
       version,
       is_current,
       created_at,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
     RETURNING id, content, updated_at, updated_by_name as updated_by, version`,
    [id, patientId, content, userId, userName, nextVersion]
  );

  const carePlan = result.rows[0];

  // Create FHIR CarePlan resource
  await createFhirCarePlan(patientId, carePlan);

  // Log audit event
  await client.query(
    `INSERT INTO audit_log (
       action,
       resource_type,
       resource_id,
       user_id,
       actor_role,
       patient_id,
       details,
       created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      nextVersion === 1 ? 'CREATE' : 'UPDATE',
      'CarePlan',
      id,
      userId,
      'doctor',
      patientId,
      JSON.stringify({ version: nextVersion }),
    ]
  );

  return successResponse(200, {
    id: carePlan.id,
    content: carePlan.content,
    updatedAt: carePlan.updated_at,
    updatedBy: carePlan.updated_by,
    version: carePlan.version,
  });
}

/**
 * Create FHIR CarePlan resource in HealthLake.
 */
async function createFhirCarePlan(patientId, carePlan) {
  const fhirResource = {
    resourceType: 'CarePlan',
    id: carePlan.id,
    status: 'active',
    intent: 'plan',
    subject: {
      reference: `Patient/${patientId}`,
    },
    description: carePlan.content,
    created: new Date().toISOString(),
    author: {
      display: carePlan.updated_by,
    },
  };

  // Note: In production, POST to HealthLake endpoint
  console.log('Creating FHIR CarePlan:', fhirResource);

  return fhirResource;
}

/**
 * Check if doctor has access to patient.
 */
async function checkAccess(client, userId, patientId) {
  const result = await client.query(
    `SELECT 1 FROM persona_links
     WHERE user_id = $1 AND patient_id = $2 AND role = 'doctor' AND status = 'active'`,
    [userId, patientId]
  );
  return result.rows.length > 0;
}

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

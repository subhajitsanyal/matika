/**
 * Audit Log Lambda
 *
 * API endpoints for viewing audit logs.
 * Tracks all FHIR write operations and system events.
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

// Audit action types
const ACTION_TYPES = ['CREATE', 'UPDATE', 'DELETE', 'READ', 'LOGIN', 'LOGOUT'];

// Resource types
const RESOURCE_TYPES = [
  'Observation',
  'DocumentReference',
  'Threshold',
  'ReminderConfig',
  'CarePlan',
  'Patient',
  'User',
  'Session',
];

exports.handler = async (event) => {
  console.log('Audit log request:', event.httpMethod, event.path);

  const client = await createDbConnection();

  try {
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;
    const userGroups = (claims['cognito:groups'] || '').split(',').map((g) => g.trim());

    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    const patientId = event.pathParameters?.patientId;

    if (!patientId) {
      return errorResponse(400, 'Patient ID required');
    }

    // Check access - only relatives and doctors can view audit logs
    const hasAccess = await checkAuditAccess(client, userId, patientId, userGroups);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied');
    }

    switch (httpMethod) {
      case 'GET':
        return await getAuditLogs(client, event, patientId);
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
 * Get audit logs for a patient.
 */
async function getAuditLogs(client, event, patientId) {
  const queryParams = event.queryStringParameters || {};

  // Pagination
  const limit = Math.min(parseInt(queryParams.limit) || 50, 100);
  const offset = parseInt(queryParams.offset) || 0;

  // Filters
  const actorId = queryParams.actorId;
  const actorRole = queryParams.actorRole;
  const action = queryParams.action;
  const resourceType = queryParams.resourceType;
  const startDate = queryParams.startDate;
  const endDate = queryParams.endDate;

  let query = `
    SELECT
      al.id,
      al.action,
      al.resource_type,
      al.resource_id,
      al.user_id as actor_id,
      al.actor_role,
      al.details,
      al.created_at as timestamp,
      u.name as actor_name
    FROM audit_log al
    LEFT JOIN users u ON u.cognito_sub = al.user_id
    WHERE al.patient_id = $1
  `;

  const params = [patientId];
  let paramIndex = 2;

  // Apply filters
  if (actorId) {
    query += ` AND al.user_id = $${paramIndex}`;
    params.push(actorId);
    paramIndex++;
  }

  if (actorRole) {
    query += ` AND al.actor_role = $${paramIndex}`;
    params.push(actorRole);
    paramIndex++;
  }

  if (action) {
    query += ` AND al.action = $${paramIndex}`;
    params.push(action);
    paramIndex++;
  }

  if (resourceType) {
    query += ` AND al.resource_type = $${paramIndex}`;
    params.push(resourceType);
    paramIndex++;
  }

  if (startDate) {
    query += ` AND al.created_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    query += ` AND al.created_at <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }

  // Order and pagination
  query += ` ORDER BY al.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const result = await client.query(query, params);

  // Get total count
  let countQuery = `SELECT COUNT(*) as total FROM audit_log WHERE patient_id = $1`;
  const countParams = [patientId];

  const countResult = await client.query(countQuery, countParams);

  // Get unique actors for filter dropdown
  const actorsResult = await client.query(
    `SELECT DISTINCT al.user_id, u.name, al.actor_role
     FROM audit_log al
     LEFT JOIN users u ON u.cognito_sub = al.user_id
     WHERE al.patient_id = $1
     ORDER BY u.name`,
    [patientId]
  );

  const logs = result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    actorId: row.actor_id,
    actorName: row.actor_name || 'Unknown',
    actorRole: row.actor_role,
    details: row.details,
    timestamp: row.timestamp,
  }));

  const actors = actorsResult.rows.map((row) => ({
    id: row.user_id,
    name: row.name || 'Unknown',
    role: row.actor_role,
  }));

  return successResponse(200, {
    logs,
    total: parseInt(countResult.rows[0].total),
    limit,
    offset,
    actors,
    filters: {
      actions: ACTION_TYPES,
      resourceTypes: RESOURCE_TYPES,
    },
  });
}

/**
 * Check if user has access to view audit logs.
 */
async function checkAuditAccess(client, userId, patientId, userGroups) {
  // Doctors can always view audit logs for their patients
  if (userGroups.includes('doctors')) {
    const doctorAccess = await client.query(
      `SELECT 1 FROM persona_links
       WHERE user_id = $1 AND patient_id = $2 AND status = 'active' AND role = 'doctor'`,
      [userId, patientId]
    );
    if (doctorAccess.rows.length > 0) {
      return true;
    }
  }

  // Relatives can view audit logs
  if (userGroups.includes('relatives')) {
    const relativeAccess = await client.query(
      `SELECT 1 FROM persona_links
       WHERE user_id = $1 AND patient_id = $2 AND status = 'active' AND role = 'relative'`,
      [userId, patientId]
    );
    if (relativeAccess.rows.length > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Log an audit event (utility function for other lambdas).
 */
async function logAuditEvent(client, event) {
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
      event.action,
      event.resourceType,
      event.resourceId,
      event.userId,
      event.actorRole,
      event.patientId,
      JSON.stringify(event.details || {}),
    ]
  );
}

/**
 * Success response helper.
 */
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

/**
 * Error response helper.
 */
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

// Export for use by other lambdas
module.exports.logAuditEvent = logAuditEvent;

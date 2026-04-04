/**
 * Doctor Patients Lambda
 *
 * API endpoints for doctor to view assigned patients.
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

exports.handler = async (event) => {
  console.log('Doctor patients request:', event.httpMethod, event.path);

  const client = await createDbConnection();

  try {
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;
    const userGroups = (claims['cognito:groups'] || '').split(',').map((g) => g.trim());

    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    // Only doctors can access this endpoint
    if (!userGroups.includes('doctors')) {
      return errorResponse(403, 'Access denied. Doctors only.');
    }

    const patientId = event.pathParameters?.patientId;

    switch (httpMethod) {
      case 'GET':
        if (patientId) {
          return await getPatientDetails(client, userId, patientId);
        } else {
          return await getPatients(client, userId);
        }
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
 * Get list of patients assigned to doctor.
 */
async function getPatients(client, doctorId) {
  const result = await client.query(
    `SELECT
       p.id,
       p.name,
       p.age,
       p.gender,
       (
         SELECT MAX(o.created_at)
         FROM observations o
         WHERE o.patient_id = p.id
       ) as last_activity,
       (
         SELECT COUNT(*)
         FROM alerts a
         LEFT JOIN alert_reads ar ON ar.alert_id = a.id AND ar.user_id = $1
         WHERE a.patient_id = p.id AND ar.id IS NULL AND a.deleted_at IS NULL
       ) as unread_alerts
     FROM patients p
     INNER JOIN persona_links pl ON pl.patient_id = p.id
     WHERE pl.user_id = $1 AND pl.role = 'doctor' AND pl.status = 'active'
     ORDER BY p.name`,
    [doctorId]
  );

  const patients = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    age: row.age,
    gender: row.gender,
    lastActivity: row.last_activity,
    unreadAlerts: parseInt(row.unread_alerts) || 0,
  }));

  return successResponse(200, { patients });
}

/**
 * Get detailed patient information.
 */
async function getPatientDetails(client, doctorId, patientId) {
  // Verify doctor has access to this patient
  const accessCheck = await client.query(
    `SELECT 1 FROM persona_links
     WHERE user_id = $1 AND patient_id = $2 AND role = 'doctor' AND status = 'active'`,
    [doctorId, patientId]
  );

  if (accessCheck.rows.length === 0) {
    return errorResponse(403, 'Access denied to this patient');
  }

  const result = await client.query(
    `SELECT
       p.id,
       p.name,
       p.age,
       p.gender,
       p.conditions,
       p.created_at,
       (
         SELECT MAX(o.created_at)
         FROM observations o
         WHERE o.patient_id = p.id
       ) as last_activity
     FROM patients p
     WHERE p.id = $1`,
    [patientId]
  );

  if (result.rows.length === 0) {
    return errorResponse(404, 'Patient not found');
  }

  const patient = result.rows[0];

  return successResponse(200, {
    id: patient.id,
    name: patient.name,
    age: patient.age,
    gender: patient.gender,
    conditions: patient.conditions || [],
    createdAt: patient.created_at,
    lastActivity: patient.last_activity,
  });
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

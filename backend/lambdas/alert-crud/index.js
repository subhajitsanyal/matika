/**
 * Alert CRUD Lambda
 *
 * API endpoints for managing alerts for relatives.
 * Alerts include threshold breaches and reminder lapses.
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

// Alert types
const ALERT_TYPES = ['THRESHOLD_BREACH', 'REMINDER_LAPSE', 'SYSTEM'];

exports.handler = async (event) => {
  console.log('Alert CRUD request:', event.httpMethod, event.path);

  const client = await createDbConnection();

  try {
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;

    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    const patientId = event.pathParameters?.patientId;
    const alertId = event.pathParameters?.alertId;

    // For patient-specific routes
    if (patientId) {
      const hasAccess = await checkPatientAccess(client, userId, patientId);
      if (!hasAccess) {
        return errorResponse(403, 'Access denied');
      }
    }

    switch (httpMethod) {
      case 'GET':
        if (patientId) {
          return await getAlerts(client, event, patientId, userId);
        }
        return errorResponse(400, 'Patient ID required');

      case 'PATCH':
        if (alertId) {
          return await updateAlert(client, event, alertId, userId);
        }
        return errorResponse(400, 'Alert ID required');

      case 'DELETE':
        if (alertId) {
          return await deleteAlert(client, alertId, userId);
        }
        return errorResponse(400, 'Alert ID required');

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
 * Get alerts for a patient.
 */
async function getAlerts(client, event, patientId, userId) {
  const queryParams = event.queryStringParameters || {};
  const unreadOnly = queryParams.unreadOnly === 'true';
  const limit = Math.min(parseInt(queryParams.limit) || 50, 100);
  const offset = parseInt(queryParams.offset) || 0;

  let query = `
    SELECT
      a.id,
      a.alert_type,
      a.vital_type,
      a.value,
      a.message,
      a.created_at as timestamp,
      ar.read_at IS NOT NULL as read
    FROM alerts a
    LEFT JOIN alert_reads ar ON a.id = ar.alert_id AND ar.user_id = $2
    WHERE a.patient_id = $1
  `;

  const params = [patientId, userId];

  if (unreadOnly) {
    query += ` AND ar.read_at IS NULL`;
  }

  query += ` ORDER BY a.created_at DESC LIMIT $3 OFFSET $4`;
  params.push(limit, offset);

  const result = await client.query(query, params);

  // Get total count
  const countResult = await client.query(
    `SELECT COUNT(*) as total FROM alerts WHERE patient_id = $1`,
    [patientId]
  );

  const unreadCountResult = await client.query(
    `SELECT COUNT(*) as unread
     FROM alerts a
     LEFT JOIN alert_reads ar ON a.id = ar.alert_id AND ar.user_id = $2
     WHERE a.patient_id = $1 AND ar.read_at IS NULL`,
    [patientId, userId]
  );

  const alerts = result.rows.map((row) => ({
    id: row.id,
    alertType: row.alert_type,
    vitalType: row.vital_type,
    value: row.value,
    message: row.message,
    timestamp: row.timestamp,
    read: row.read || false,
  }));

  return successResponse(200, {
    alerts,
    total: parseInt(countResult.rows[0].total),
    unreadCount: parseInt(unreadCountResult.rows[0].unread),
    limit,
    offset,
  });
}

/**
 * Update an alert (mark as read/unread).
 */
async function updateAlert(client, event, alertId, userId) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

  // Verify user has access to this alert
  const alertResult = await client.query(
    `SELECT a.patient_id FROM alerts a WHERE a.id = $1`,
    [alertId]
  );

  if (alertResult.rows.length === 0) {
    return errorResponse(404, 'Alert not found');
  }

  const patientId = alertResult.rows[0].patient_id;
  const hasAccess = await checkPatientAccess(client, userId, patientId);
  if (!hasAccess) {
    return errorResponse(403, 'Access denied');
  }

  // Handle read status update
  if (body.read !== undefined) {
    if (body.read) {
      // Mark as read
      await client.query(
        `INSERT INTO alert_reads (alert_id, user_id, read_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (alert_id, user_id) DO UPDATE SET read_at = NOW()`,
        [alertId, userId]
      );
    } else {
      // Mark as unread
      await client.query(
        `DELETE FROM alert_reads WHERE alert_id = $1 AND user_id = $2`,
        [alertId, userId]
      );
    }
  }

  return successResponse(200, { message: 'Alert updated successfully' });
}

/**
 * Delete an alert.
 */
async function deleteAlert(client, alertId, userId) {
  // Verify user has access to this alert
  const alertResult = await client.query(
    `SELECT a.patient_id FROM alerts a WHERE a.id = $1`,
    [alertId]
  );

  if (alertResult.rows.length === 0) {
    return errorResponse(404, 'Alert not found');
  }

  const patientId = alertResult.rows[0].patient_id;
  const hasAccess = await checkPatientAccess(client, userId, patientId);
  if (!hasAccess) {
    return errorResponse(403, 'Access denied');
  }

  // Soft delete by setting deleted_at
  await client.query(
    `UPDATE alerts SET deleted_at = NOW() WHERE id = $1`,
    [alertId]
  );

  return successResponse(200, { message: 'Alert deleted successfully' });
}

/**
 * Mark all alerts as read for a patient.
 */
async function markAllAsRead(client, patientId, userId) {
  await client.query(
    `INSERT INTO alert_reads (alert_id, user_id, read_at)
     SELECT a.id, $2, NOW()
     FROM alerts a
     LEFT JOIN alert_reads ar ON a.id = ar.alert_id AND ar.user_id = $2
     WHERE a.patient_id = $1 AND ar.read_at IS NULL
     ON CONFLICT (alert_id, user_id) DO UPDATE SET read_at = NOW()`,
    [patientId, userId]
  );

  return successResponse(200, { message: 'All alerts marked as read' });
}

/**
 * Check if user has access to patient data.
 */
async function checkPatientAccess(client, userId, patientId) {
  const result = await client.query(
    `SELECT 1 FROM persona_links
     WHERE user_id = $1 AND patient_id = $2 AND status = 'active'`,
    [userId, patientId]
  );

  if (result.rows.length > 0) {
    return true;
  }

  // Check if user is the patient
  const patientResult = await client.query(
    `SELECT 1 FROM users WHERE id = $1 AND cognito_sub = $2`,
    [patientId, userId]
  );

  return patientResult.rows.length > 0;
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

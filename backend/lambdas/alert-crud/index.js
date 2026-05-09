/**
 * Alert CRUD Lambda
 *
 * API endpoints for managing alerts addressed to a caregiver / relative.
 * Alerts include threshold breaches and reminder lapses.
 *
 * Schema notes (V001):
 *   - `alerts` carries `recipient_user_id` (single recipient per row),
 *     `is_read` + `read_at` for read state, and `vital_value` / `vital_unit` /
 *     `threshold_min` / `threshold_max` for the breach detail.
 *   - There is no `alert_reads` join table and no `deleted_at` soft-delete
 *     column. Earlier versions of this Lambda referenced both; both have been
 *     removed (F13).
 *   - Access to alerts is gated through `persona_links.linked_user_id`
 *     (UUID = users.id) + `persona_links.is_active = true`. The lambda's
 *     incoming `userId` is the Cognito `sub`; we resolve to `users.id` first.
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
  console.log('Alert CRUD request:', event.httpMethod, event.path);

  const client = await createDbConnection();

  try {
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    const claims = event.requestContext?.authorizer?.claims || {};
    const cognitoSub = claims.sub;

    if (!cognitoSub) {
      return errorResponse(401, 'Unauthorized');
    }

    const userId = await resolveUserIdFromCognitoSub(client, cognitoSub);
    if (!userId) {
      return errorResponse(401, 'User not found');
    }

    const patientId = event.pathParameters?.patientId;
    const alertId = event.pathParameters?.alertId;

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
 * Get alerts for a patient that are addressed to the caller.
 *
 * Read state, value, and breached threshold are surfaced inline — caregiver
 * UI shouldn't need a second round-trip to render the alert card.
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
      a.vital_value,
      a.vital_unit,
      a.threshold_min,
      a.threshold_max,
      a.message,
      a.created_at AS timestamp,
      a.is_read,
      a.read_at
    FROM alerts a
    WHERE a.patient_id = $1 AND a.recipient_user_id = $2
  `;

  const params = [patientId, userId];

  if (unreadOnly) {
    query += ` AND a.is_read = false`;
  }

  query += ` ORDER BY a.created_at DESC LIMIT $3 OFFSET $4`;
  params.push(limit, offset);

  const result = await client.query(query, params);

  const countResult = await client.query(
    `SELECT COUNT(*)::int AS total FROM alerts WHERE patient_id = $1 AND recipient_user_id = $2`,
    [patientId, userId]
  );

  const unreadCountResult = await client.query(
    `SELECT COUNT(*)::int AS unread FROM alerts
     WHERE patient_id = $1 AND recipient_user_id = $2 AND is_read = false`,
    [patientId, userId]
  );

  const alerts = result.rows.map((row) => ({
    id: row.id,
    alertType: row.alert_type,
    vitalType: row.vital_type,
    vitalValue: row.vital_value === null ? null : Number(row.vital_value),
    vitalUnit: row.vital_unit,
    thresholdMin: row.threshold_min === null ? null : Number(row.threshold_min),
    thresholdMax: row.threshold_max === null ? null : Number(row.threshold_max),
    message: row.message,
    timestamp: row.timestamp,
    read: row.is_read === true,
    readAt: row.read_at,
  }));

  return successResponse(200, {
    alerts,
    total: countResult.rows[0].total,
    unreadCount: unreadCountResult.rows[0].unread,
    limit,
    offset,
  });
}

/**
 * Update an alert's read state. Authoritatively scoped to the caller —
 * an alert can only be marked by its addressed recipient.
 */
async function updateAlert(client, event, alertId, userId) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

  const alertResult = await client.query(
    `SELECT a.recipient_user_id FROM alerts a WHERE a.id = $1`,
    [alertId]
  );

  if (alertResult.rows.length === 0) {
    return errorResponse(404, 'Alert not found');
  }

  if (alertResult.rows[0].recipient_user_id !== userId) {
    return errorResponse(403, 'Access denied');
  }

  if (body.read !== undefined) {
    if (body.read) {
      await client.query(
        `UPDATE alerts SET is_read = true, read_at = NOW() WHERE id = $1`,
        [alertId]
      );
    } else {
      await client.query(
        `UPDATE alerts SET is_read = false, read_at = NULL WHERE id = $1`,
        [alertId]
      );
    }
  }

  return successResponse(200, { message: 'Alert updated successfully' });
}

/**
 * Delete an alert. The schema has no `deleted_at` column; this is a hard
 * delete. Only the recipient may delete their own alerts.
 */
async function deleteAlert(client, alertId, userId) {
  const alertResult = await client.query(
    `SELECT a.recipient_user_id FROM alerts a WHERE a.id = $1`,
    [alertId]
  );

  if (alertResult.rows.length === 0) {
    return errorResponse(404, 'Alert not found');
  }

  if (alertResult.rows[0].recipient_user_id !== userId) {
    return errorResponse(403, 'Access denied');
  }

  await client.query(`DELETE FROM alerts WHERE id = $1`, [alertId]);

  return successResponse(200, { message: 'Alert deleted successfully' });
}

/**
 * Resolve a Cognito sub to its internal users.id (UUID).
 * Returns null when no user row exists for the sub.
 */
async function resolveUserIdFromCognitoSub(client, cognitoSub) {
  const result = await client.query(
    `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
    [cognitoSub]
  );
  return result.rows[0]?.id || null;
}

/**
 * Check whether the caller (already-resolved internal users.id) has access
 * to the patient's data. Either an active persona link, or the caller IS
 * the patient.
 */
async function checkPatientAccess(client, userId, patientId) {
  const linkResult = await client.query(
    `SELECT 1 FROM persona_links
     WHERE linked_user_id = $1 AND patient_id = $2 AND is_active = true`,
    [userId, patientId]
  );

  if (linkResult.rows.length > 0) {
    return true;
  }

  const selfResult = await client.query(
    `SELECT 1 FROM patients p
     WHERE p.id = $1 AND p.user_id = $2`,
    [patientId, userId]
  );

  return selfResult.rows.length > 0;
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

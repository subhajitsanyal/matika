/**
 * Reminder Configuration CRUD Lambda
 *
 * API endpoints for managing reminder windows per vital type.
 * Reminders alert relatives when vitals haven't been logged within the window.
 */

const { Client } = require('pg');

// Database connection
const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
};

// Valid vital types
const VITAL_TYPES = [
  'BLOOD_PRESSURE',
  'GLUCOSE',
  'TEMPERATURE',
  'WEIGHT',
  'PULSE',
  'SPO2',
];

// Default reminder configs
const DEFAULT_REMINDERS = {
  BLOOD_PRESSURE: { windowHours: 24, gracePeriodMinutes: 60 },
  GLUCOSE: { windowHours: 8, gracePeriodMinutes: 30 },
  TEMPERATURE: { windowHours: 12, gracePeriodMinutes: 60 },
  WEIGHT: { windowHours: 168, gracePeriodMinutes: 120 }, // Weekly
  PULSE: { windowHours: 24, gracePeriodMinutes: 60 },
  SPO2: { windowHours: 24, gracePeriodMinutes: 60 },
};

exports.handler = async (event) => {
  console.log('Reminder CRUD request:', event.httpMethod, event.path);

  const client = new Client(dbConfig);

  try {
    await client.connect();

    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;

    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    const patientId = event.pathParameters?.patientId;
    if (!patientId) {
      return errorResponse(400, 'Patient ID required');
    }

    // Check access
    const hasAccess = await checkPatientAccess(client, userId, patientId);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied');
    }

    switch (httpMethod) {
      case 'GET':
        return await getReminderConfigs(client, patientId);
      case 'PUT':
        return await updateReminderConfig(client, event, patientId, userId);
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
 * Get all reminder configs for a patient.
 */
async function getReminderConfigs(client, patientId) {
  const result = await client.query(
    `SELECT
       vital_type,
       window_hours,
       grace_period_minutes,
       enabled,
       updated_at
     FROM reminder_configs
     WHERE patient_id = $1`,
    [patientId]
  );

  // Build response with defaults for missing vital types
  const reminders = VITAL_TYPES.map((vitalType) => {
    const existing = result.rows.find((r) => r.vital_type === vitalType);

    if (existing) {
      return {
        vitalType: existing.vital_type,
        windowHours: existing.window_hours,
        gracePeriodMinutes: existing.grace_period_minutes,
        enabled: existing.enabled !== false,
        updatedAt: existing.updated_at,
      };
    }

    // Return default
    const defaults = DEFAULT_REMINDERS[vitalType];
    return {
      vitalType,
      windowHours: defaults.windowHours,
      gracePeriodMinutes: defaults.gracePeriodMinutes,
      enabled: true,
      updatedAt: null,
    };
  });

  return successResponse(200, { reminders });
}

/**
 * Update a reminder config for a patient.
 */
async function updateReminderConfig(client, event, patientId, userId) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

  const { vitalType, windowHours, gracePeriodMinutes, enabled } = body;

  // Validate vital type
  if (!VITAL_TYPES.includes(vitalType)) {
    return errorResponse(400, 'Invalid vital type');
  }

  // Validate window hours
  if (windowHours !== undefined && (windowHours < 1 || windowHours > 720)) {
    return errorResponse(400, 'Window hours must be between 1 and 720');
  }

  // Validate grace period
  if (gracePeriodMinutes !== undefined && (gracePeriodMinutes < 0 || gracePeriodMinutes > 480)) {
    return errorResponse(400, 'Grace period must be between 0 and 480 minutes');
  }

  // Get existing or defaults
  const defaults = DEFAULT_REMINDERS[vitalType];
  const finalWindowHours = windowHours ?? defaults.windowHours;
  const finalGracePeriod = gracePeriodMinutes ?? defaults.gracePeriodMinutes;
  const finalEnabled = enabled !== undefined ? enabled : true;

  // Upsert reminder config
  await client.query(
    `INSERT INTO reminder_configs (patient_id, vital_type, window_hours, grace_period_minutes, enabled, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (patient_id, vital_type)
     DO UPDATE SET
       window_hours = EXCLUDED.window_hours,
       grace_period_minutes = EXCLUDED.grace_period_minutes,
       enabled = EXCLUDED.enabled,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [patientId, vitalType, finalWindowHours, finalGracePeriod, finalEnabled, userId]
  );

  // Log audit event
  await logAuditEvent(client, {
    action: 'UPDATE',
    resourceType: 'ReminderConfig',
    resourceId: `${patientId}_${vitalType}`,
    userId,
    patientId,
    details: { vitalType, windowHours: finalWindowHours, gracePeriodMinutes: finalGracePeriod, enabled: finalEnabled },
  });

  return successResponse(200, {
    message: 'Reminder configuration updated successfully',
    vitalType,
    windowHours: finalWindowHours,
    gracePeriodMinutes: finalGracePeriod,
    enabled: finalEnabled,
  });
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
 * Log audit event.
 */
async function logAuditEvent(client, event) {
  try {
    await client.query(
      `INSERT INTO audit_log (action, resource_type, resource_id, user_id, patient_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        event.action,
        event.resourceType,
        event.resourceId,
        event.userId,
        event.patientId,
        JSON.stringify(event.details),
      ]
    );
  } catch (error) {
    console.error('Audit log error:', error);
  }
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

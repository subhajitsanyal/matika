/**
 * Threshold CRUD Lambda
 *
 * API endpoints for managing vital thresholds per patient.
 * Supports doctor override (doctor > relative priority).
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

// Default thresholds
const DEFAULT_THRESHOLDS = {
  BLOOD_PRESSURE: { minValue: 90, maxValue: 140, unit: 'mmHg' },
  GLUCOSE: { minValue: 70, maxValue: 180, unit: 'mg/dL' },
  TEMPERATURE: { minValue: 97, maxValue: 99.5, unit: '°F' },
  WEIGHT: { minValue: null, maxValue: null, unit: 'kg' },
  PULSE: { minValue: 60, maxValue: 100, unit: 'bpm' },
  SPO2: { minValue: 95, maxValue: 100, unit: '%' },
};

exports.handler = async (event) => {
  console.log('Threshold CRUD request:', event.httpMethod, event.path);

  const client = new Client(dbConfig);

  try {
    await client.connect();

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

    // Check access
    const hasAccess = await checkPatientAccess(client, userId, patientId, userGroups);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied');
    }

    switch (httpMethod) {
      case 'GET':
        return await getThresholds(client, patientId);
      case 'PUT':
        return await updateThreshold(client, event, patientId, userId, userGroups);
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
 * Get all thresholds for a patient.
 */
async function getThresholds(client, patientId) {
  const result = await client.query(
    `SELECT
       vital_type,
       min_value,
       max_value,
       unit,
       set_by_doctor,
       doctor_id,
       updated_at
     FROM thresholds
     WHERE patient_id = $1`,
    [patientId]
  );

  // Build response with defaults for missing vital types
  const thresholds = VITAL_TYPES.map((vitalType) => {
    const existing = result.rows.find((r) => r.vital_type === vitalType);

    if (existing) {
      return {
        vitalType: existing.vital_type,
        minValue: existing.min_value,
        maxValue: existing.max_value,
        unit: existing.unit,
        setByDoctor: existing.set_by_doctor || false,
        doctorName: null, // TODO: Join with users table
        updatedAt: existing.updated_at,
      };
    }

    // Return default
    const defaults = DEFAULT_THRESHOLDS[vitalType];
    return {
      vitalType,
      minValue: defaults.minValue,
      maxValue: defaults.maxValue,
      unit: defaults.unit,
      setByDoctor: false,
      doctorName: null,
      updatedAt: null,
    };
  });

  return successResponse(200, { thresholds });
}

/**
 * Update a threshold for a patient.
 */
async function updateThreshold(client, event, patientId, userId, userGroups) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

  const { vitalType, minValue, maxValue, unit } = body;

  // Validate vital type
  if (!VITAL_TYPES.includes(vitalType)) {
    return errorResponse(400, 'Invalid vital type');
  }

  // Validate values
  if (minValue !== null && maxValue !== null && minValue >= maxValue) {
    return errorResponse(400, 'Min value must be less than max value');
  }

  // Check if user is a doctor
  const isDoctor = userGroups.includes('doctors');

  // Check if doctor override exists
  const existingResult = await client.query(
    `SELECT set_by_doctor, doctor_id FROM thresholds
     WHERE patient_id = $1 AND vital_type = $2`,
    [patientId, vitalType]
  );

  const existing = existingResult.rows[0];

  // If set by doctor and current user is not a doctor, reject
  if (existing?.set_by_doctor && !isDoctor) {
    return errorResponse(
      403,
      'This threshold was set by a doctor and cannot be modified by non-doctors'
    );
  }

  // Upsert threshold
  await client.query(
    `INSERT INTO thresholds (patient_id, vital_type, min_value, max_value, unit, set_by_doctor, doctor_id, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (patient_id, vital_type)
     DO UPDATE SET
       min_value = EXCLUDED.min_value,
       max_value = EXCLUDED.max_value,
       unit = EXCLUDED.unit,
       set_by_doctor = EXCLUDED.set_by_doctor,
       doctor_id = CASE WHEN EXCLUDED.set_by_doctor THEN EXCLUDED.doctor_id ELSE thresholds.doctor_id END,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [
      patientId,
      vitalType,
      minValue,
      maxValue,
      unit || DEFAULT_THRESHOLDS[vitalType].unit,
      isDoctor,
      isDoctor ? userId : null,
      userId,
    ]
  );

  // Log audit event
  await logAuditEvent(client, {
    action: existing ? 'UPDATE' : 'CREATE',
    resourceType: 'Threshold',
    resourceId: `${patientId}_${vitalType}`,
    userId,
    patientId,
    details: { vitalType, minValue, maxValue },
  });

  return successResponse(200, {
    message: 'Threshold updated successfully',
    vitalType,
    minValue,
    maxValue,
    unit: unit || DEFAULT_THRESHOLDS[vitalType].unit,
    setByDoctor: isDoctor,
  });
}

/**
 * Check if user has access to patient data.
 */
async function checkPatientAccess(client, userId, patientId, userGroups) {
  // Check if user is linked to patient via persona_links
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

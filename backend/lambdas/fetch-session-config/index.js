/**
 * CareLog Fetch Session Config Lambda
 *
 * GET /session-config/{patientId}
 *
 * Assembles everything the app needs to start a conversation session:
 * - Active parameter configs for the patient
 * - Patient topics with their status
 * - Conversation prompts (all types)
 * - Pending recommendations
 * - Patient profile (name, language, timezone)
 * - Last session summary
 *
 * Auth: Patient or caregiver linked to patient
 *
 * HIPAA Compliance:
 * - All PHI encrypted in transit and at rest
 * - Access restricted to authorized users via Cognito + persona_links
 */

const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const secretsClient = new SecretsManagerClient({});
const s3Client = new S3Client({});
let dbCredentials = null;

/**
 * Get database credentials from Secrets Manager.
 */
async function getDatabaseCredentials() {
  if (dbCredentials) return dbCredentials;
  const command = new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_NAME });
  const response = await secretsClient.send(command);
  dbCredentials = JSON.parse(response.SecretString);
  return dbCredentials;
}

/**
 * Create database connection.
 */
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
 * Check if user has access to the patient (is the patient or linked caregiver).
 */
async function checkPatientAccess(dbClient, cognitoSub, patientDbId) {
  // Check if user is the patient themselves
  const patientCheck = await dbClient.query(
    `SELECT 1 FROM patients p
     JOIN users u ON p.user_id = u.id
     WHERE p.id = $1 AND u.cognito_sub = $2`,
    [patientDbId, cognitoSub]
  );
  if (patientCheck.rows.length > 0) return true;

  // Check if user is a linked caregiver via persona_links
  const linkCheck = await dbClient.query(
    `SELECT 1 FROM persona_links pl
     JOIN users u ON pl.linked_user_id = u.id
     WHERE pl.patient_id = $1 AND u.cognito_sub = $2 AND pl.is_active = true`,
    [patientDbId, cognitoSub]
  );
  return linkCheck.rows.length > 0;
}

/**
 * Get the latest observation date for a parameter by listing S3 keys.
 * Falls back to null if no observations found.
 */
async function getLastLoggedDate(patientId, loincCodes) {
  // We check the observations bucket for the most recent file
  // Since observations are stored by date, we list in reverse and take the first
  try {
    const bucket = process.env.S3_FHIR_BUCKET;
    if (!bucket) return null;

    const prefix = `observations/${patientId}/`;
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 100,
    });
    const response = await s3Client.send(command);

    if (!response.Contents || response.Contents.length === 0) return null;

    // Sort by LastModified descending and return the most recent
    const sorted = response.Contents.sort(
      (a, b) => new Date(b.LastModified) - new Date(a.LastModified)
    );
    return sorted[0].LastModified.toISOString();
  } catch (err) {
    console.warn('Failed to get last logged date from S3:', err.message);
    return null;
  }
}

/**
 * Fetch active parameter configs for the patient.
 */
async function fetchParameterConfigs(dbClient, patientDbId, patientId) {
  const result = await dbClient.query(
    `SELECT
       pc.id,
       pc.parameter_name AS name,
       pc.display_name,
       pc.loinc_codes,
       pc.unit,
       pc.frequency_days,
       pc.daily_deadline,
       pc.threshold_min,
       pc.threshold_max,
       CASE WHEN pc.threshold_set_by IS NOT NULL THEN
         CASE WHEN u.persona_type = 'doctor' THEN 'doctor' ELSE 'caregiver' END
       ELSE NULL END AS threshold_set_by
     FROM parameter_configs pc
     LEFT JOIN users u ON pc.threshold_set_by = u.id
     WHERE pc.patient_id = $1 AND pc.active = true
     ORDER BY pc.created_at`,
    [patientDbId]
  );

  // Enrich each parameter with last_logged date
  const parameters = [];
  for (const row of result.rows) {
    const lastLogged = await getLastLoggedDate(patientId, row.loinc_codes);
    parameters.push({
      id: row.id,
      name: row.name,
      loinc_codes: row.loinc_codes,
      unit: row.unit,
      frequency_days: row.frequency_days,
      daily_deadline: row.daily_deadline,
      threshold_min: row.threshold_min,
      threshold_max: row.threshold_max,
      threshold_set_by: row.threshold_set_by,
      last_logged: lastLogged,
    });
  }

  return parameters;
}

/**
 * Fetch patient topics with status.
 */
async function fetchTopics(dbClient, patientDbId) {
  const result = await dbClient.query(
    `SELECT
       t.id,
       t.name,
       t.description,
       COALESCE(pt.status, 'incomplete') AS status,
       pt.collected_data,
       pt.last_updated
     FROM topics t
     LEFT JOIN patient_topics pt ON t.id = pt.topic_id AND pt.patient_id = $1
     WHERE t.active = true
     ORDER BY t.name`,
    [patientDbId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    collected_data: row.collected_data || null,
    last_updated: row.last_updated || null,
  }));
}

/**
 * Fetch all conversation prompts.
 */
async function fetchPrompts(dbClient) {
  const result = await dbClient.query(
    `SELECT prompt_type, system_prompt FROM conversation_prompts ORDER BY prompt_type`
  );

  const prompts = {};
  for (const row of result.rows) {
    prompts[row.prompt_type] = row.system_prompt;
  }
  return prompts;
}

/**
 * Fetch pending recommendations for the patient.
 */
async function fetchRecommendations(dbClient, patientDbId) {
  const result = await dbClient.query(
    `SELECT
       r.id,
       r.source,
       r.parameter_name,
       r.rationale,
       r.status
     FROM recommendations r
     WHERE r.patient_id = $1 AND r.status = 'pending'
     ORDER BY r.created_at DESC`,
    [patientDbId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    source: row.source,
    parameter_name: row.parameter_name,
    rationale: row.rationale,
    status: row.status,
  }));
}

/**
 * Fetch patient profile.
 */
async function fetchPatientProfile(dbClient, patientDbId) {
  const result = await dbClient.query(
    `SELECT
       p.patient_id,
       u.name AS patient_name,
       p.language,
       p.timezone
     FROM patients p
     JOIN users u ON p.user_id = u.id
     WHERE p.id = $1`,
    [patientDbId]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0];
}

/**
 * Fetch last session summary.
 */
async function fetchLastSessionSummary(dbClient, patientDbId) {
  const result = await dbClient.query(
    `SELECT
       started_at AS date,
       extracted_summary AS confirmed_values,
       status
     FROM interaction_sessions
     WHERE patient_id = $1
     ORDER BY started_at DESC
     LIMIT 1`,
    [patientDbId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    date: row.date,
    confirmed_values: row.confirmed_values || [],
    status: row.status,
  };
}

/**
 * Resolve patientId path parameter to the internal patient DB UUID.
 * The path parameter may be the patient_id (CL-XXXXXX) or the UUID.
 */
async function resolvePatientDbId(dbClient, patientIdParam) {
  // Try as UUID first
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(patientIdParam)) {
    const result = await dbClient.query(
      `SELECT id, patient_id FROM patients WHERE id = $1`,
      [patientIdParam]
    );
    if (result.rows.length > 0) return result.rows[0];
  }

  // Try as patient_id (CL-XXXXXX)
  const result = await dbClient.query(
    `SELECT id, patient_id FROM patients WHERE patient_id = $1`,
    [patientIdParam]
  );
  if (result.rows.length > 0) return result.rows[0];

  return null;
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log('Fetch session config request:', event.httpMethod, event.path);

  const claims = event.requestContext?.authorizer?.claims || {};
  const userId = claims.sub;

  if (!userId) {
    return errorResponse(401, 'Unauthorized');
  }

  const patientIdParam = event.pathParameters?.patientId;
  if (!patientIdParam) {
    return errorResponse(400, 'Patient ID required');
  }

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    // Resolve patient ID
    const patient = await resolvePatientDbId(dbClient, patientIdParam);
    if (!patient) {
      return errorResponse(404, 'Patient not found');
    }

    const patientDbId = patient.id;
    const patientExternalId = patient.patient_id;

    // Check access
    const hasAccess = await checkPatientAccess(dbClient, userId, patientDbId);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied');
    }

    // Fetch all data in parallel
    const [profile, parameters, topics, prompts, recommendations, lastSession] =
      await Promise.all([
        fetchPatientProfile(dbClient, patientDbId),
        fetchParameterConfigs(dbClient, patientDbId, patientExternalId),
        fetchTopics(dbClient, patientDbId),
        fetchPrompts(dbClient),
        fetchRecommendations(dbClient, patientDbId),
        fetchLastSessionSummary(dbClient, patientDbId),
      ]);

    if (!profile) {
      return errorResponse(404, 'Patient profile not found');
    }

    const response = {
      patient_id: patientDbId,
      patient_name: profile.patient_name,
      language: profile.language,
      timezone: profile.timezone,
      parameters,
      topics,
      prompts,
      recommendations,
      last_session_summary: lastSession,
    };

    return successResponse(200, response);
  } catch (error) {
    console.error('Error fetching session config:', error);
    return errorResponse(500, 'Internal server error');
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

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

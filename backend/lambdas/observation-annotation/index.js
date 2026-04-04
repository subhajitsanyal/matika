/**
 * Observation Annotation Lambda
 *
 * Add clinical notes/annotations to FHIR Observations.
 * Only doctors can annotate observations.
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
  console.log('Observation annotation request:', event.httpMethod, event.path);

  const client = await createDbConnection();

  try {
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;
    const userName = claims.name || 'Unknown';
    const userGroups = (claims['cognito:groups'] || '').split(',').map((g) => g.trim());

    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    if (!userGroups.includes('doctors')) {
      return errorResponse(403, 'Only doctors can annotate observations');
    }

    const patientId = event.pathParameters?.patientId;
    const observationId = event.pathParameters?.observationId;

    if (!patientId || !observationId) {
      return errorResponse(400, 'Patient ID and Observation ID required');
    }

    // Verify doctor has access to patient
    const hasAccess = await checkAccess(client, userId, patientId);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied');
    }

    switch (httpMethod) {
      case 'GET':
        return await getNotes(client, observationId);
      case 'POST':
        return await addNote(client, event, patientId, observationId, userId, userName);
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
 * Get notes for an observation.
 */
async function getNotes(client, observationId) {
  const result = await client.query(
    `SELECT
       id,
       note,
       author_id,
       author_name,
       created_at
     FROM observation_notes
     WHERE observation_id = $1
     ORDER BY created_at DESC`,
    [observationId]
  );

  const notes = result.rows.map((row) => ({
    id: row.id,
    note: row.note,
    authorId: row.author_id,
    authorName: row.author_name,
    createdAt: row.created_at,
  }));

  return successResponse(200, { notes });
}

/**
 * Add a note to an observation.
 */
async function addNote(client, event, patientId, observationId, userId, userName) {
  const body = JSON.parse(event.body || '{}');
  const { note } = body;

  if (!note || typeof note !== 'string' || note.trim().length === 0) {
    return errorResponse(400, 'Note is required');
  }

  // Verify observation exists and belongs to patient
  const obsCheck = await client.query(
    `SELECT id FROM observations WHERE id = $1 AND patient_id = $2`,
    [observationId, patientId]
  );

  if (obsCheck.rows.length === 0) {
    return errorResponse(404, 'Observation not found');
  }

  // Insert note
  const result = await client.query(
    `INSERT INTO observation_notes (
       observation_id,
       note,
       author_id,
       author_name,
       created_at
     ) VALUES ($1, $2, $3, $4, NOW())
     RETURNING id, note, author_name, created_at`,
    [observationId, note.trim(), userId, userName]
  );

  const savedNote = result.rows[0];

  // Update FHIR Observation in HealthLake
  await updateFhirObservation(observationId, note.trim(), userName);

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
      'UPDATE',
      'Observation',
      observationId,
      userId,
      'doctor',
      patientId,
      JSON.stringify({ action: 'add_note' }),
    ]
  );

  return successResponse(201, {
    id: savedNote.id,
    note: savedNote.note,
    authorName: savedNote.author_name,
    createdAt: savedNote.created_at,
  });
}

/**
 * Update FHIR Observation with annotation.
 */
async function updateFhirObservation(observationId, note, authorName) {
  // Note: In production, PATCH the Observation in HealthLake
  // to append to the note array
  const annotation = {
    authorString: authorName,
    time: new Date().toISOString(),
    text: note,
  };

  console.log('Adding FHIR Observation annotation:', observationId, annotation);

  return annotation;
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

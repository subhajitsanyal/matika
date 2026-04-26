/**
 * CareLog Manage Interactions Lambda
 *
 * GET /patients/{patientId}/interactions                       — List interactions (caregiver or doctor)
 * GET /patients/{patientId}/interactions/{id}/transcript       — Fetch transcript from S3 (caregiver or doctor)
 *
 * HIPAA Compliance:
 * - All PHI encrypted in transit and at rest
 * - Access restricted to authorized users via Cognito + persona_links
 */

const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const secretsClient = new SecretsManagerClient({});
const s3Client = new S3Client({});
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
 */
async function checkPatientAccess(dbClient, cognitoSub, patientDbId) {
  const userResult = await dbClient.query(
    `SELECT id FROM users WHERE cognito_sub = $1`,
    [cognitoSub]
  );
  if (userResult.rows.length === 0) return false;

  const userId = userResult.rows[0].id;

  // Check persona_links
  const linkCheck = await dbClient.query(
    `SELECT 1 FROM persona_links
     WHERE linked_user_id = $1 AND patient_id = $2 AND is_active = true`,
    [userId, patientDbId]
  );
  if (linkCheck.rows.length > 0) return true;

  // Check if user is the patient
  const patientCheck = await dbClient.query(
    `SELECT 1 FROM patients WHERE id = $1 AND user_id = $2`,
    [patientDbId, userId]
  );
  return patientCheck.rows.length > 0;
}

/**
 * GET — List interaction sessions for a patient with pagination.
 */
async function listInteractions(dbClient, event, patientDbId) {
  const queryParams = event.queryStringParameters || {};
  const limit = Math.min(parseInt(queryParams.limit, 10) || 20, 100);
  const offset = parseInt(queryParams.offset, 10) || 0;

  const result = await dbClient.query(
    `SELECT
       id,
       session_type,
       language,
       status,
       turn_count,
       duration_ms,
       extracted_summary,
       started_at,
       ended_at,
       created_at
     FROM interaction_sessions
     WHERE patient_id = $1
     ORDER BY started_at DESC
     LIMIT $2 OFFSET $3`,
    [patientDbId, limit, offset]
  );

  const countResult = await dbClient.query(
    `SELECT COUNT(*) AS total FROM interaction_sessions WHERE patient_id = $1`,
    [patientDbId]
  );

  return successResponse(200, {
    interactions: result.rows,
    pagination: {
      total: parseInt(countResult.rows[0].total, 10),
      limit,
      offset,
    },
  });
}

/**
 * GET — Fetch interaction transcript from S3.
 */
async function getTranscript(dbClient, event, patientDbId) {
  const interactionId = event.pathParameters?.interactionId || event.pathParameters?.id;
  if (!interactionId) {
    return errorResponse(400, 'Interaction ID required');
  }

  // Get the transcript S3 key from the interaction record
  const result = await dbClient.query(
    `SELECT transcript_s3_key FROM interaction_sessions
     WHERE id = $1 AND patient_id = $2`,
    [interactionId, patientDbId]
  );

  if (result.rows.length === 0) {
    return errorResponse(404, 'Interaction not found');
  }

  const s3Key = result.rows[0].transcript_s3_key;
  if (!s3Key) {
    return errorResponse(404, 'Transcript not available');
  }

  const bucket = process.env.S3_RAW_BUCKET;
  if (!bucket) {
    return errorResponse(500, 'S3 bucket not configured');
  }

  try {
    const s3Response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: s3Key,
      })
    );

    const bodyString = await s3Response.Body.transformToString();
    const transcript = JSON.parse(bodyString);

    return successResponse(200, { transcript });
  } catch (err) {
    console.error('Failed to fetch transcript from S3:', err.message);
    if (err.name === 'NoSuchKey') {
      return errorResponse(404, 'Transcript not found in storage');
    }
    return errorResponse(500, 'Failed to retrieve transcript');
  }
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log('Manage interactions request:', event.httpMethod, event.path);

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

    const hasAccess = await checkPatientAccess(dbClient, cognitoSub, patientDbId);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied');
    }

    if (httpMethod !== 'GET') {
      return errorResponse(405, 'Method not allowed');
    }

    // Determine if this is a transcript request by checking path
    const path = event.path || event.rawPath || '';
    const isTranscriptRequest = path.includes('/transcript');

    if (isTranscriptRequest) {
      return await getTranscript(dbClient, event, patientDbId);
    }

    return await listInteractions(dbClient, event, patientDbId);
  } catch (error) {
    console.error('Error managing interactions:', error);
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

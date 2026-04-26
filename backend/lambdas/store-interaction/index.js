/**
 * CareLog Store Interaction Lambda
 *
 * POST /interactions
 *
 * Stores raw conversation data:
 * - Parses multipart form data (metadata JSON, audio files, photos)
 * - Uploads all files to S3 raw bucket with spec-compliant key structure
 * - Creates interaction_sessions record in RDS
 * - Stores transcript as JSON in S3
 * - Creates vision_results records if present in metadata
 *
 * Auth: Patient or caregiver linked to patient
 *
 * HIPAA Compliance:
 * - All PHI encrypted in transit (TLS) and at rest (KMS)
 * - Audit logging for data storage
 */

const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const Busboy = require('busboy');
const crypto = require('crypto');

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
 * Generate S3 key prefix for interaction files.
 * Pattern: interactions/{patientId}/{YYYY}/{MM}/{DD}/{sessionId}/
 */
function generateS3Prefix(patientId, sessionId, dateStr) {
  const date = dateStr ? new Date(dateStr) : new Date();
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `interactions/${patientId}/${yyyy}/${mm}/${dd}/${sessionId}`;
}

/**
 * Parse multipart form data from API Gateway event.
 * Returns { metadata, files } where files is a Map of fieldname -> { buffer, filename, mimeType }.
 */
function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType =
      event.headers['Content-Type'] || event.headers['content-type'] || '';

    const busboy = Busboy({
      headers: { 'content-type': contentType },
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    });

    let metadata = null;
    const files = new Map();

    busboy.on('field', (fieldname, val) => {
      if (fieldname === 'metadata') {
        try {
          metadata = JSON.parse(val);
        } catch (e) {
          reject(new Error('Invalid metadata JSON'));
        }
      }
    });

    busboy.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];

      file.on('data', (data) => {
        chunks.push(data);
      });

      file.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // Handle array fields like device_photos[]
        const key = fieldname.replace('[]', '');
        if (files.has(key)) {
          const existing = files.get(key);
          if (Array.isArray(existing)) {
            existing.push({ buffer, filename, mimeType });
          } else {
            files.set(key, [existing, { buffer, filename, mimeType }]);
          }
        } else {
          files.set(key, { buffer, filename, mimeType });
        }
      });
    });

    busboy.on('finish', () => {
      if (!metadata) {
        reject(new Error('Missing metadata field'));
        return;
      }
      resolve({ metadata, files });
    });

    busboy.on('error', reject);

    // Write the body to busboy
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body || '');
    busboy.end(body);
  });
}

/**
 * Upload a buffer to S3.
 */
async function uploadToS3(bucket, key, body, contentType) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ServerSideEncryption: 'aws:kms',
  });
  await s3Client.send(command);
  return key;
}

/**
 * Get user's internal DB ID from cognito sub.
 */
async function getUserId(dbClient, cognitoSub) {
  const result = await dbClient.query(
    `SELECT id FROM users WHERE cognito_sub = $1`,
    [cognitoSub]
  );
  return result.rows.length > 0 ? result.rows[0].id : null;
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log('Store interaction request received');

  const claims = event.requestContext?.authorizer?.claims || {};
  const cognitoSub = claims.sub;

  if (!cognitoSub) {
    return errorResponse(401, 'Unauthorized');
  }

  let dbClient = null;

  try {
    // Parse multipart form data
    const { metadata, files } = await parseMultipart(event);

    // Validate required metadata fields
    if (!metadata.patient_id) {
      return errorResponse(400, 'Missing required field: patient_id');
    }
    if (!metadata.session_id) {
      return errorResponse(400, 'Missing required field: session_id');
    }
    if (!metadata.session_type) {
      return errorResponse(400, 'Missing required field: session_type');
    }

    const patientId = metadata.patient_id;
    const sessionId = metadata.session_id;
    const bucket = process.env.S3_RAW_BUCKET;

    // Connect to DB and verify access
    dbClient = await createDbConnection();

    const hasAccess = await checkPatientAccess(dbClient, cognitoSub, patientId);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied');
    }

    const userId = await getUserId(dbClient, cognitoSub);
    if (!userId) {
      return errorResponse(403, 'User not found');
    }

    // Generate S3 prefix
    const s3Prefix = generateS3Prefix(patientId, sessionId, metadata.started_at);

    // Upload files to S3 in parallel
    const uploadPromises = [];
    let patientAudioKey = null;
    let systemAudioKey = null;
    let transcriptKey = null;
    const photoKeys = [];

    // Patient audio
    if (files.has('patient_audio')) {
      const file = files.get('patient_audio');
      patientAudioKey = `${s3Prefix}/patient_audio.pcm`;
      uploadPromises.push(uploadToS3(bucket, patientAudioKey, file.buffer, 'audio/pcm'));
    }

    // System audio
    if (files.has('system_audio')) {
      const file = files.get('system_audio');
      systemAudioKey = `${s3Prefix}/system_audio.pcm`;
      uploadPromises.push(uploadToS3(bucket, systemAudioKey, file.buffer, 'audio/pcm'));
    }

    // Transcript (from metadata)
    if (metadata.transcript) {
      transcriptKey = `${s3Prefix}/transcript.json`;
      uploadPromises.push(
        uploadToS3(
          bucket,
          transcriptKey,
          Buffer.from(JSON.stringify(metadata.transcript)),
          'application/json'
        )
      );
    }

    // Device photos
    if (files.has('device_photos')) {
      let photos = files.get('device_photos');
      if (!Array.isArray(photos)) photos = [photos];

      for (const photo of photos) {
        const photoId = crypto.randomUUID();
        const photoKey = `${s3Prefix}/photos/${photoId}.jpg`;
        photoKeys.push(photoKey);
        uploadPromises.push(uploadToS3(bucket, photoKey, photo.buffer, 'image/jpeg'));
      }
    }

    // Wait for all uploads
    await Promise.all(uploadPromises);

    // Create interaction_sessions record in RDS
    await dbClient.query('BEGIN');

    try {
      const sessionResult = await dbClient.query(
        `INSERT INTO interaction_sessions (
           id, patient_id, user_id, session_type, language, status,
           turn_count, duration_ms,
           patient_audio_s3_key, system_audio_s3_key, transcript_s3_key,
           extracted_summary,
           started_at, ended_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          sessionId,
          patientId,
          userId,
          metadata.session_type,
          metadata.language || 'en',
          metadata.status || 'complete',
          metadata.turn_count || 0,
          metadata.duration_ms || null,
          patientAudioKey,
          systemAudioKey,
          transcriptKey,
          metadata.extracted_summary ? JSON.stringify(metadata.extracted_summary) : null,
          metadata.started_at || new Date().toISOString(),
          metadata.ended_at || null,
        ]
      );

      const interactionId = sessionResult.rows[0].id;

      // Store vision_results if present
      if (metadata.vision_results && Array.isArray(metadata.vision_results)) {
        for (let i = 0; i < metadata.vision_results.length; i++) {
          const vr = metadata.vision_results[i];
          const photoS3Key = photoKeys[i] || vr.photo_s3_key || '';

          await dbClient.query(
            `INSERT INTO vision_results (
               session_id, patient_id, photo_s3_key, device_type,
               confidence, readings, raw_text
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              interactionId,
              patientId,
              photoS3Key,
              vr.device_type || null,
              vr.confidence || null,
              JSON.stringify(vr.readings || {}),
              vr.raw_text || null,
            ]
          );
        }
      }

      // Audit log
      await dbClient.query(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
         VALUES ($1, 'CREATE', 'interaction_session', $2, $3)`,
        [
          userId,
          interactionId,
          JSON.stringify({
            session_type: metadata.session_type,
            patient_id: patientId,
          }),
        ]
      );

      await dbClient.query('COMMIT');

      return successResponse(201, {
        interaction_id: interactionId,
        audio_s3_key: patientAudioKey,
        transcript_s3_key: transcriptKey,
        status: 'stored',
      });
    } catch (dbError) {
      await dbClient.query('ROLLBACK');
      throw dbError;
    }
  } catch (error) {
    console.error('Error storing interaction:', error);

    if (error.message === 'Invalid metadata JSON' || error.message === 'Missing metadata field') {
      return errorResponse(400, error.message);
    }

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

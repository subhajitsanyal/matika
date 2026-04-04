/**
 * Presigned URL Generation Lambda
 *
 * Generates presigned S3 PUT URLs for direct file uploads.
 * URL valid for 15 minutes.
 * Key format: {patient_id}/{year}/{month}/{day}/{timestamp}_{type}_{filename}
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
});
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

const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const URL_EXPIRATION_SECONDS = 15 * 60; // 15 minutes

// Valid file types
const VALID_FILE_TYPES = [
  'prescription',
  'wound_photo',
  'urine_photo',
  'stool_photo',
  'vomit_photo',
  'medical_photo',
  'voice_note',
  'video_note',
  'document',
];

// Content type mapping
const CONTENT_TYPE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

exports.handler = async (event) => {
  console.log('Received presigned URL request');

  let dbClient = null;

  try {
    // Parse request
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    // Get user info from Cognito authorizer
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;

    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    // Validate request
    const { patientId, fileType, contentType, filename } = body;

    if (!patientId) {
      return errorResponse(400, 'Patient ID required');
    }

    if (!fileType || !VALID_FILE_TYPES.includes(fileType)) {
      return errorResponse(400, `Invalid file type. Must be one of: ${VALID_FILE_TYPES.join(', ')}`);
    }

    if (!contentType) {
      return errorResponse(400, 'Content type required');
    }

    if (!CONTENT_TYPE_EXTENSIONS[contentType]) {
      return errorResponse(400, `Unsupported content type: ${contentType}`);
    }

    // Check authorization against RDS persona_links
    dbClient = await createDbConnection();
    const hasAccess = await checkPatientAccess(dbClient, userId, patientId);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied to patient data');
    }

    // Generate S3 key
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const timestamp = now.getTime();

    // Sanitize filename
    const sanitizedFilename = sanitizeFilename(filename || 'file');
    const extension = CONTENT_TYPE_EXTENSIONS[contentType];

    const s3Key = `${patientId}/${year}/${month}/${day}/${timestamp}_${fileType}_${sanitizedFilename}${extension}`;

    // Generate presigned URL
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType,
      Metadata: {
        'patient-id': patientId,
        'file-type': fileType,
        'uploader-id': userId,
        'upload-timestamp': now.toISOString(),
      },
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: URL_EXPIRATION_SECONDS,
    });

    // Log audit event
    await logAuditEvent({
      action: 'PRESIGNED_URL_GENERATED',
      userId,
      patientId,
      fileType,
      s3Key,
    });

    return successResponse(200, {
      uploadUrl: presignedUrl,
      s3Key,
      expiresIn: URL_EXPIRATION_SECONDS,
      contentType,
      method: 'PUT',
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return errorResponse(500, 'Internal server error');
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

/**
 * Sanitize filename for S3 key.
 */
function sanitizeFilename(filename) {
  // Remove extension if present
  const name = filename.replace(/\.[^/.]+$/, '');
  // Replace invalid characters with underscores
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 50); // Limit length
}

/**
 * Check if user has access to patient data via persona_links table.
 * Returns true if the user is linked to the patient (as a caregiver/doctor)
 * or if the user IS the patient.
 */
async function checkPatientAccess(dbClient, userId, patientId) {
  // Check if user is linked to patient via persona_links
  const linkResult = await dbClient.query(
    `SELECT 1 FROM persona_links pl
     JOIN users u ON u.id = pl.linked_user_id
     JOIN patients p ON p.id = pl.patient_id
     WHERE u.cognito_sub = $1
       AND (p.id::text = $2 OR p.patient_id = $2)
       AND pl.is_active = true`,
    [userId, patientId]
  );

  if (linkResult.rows.length > 0) {
    return true;
  }

  // Check if user is the patient themselves
  const patientResult = await dbClient.query(
    `SELECT 1 FROM users u
     JOIN patients p ON p.user_id = u.id
     WHERE u.cognito_sub = $1
       AND (p.id::text = $2 OR p.patient_id = $2)`,
    [userId, patientId]
  );

  return patientResult.rows.length > 0;
}

/**
 * Log audit event.
 */
async function logAuditEvent(event) {
  console.log('Audit event:', JSON.stringify(event));
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
    body: JSON.stringify({
      error: message,
    }),
  };
}

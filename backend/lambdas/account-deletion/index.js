/**
 * Account Deletion Lambda
 *
 * Handles DPDP right to erasure requests.
 * Implements HIPAA-compliant data retention and anonymization.
 */

const { Client } = require('pg');
const {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
  AdminDeleteUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { S3Client, DeleteObjectsCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { v4: uuidv4 } = require('uuid');

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

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const DOCUMENTS_BUCKET = process.env.S3_BUCKET_NAME;

// HIPAA requires retention of medical records for minimum 6 years
const HIPAA_RETENTION_YEARS = 6;

exports.handler = async (event) => {
  console.log('Account deletion request:', event.httpMethod, event.path);

  const client = await createDbConnection();

  try {
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;

    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    switch (httpMethod) {
      case 'POST':
        return await initiateDeletion(client, event, userId);
      case 'GET':
        return await getDeletionStatus(client, userId);
      case 'DELETE':
        return await confirmDeletion(client, event, userId);
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
 * Initiate account deletion request.
 */
async function initiateDeletion(client, event, userId) {
  const body = JSON.parse(event.body || '{}');
  const { reason, confirmEmail } = body;

  // Get user email
  const userResult = await client.query(
    `SELECT email FROM users WHERE cognito_sub = $1`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    return errorResponse(404, 'User not found');
  }

  const userEmail = userResult.rows[0].email;

  // Verify email confirmation
  if (confirmEmail?.toLowerCase() !== userEmail?.toLowerCase()) {
    return errorResponse(400, 'Email confirmation does not match');
  }

  // Check for existing pending request
  const existingRequest = await client.query(
    `SELECT id FROM deletion_requests
     WHERE user_id = $1 AND status IN ('pending', 'processing')`,
    [userId]
  );

  if (existingRequest.rows.length > 0) {
    return errorResponse(409, 'Deletion request already pending');
  }

  const requestId = uuidv4();
  const confirmationCode = generateConfirmationCode();

  // Create deletion request
  await client.query(
    `INSERT INTO deletion_requests (
       id,
       user_id,
       reason,
       confirmation_code,
       status,
       created_at,
       expires_at
     ) VALUES ($1, $2, $3, $4, 'pending', NOW(), NOW() + INTERVAL '7 days')`,
    [requestId, userId, reason, confirmationCode]
  );

  // Log audit event
  await client.query(
    `INSERT INTO audit_log (
       action,
       resource_type,
       resource_id,
       user_id,
       actor_role,
       details,
       created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      'CREATE',
      'DeletionRequest',
      requestId,
      userId,
      'user',
      JSON.stringify({ reason }),
    ]
  );

  // Note: In production, send confirmation email with code

  return successResponse(201, {
    requestId,
    status: 'pending',
    message: 'Deletion request initiated. Please confirm within 7 days.',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    retentionNotice: `Per HIPAA regulations, anonymized health records will be retained for ${HIPAA_RETENTION_YEARS} years.`,
  });
}

/**
 * Get deletion request status.
 */
async function getDeletionStatus(client, userId) {
  const result = await client.query(
    `SELECT id, status, reason, created_at, expires_at, completed_at
     FROM deletion_requests
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return successResponse(200, {
      hasPendingRequest: false,
    });
  }

  const request = result.rows[0];

  return successResponse(200, {
    hasPendingRequest: request.status === 'pending',
    requestId: request.id,
    status: request.status,
    createdAt: request.created_at,
    expiresAt: request.expires_at,
    completedAt: request.completed_at,
  });
}

/**
 * Confirm and execute account deletion.
 */
async function confirmDeletion(client, event, userId) {
  const body = JSON.parse(event.body || '{}');
  const { requestId, confirmationCode } = body;

  if (!requestId || !confirmationCode) {
    return errorResponse(400, 'Request ID and confirmation code required');
  }

  // Verify deletion request
  const requestResult = await client.query(
    `SELECT id, confirmation_code, status, expires_at
     FROM deletion_requests
     WHERE id = $1 AND user_id = $2`,
    [requestId, userId]
  );

  if (requestResult.rows.length === 0) {
    return errorResponse(404, 'Deletion request not found');
  }

  const request = requestResult.rows[0];

  if (request.status !== 'pending') {
    return errorResponse(400, 'Deletion request is not pending');
  }

  if (new Date(request.expires_at) < new Date()) {
    return errorResponse(400, 'Deletion request has expired');
  }

  if (request.confirmation_code !== confirmationCode) {
    return errorResponse(400, 'Invalid confirmation code');
  }

  // Update status to processing
  await client.query(
    `UPDATE deletion_requests SET status = 'processing' WHERE id = $1`,
    [requestId]
  );

  try {
    // Get user's patient ID if they are a patient
    const patientResult = await client.query(
      `SELECT id FROM patients WHERE cognito_sub = $1`,
      [userId]
    );

    const patientId = patientResult.rows[0]?.id;

    // 1. Anonymize health records (HIPAA retention)
    if (patientId) {
      await anonymizeHealthRecords(client, patientId);
    }

    // 2. Delete S3 documents
    if (patientId) {
      await deleteS3Documents(patientId);
    }

    // 3. Delete personal data from RDS
    await deletePersonalData(client, userId, patientId);

    // 4. Disable Cognito user
    await disableCognitoUser(userId);

    // Update deletion request status
    await client.query(
      `UPDATE deletion_requests
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1`,
      [requestId]
    );

    // Final audit log (anonymized)
    await client.query(
      `INSERT INTO audit_log (
         action,
         resource_type,
         resource_id,
         user_id,
         actor_role,
         details,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        'DELETE',
        'Account',
        requestId,
        'ANONYMIZED',
        'system',
        JSON.stringify({ type: 'account_deletion_completed' }),
      ]
    );

    return successResponse(200, {
      success: true,
      message: 'Account deletion completed',
      retentionNotice: `Anonymized health records will be retained for ${HIPAA_RETENTION_YEARS} years per HIPAA requirements.`,
    });
  } catch (error) {
    // Update status to failed
    await client.query(
      `UPDATE deletion_requests
       SET status = 'failed', error_message = $2
       WHERE id = $1`,
      [requestId, error.message]
    );

    throw error;
  }
}

/**
 * Anonymize health records for HIPAA retention.
 */
async function anonymizeHealthRecords(client, patientId) {
  // Remove identifying information from observations
  await client.query(
    `UPDATE observations
     SET performer_name = 'ANONYMIZED',
         notes = NULL
     WHERE patient_id = $1`,
    [patientId]
  );

  // Remove identifying information from care plans
  await client.query(
    `UPDATE care_plans
     SET updated_by_name = 'ANONYMIZED'
     WHERE patient_id = $1`,
    [patientId]
  );

  // Update patient record to anonymized
  await client.query(
    `UPDATE patients
     SET name = 'ANONYMIZED',
         cognito_sub = NULL,
         conditions = '{}'
     WHERE id = $1`,
    [patientId]
  );

  console.log('Health records anonymized for patient:', patientId);
}

/**
 * Delete S3 documents for patient.
 */
async function deleteS3Documents(patientId) {
  const prefix = `${patientId}/`;

  // List all objects with patient prefix
  const listResult = await s3Client.send(new ListObjectsV2Command({
    Bucket: DOCUMENTS_BUCKET,
    Prefix: prefix,
  }));

  if (listResult.Contents && listResult.Contents.length > 0) {
    const deleteParams = {
      Bucket: DOCUMENTS_BUCKET,
      Delete: {
        Objects: listResult.Contents.map((obj) => ({ Key: obj.Key })),
      },
    };

    await s3Client.send(new DeleteObjectsCommand(deleteParams));
    console.log(`Deleted ${listResult.Contents.length} S3 objects for patient:`, patientId);
  }
}

/**
 * Delete personal data from RDS.
 */
async function deletePersonalData(client, userId, patientId) {
  // Delete consent records
  await client.query(
    `DELETE FROM consent_records WHERE user_id = $1`,
    [userId]
  );

  // Delete device tokens
  await client.query(
    `DELETE FROM device_tokens WHERE user_id = $1`,
    [userId]
  );

  // Delete persona links
  await client.query(
    `DELETE FROM persona_links WHERE user_id = $1`,
    [userId]
  );

  // Delete documents metadata
  if (patientId) {
    await client.query(
      `DELETE FROM documents WHERE patient_id = $1`,
      [patientId]
    );
  }

  // Delete user record
  await client.query(
    `DELETE FROM users WHERE cognito_sub = $1`,
    [userId]
  );

  console.log('Personal data deleted for user:', userId);
}

/**
 * Disable Cognito user account.
 */
async function disableCognitoUser(userId) {
  try {
    await cognitoClient.send(new AdminDisableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId,
    }));
    console.log('Cognito user disabled:', userId);
  } catch (error) {
    console.error('Failed to disable Cognito user:', error);
    // Continue with deletion even if Cognito fails
  }
}

/**
 * Generate 6-digit confirmation code.
 */
function generateConfirmationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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

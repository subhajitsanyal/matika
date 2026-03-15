/**
 * Doctor Documents Lambda
 *
 * API endpoints for doctors to view patient documents.
 */

const { Client } = require('pg');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
};

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET_NAME = process.env.S3_BUCKET_NAME;

exports.handler = async (event) => {
  console.log('Doctor documents request:', event.httpMethod, event.path);

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

    if (!userGroups.includes('doctors')) {
      return errorResponse(403, 'Only doctors can access this endpoint');
    }

    const patientId = event.pathParameters?.patientId;
    const documentId = event.pathParameters?.documentId;

    if (!patientId) {
      return errorResponse(400, 'Patient ID required');
    }

    // Verify doctor has access to patient
    const hasAccess = await checkAccess(client, userId, patientId);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied');
    }

    const path = event.path || '';

    switch (httpMethod) {
      case 'GET':
        if (documentId && path.endsWith('/download')) {
          return await getDownloadUrl(client, documentId, patientId);
        } else if (documentId) {
          return await getDocument(client, documentId, patientId);
        } else {
          return await listDocuments(client, event, patientId);
        }
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
 * List documents for a patient.
 */
async function listDocuments(client, event, patientId) {
  const queryParams = event.queryStringParameters || {};
  const fileType = queryParams.fileType;

  let query = `
    SELECT
      id,
      file_type,
      file_name,
      content_type,
      s3_key,
      uploaded_by_name as uploaded_by,
      created_at as uploaded_at
    FROM documents
    WHERE patient_id = $1 AND deleted_at IS NULL
  `;
  const params = [patientId];

  if (fileType) {
    query += ` AND file_type = $2`;
    params.push(fileType);
  }

  query += ` ORDER BY created_at DESC LIMIT 100`;

  const result = await client.query(query, params);

  const documents = result.rows.map((row) => ({
    id: row.id,
    fileType: row.file_type,
    fileName: row.file_name,
    contentType: row.content_type,
    s3Key: row.s3_key,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
  }));

  return successResponse(200, { documents });
}

/**
 * Get single document details.
 */
async function getDocument(client, documentId, patientId) {
  const result = await client.query(
    `SELECT
       id,
       file_type,
       file_name,
       content_type,
       s3_key,
       uploaded_by_name as uploaded_by,
       created_at as uploaded_at
     FROM documents
     WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL`,
    [documentId, patientId]
  );

  if (result.rows.length === 0) {
    return errorResponse(404, 'Document not found');
  }

  const doc = result.rows[0];

  return successResponse(200, {
    id: doc.id,
    fileType: doc.file_type,
    fileName: doc.file_name,
    contentType: doc.content_type,
    s3Key: doc.s3_key,
    uploadedBy: doc.uploaded_by,
    uploadedAt: doc.uploaded_at,
  });
}

/**
 * Generate presigned URL for document download.
 */
async function getDownloadUrl(client, documentId, patientId) {
  const result = await client.query(
    `SELECT s3_key, file_name, content_type
     FROM documents
     WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL`,
    [documentId, patientId]
  );

  if (result.rows.length === 0) {
    return errorResponse(404, 'Document not found');
  }

  const doc = result.rows[0];

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: doc.s3_key,
    ResponseContentDisposition: `attachment; filename="${doc.file_name}"`,
    ResponseContentType: doc.content_type,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15 minutes

  return successResponse(200, { url });
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

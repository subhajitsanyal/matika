/**
 * Data Export Lambda
 *
 * Generates FHIR Bundle export of all patient data.
 * Supports DPDP right to data portability.
 */

const { Client } = require('pg');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
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

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const EXPORT_BUCKET = process.env.EXPORT_BUCKET_NAME;
const HEALTHLAKE_ENDPOINT = process.env.HEALTHLAKE_ENDPOINT;

exports.handler = async (event) => {
  console.log('Data export request:', event.httpMethod, event.path);

  const client = await createDbConnection();

  try {
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

    // Check access - patient, relative, or doctor
    const hasAccess = await checkAccess(client, userId, patientId, userGroups);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied');
    }

    switch (httpMethod) {
      case 'POST':
        return await initiateExport(client, event, patientId, userId);
      case 'GET':
        return await getExportStatus(client, event, patientId);
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
 * Initiate data export.
 */
async function initiateExport(client, event, patientId, userId) {
  const exportId = uuidv4();

  // Create export request record
  await client.query(
    `INSERT INTO data_export_requests (
       id,
       patient_id,
       requested_by,
       status,
       created_at
     ) VALUES ($1, $2, $3, 'processing', NOW())`,
    [exportId, patientId, userId]
  );

  try {
    // Gather all patient data
    const bundle = await createFhirBundle(client, patientId);

    // Store in S3
    const s3Key = `exports/${patientId}/${exportId}.json`;

    await s3Client.send(new PutObjectCommand({
      Bucket: EXPORT_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(bundle, null, 2),
      ContentType: 'application/fhir+json',
      ServerSideEncryption: 'aws:kms',
      Metadata: {
        'patient-id': patientId,
        'export-id': exportId,
        'export-date': new Date().toISOString(),
      },
    }));

    // Generate presigned URL (valid for 24 hours)
    const downloadUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: EXPORT_BUCKET,
        Key: s3Key,
        ResponseContentDisposition: `attachment; filename="carelog-export-${patientId}.json"`,
      }),
      { expiresIn: 86400 }
    );

    // Update export request
    await client.query(
      `UPDATE data_export_requests
       SET status = 'completed', s3_key = $2, completed_at = NOW()
       WHERE id = $1`,
      [exportId, s3Key]
    );

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
        'CREATE',
        'DataExport',
        exportId,
        userId,
        'user',
        patientId,
        JSON.stringify({ resourceCount: bundle.entry?.length || 0 }),
      ]
    );

    return successResponse(201, {
      exportId,
      status: 'completed',
      downloadUrl,
      expiresIn: '24 hours',
      resourceCount: bundle.entry?.length || 0,
    });
  } catch (error) {
    // Update export request with error
    await client.query(
      `UPDATE data_export_requests
       SET status = 'failed', error_message = $2, completed_at = NOW()
       WHERE id = $1`,
      [exportId, error.message]
    );

    throw error;
  }
}

/**
 * Get export status.
 */
async function getExportStatus(client, event, patientId) {
  const exportId = event.queryStringParameters?.exportId;

  if (exportId) {
    // Get specific export
    const result = await client.query(
      `SELECT id, status, s3_key, created_at, completed_at, error_message
       FROM data_export_requests
       WHERE id = $1 AND patient_id = $2`,
      [exportId, patientId]
    );

    if (result.rows.length === 0) {
      return errorResponse(404, 'Export not found');
    }

    const exportReq = result.rows[0];

    let downloadUrl = null;
    if (exportReq.status === 'completed' && exportReq.s3_key) {
      downloadUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: EXPORT_BUCKET,
          Key: exportReq.s3_key,
          ResponseContentDisposition: `attachment; filename="carelog-export-${patientId}.json"`,
        }),
        { expiresIn: 86400 }
      );
    }

    return successResponse(200, {
      exportId: exportReq.id,
      status: exportReq.status,
      downloadUrl,
      createdAt: exportReq.created_at,
      completedAt: exportReq.completed_at,
      error: exportReq.error_message,
    });
  }

  // List recent exports
  const result = await client.query(
    `SELECT id, status, created_at, completed_at
     FROM data_export_requests
     WHERE patient_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [patientId]
  );

  return successResponse(200, {
    exports: result.rows.map((row) => ({
      exportId: row.id,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    })),
  });
}

/**
 * Create FHIR Bundle with all patient data.
 */
async function createFhirBundle(client, patientId) {
  const entries = [];

  // Get patient info
  const patientResult = await client.query(
    `SELECT * FROM patients WHERE id = $1`,
    [patientId]
  );

  if (patientResult.rows.length > 0) {
    const patient = patientResult.rows[0];
    entries.push({
      resource: {
        resourceType: 'Patient',
        id: patient.id,
        name: [{ text: patient.name }],
        gender: patient.gender?.toLowerCase(),
        birthDate: calculateBirthDate(patient.age),
      },
    });
  }

  // Get observations
  const observationsResult = await client.query(
    `SELECT * FROM observations WHERE patient_id = $1 ORDER BY created_at DESC`,
    [patientId]
  );

  for (const obs of observationsResult.rows) {
    entries.push({
      resource: {
        resourceType: 'Observation',
        id: obs.id,
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: obs.loinc_code }],
        },
        subject: { reference: `Patient/${patientId}` },
        effectiveDateTime: obs.created_at,
        valueQuantity: {
          value: obs.value,
          unit: obs.unit,
        },
        performer: obs.performer_id ? [{ reference: `Practitioner/${obs.performer_id}` }] : undefined,
      },
    });
  }

  // Get care plans
  const carePlansResult = await client.query(
    `SELECT * FROM care_plans WHERE patient_id = $1 AND is_current = true`,
    [patientId]
  );

  for (const carePlan of carePlansResult.rows) {
    entries.push({
      resource: {
        resourceType: 'CarePlan',
        id: carePlan.id,
        status: 'active',
        intent: 'plan',
        subject: { reference: `Patient/${patientId}` },
        description: carePlan.content,
        created: carePlan.created_at,
      },
    });
  }

  // Get documents metadata
  const documentsResult = await client.query(
    `SELECT * FROM documents WHERE patient_id = $1 AND deleted_at IS NULL`,
    [patientId]
  );

  for (const doc of documentsResult.rows) {
    entries.push({
      resource: {
        resourceType: 'DocumentReference',
        id: doc.id,
        status: 'current',
        type: {
          text: doc.file_type,
        },
        subject: { reference: `Patient/${patientId}` },
        date: doc.created_at,
        content: [
          {
            attachment: {
              contentType: doc.content_type,
              title: doc.file_name,
            },
          },
        ],
      },
    });
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date().toISOString(),
    total: entries.length,
    entry: entries,
  };
}

/**
 * Calculate approximate birth date from age.
 */
function calculateBirthDate(age) {
  if (!age) return undefined;
  const year = new Date().getFullYear() - age;
  return `${year}-01-01`;
}

/**
 * Check access permissions.
 */
async function checkAccess(client, userId, patientId, userGroups) {
  // Check if user is the patient
  const patientCheck = await client.query(
    `SELECT 1 FROM patients WHERE id = $1 AND cognito_sub = $2`,
    [patientId, userId]
  );
  if (patientCheck.rows.length > 0) return true;

  // Check persona links
  const linkCheck = await client.query(
    `SELECT 1 FROM persona_links
     WHERE user_id = $1 AND patient_id = $2 AND status = 'active'`,
    [userId, patientId]
  );
  return linkCheck.rows.length > 0;
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

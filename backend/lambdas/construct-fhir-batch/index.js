/**
 * CareLog Construct FHIR Batch Lambda
 *
 * POST /observations/batch
 *
 * Constructs FHIR R4 Observation resources from confirmed values:
 * - Builds FHIR JSON for each value with correct LOINC/UCUM coding
 * - Stores each Observation in S3 at the spec-defined key path
 * - Asynchronously invokes evaluate-thresholds-batch Lambda
 * - Returns list of created observation IDs and S3 keys
 *
 * Auth: Patient or caregiver linked to patient
 *
 * HIPAA Compliance:
 * - All PHI encrypted at rest (KMS) and in transit (TLS)
 * - Audit logging for observation creation
 */

const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const crypto = require('crypto');

const secretsClient = new SecretsManagerClient({});
const s3Client = new S3Client({});
const lambdaClient = new LambdaClient({});
let dbCredentials = null;

/**
 * LOINC code to UCUM unit mapping for common vitals.
 */
const LOINC_TO_UCUM = {
  '8480-6': { display: 'Systolic blood pressure', ucum: 'mm[Hg]', unit: 'mmHg', category: 'vital-signs' },
  '8462-4': { display: 'Diastolic blood pressure', ucum: 'mm[Hg]', unit: 'mmHg', category: 'vital-signs' },
  '2339-0': { display: 'Glucose [Mass/volume] in Blood', ucum: 'mg/dL', unit: 'mg/dL', category: 'vital-signs' },
  '8310-5': { display: 'Body temperature', ucum: 'Cel', unit: 'Cel', category: 'vital-signs' },
  '2708-6': { display: 'Oxygen saturation in Blood', ucum: '%', unit: '%', category: 'vital-signs' },
  '8867-4': { display: 'Heart rate', ucum: '/min', unit: '/min', category: 'vital-signs' },
  '29463-7': { display: 'Body weight', ucum: 'kg', unit: 'kg', category: 'vital-signs' },
};

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
  const patientCheck = await dbClient.query(
    `SELECT 1 FROM patients p
     JOIN users u ON p.user_id = u.id
     WHERE p.id = $1 AND u.cognito_sub = $2`,
    [patientDbId, cognitoSub]
  );
  if (patientCheck.rows.length > 0) return true;

  const linkCheck = await dbClient.query(
    `SELECT 1 FROM persona_links pl
     JOIN users u ON pl.linked_user_id = u.id
     WHERE pl.patient_id = $1 AND u.cognito_sub = $2 AND pl.is_active = true`,
    [patientDbId, cognitoSub]
  );
  return linkCheck.rows.length > 0;
}

/**
 * Construct a FHIR R4 Observation resource.
 */
function constructFhirObservation({ observationId, patientId, recordedBy, recordedAt, loincCode, parameterName, value, unit }) {
  const loincInfo = LOINC_TO_UCUM[loincCode] || {};
  const display = loincInfo.display || parameterName;
  const ucumCode = loincInfo.ucum || unit;
  const category = loincInfo.category || 'vital-signs';
  const now = new Date().toISOString();

  return {
    resourceType: 'Observation',
    id: observationId,
    status: 'final',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: category,
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: loincCode,
          display: display,
        },
      ],
    },
    subject: {
      reference: `Patient/${patientId}`,
    },
    effectiveDateTime: recordedAt,
    valueQuantity: {
      value: value,
      unit: unit,
      system: 'http://unitsofmeasure.org',
      code: ucumCode,
    },
    performer: [
      {
        reference: `Practitioner/${recordedBy}`,
      },
    ],
    meta: {
      lastUpdated: now,
      source: 'carelog-conversation',
    },
  };
}

/**
 * Generate the S3 key for a FHIR observation.
 * Pattern: observations/{patientId}/{YYYY}/{MM}/{DD}/{observationId}.json
 */
function generateObservationS3Key(patientId, observationId, recordedAt) {
  const date = new Date(recordedAt);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `observations/${patientId}/${yyyy}/${mm}/${dd}/${observationId}.json`;
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log('Construct FHIR batch request received');

  const claims = event.requestContext?.authorizer?.claims || {};
  const cognitoSub = claims.sub;

  if (!cognitoSub) {
    return errorResponse(401, 'Unauthorized');
  }

  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

  // Validate required fields
  if (!body.patient_id) {
    return errorResponse(400, 'Missing required field: patient_id');
  }
  if (!body.values || !Array.isArray(body.values) || body.values.length === 0) {
    return errorResponse(400, 'Missing required field: values (must be non-empty array)');
  }

  const patientId = body.patient_id;
  const sessionId = body.session_id || null;
  const recordedBy = body.recorded_by || cognitoSub;
  const recordedAt = body.recorded_at || new Date().toISOString();
  const bucket = process.env.S3_FHIR_BUCKET;

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    // Check access
    const hasAccess = await checkPatientAccess(dbClient, cognitoSub, patientId);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied');
    }

    const observationIds = [];
    const s3Keys = [];
    const uploadPromises = [];

    // Construct and store each FHIR Observation
    for (const val of body.values) {
      if (!val.loinc_code || val.value === undefined || val.value === null) {
        continue; // Skip invalid entries
      }

      const observationId = crypto.randomUUID();
      const fhirObservation = constructFhirObservation({
        observationId,
        patientId,
        recordedBy,
        recordedAt,
        loincCode: val.loinc_code,
        parameterName: val.parameter,
        value: val.value,
        unit: val.unit || LOINC_TO_UCUM[val.loinc_code]?.unit || '',
      });

      const s3Key = generateObservationS3Key(patientId, observationId, recordedAt);
      observationIds.push(observationId);
      s3Keys.push(s3Key);

      uploadPromises.push(
        s3Client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: s3Key,
            Body: JSON.stringify(fhirObservation, null, 2),
            ContentType: 'application/fhir+json',
            ServerSideEncryption: 'aws:kms',
          })
        )
      );
    }

    if (observationIds.length === 0) {
      return errorResponse(400, 'No valid observation values provided');
    }

    // Upload all observations to S3
    await Promise.all(uploadPromises);

    // Audit log
    const userIdResult = await dbClient.query(
      `SELECT id FROM users WHERE cognito_sub = $1`,
      [cognitoSub]
    );
    const userId = userIdResult.rows.length > 0 ? userIdResult.rows[0].id : null;

    if (userId) {
      await dbClient.query(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
         VALUES ($1, 'CREATE', 'observation_batch', $2, $3)`,
        [
          userId,
          sessionId || observationIds[0],
          JSON.stringify({
            patient_id: patientId,
            observation_count: observationIds.length,
            observation_ids: observationIds,
          }),
        ]
      );
    }

    // Asynchronously invoke evaluate-thresholds-batch Lambda
    let thresholdEvaluation = null;
    const evaluateFunctionName = process.env.EVALUATE_THRESHOLDS_FUNCTION_NAME;
    if (evaluateFunctionName) {
      try {
        const invokeCommand = new InvokeCommand({
          FunctionName: evaluateFunctionName,
          InvocationType: 'Event', // Async invocation
          Payload: JSON.stringify({
            patient_id: patientId,
            observation_ids: observationIds,
            s3_keys: s3Keys,
            values: body.values,
          }),
        });
        await lambdaClient.send(invokeCommand);
        thresholdEvaluation = { status: 'triggered' };
      } catch (invokeErr) {
        console.error('Failed to invoke evaluate-thresholds-batch:', invokeErr);
        thresholdEvaluation = { status: 'failed', error: invokeErr.message };
      }
    }

    const response = {
      observations_created: observationIds.length,
      observation_ids: observationIds,
      s3_keys: s3Keys,
    };

    if (thresholdEvaluation) {
      response.threshold_evaluation = thresholdEvaluation;
    }

    return successResponse(201, response);
  } catch (error) {
    console.error('Error constructing FHIR batch:', error);
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

// Export internals for testing
exports._constructFhirObservation = constructFhirObservation;
exports._generateObservationS3Key = generateObservationS3Key;
exports._LOINC_TO_UCUM = LOINC_TO_UCUM;

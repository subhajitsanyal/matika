/**
 * FHIR Observation Sync Lambda
 *
 * Accepts FHIR Observation resources, validates, and stores in S3.
 * S3 key format: observations/{patientId}/{YYYY}/{MM}/{DD}/{observationId}.json
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });
const S3_BUCKET = process.env.S3_BUCKET_NAME;
const S3_KMS_KEY_ID = process.env.S3_KMS_KEY_ID;

// LOINC codes for valid observation types
const VALID_LOINC_CODES = {
  '85354-9': 'Blood Pressure Panel',
  '8480-6': 'Systolic Blood Pressure',
  '8462-4': 'Diastolic Blood Pressure',
  '2339-0': 'Blood Glucose',
  '8310-5': 'Body Temperature',
  '29463-7': 'Body Weight',
  '8867-4': 'Heart Rate',
  '2708-6': 'Oxygen Saturation',
};

exports.handler = async (event) => {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;

    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;
    const userGroups = claims['cognito:groups'] || '';

    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    const validationResult = validateObservation(body);
    if (!validationResult.valid) {
      return errorResponse(400, validationResult.error);
    }

    const patientId = extractPatientId(body);
    const hasAccess = await checkPatientAccess(userId, patientId, userGroups);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied to patient data');
    }

    // Generate observation ID
    const observationId = body.id || `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Build observation with metadata
    const observation = {
      ...body,
      id: observationId,
      meta: {
        ...body.meta,
        lastUpdated: new Date().toISOString(),
        source: `urn:carelog:user:${userId}`,
      },
    };

    // Store in S3
    const now = new Date(observation.effectiveDateTime || Date.now());
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const loincCode = observation.code.coding[0].code;
    const vitalType = VALID_LOINC_CODES[loincCode] || 'Unknown';

    const s3Key = `observations/${patientId}/${yyyy}/${mm}/${dd}/${observationId}.json`;

    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(observation, null, 2),
      ContentType: 'application/fhir+json',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: S3_KMS_KEY_ID,
      Metadata: {
        'patient-id': patientId,
        'user-id': userId,
        'loinc-code': loincCode,
        'vital-type': vitalType,
        'http-method': httpMethod,
      },
    }));

    console.log(`Stored observation ${observationId} at s3://${S3_BUCKET}/${s3Key}`);

    return successResponse(httpMethod === 'POST' ? 201 : 200, {
      id: observationId,
      resourceType: 'Observation',
      meta: observation.meta,
      s3Key,
    });
  } catch (error) {
    console.error('Error processing observation:', error);
    return errorResponse(500, 'Internal server error');
  }
};

function validateObservation(resource) {
  if (!resource) return { valid: false, error: 'Resource body required' };
  if (resource.resourceType !== 'Observation') return { valid: false, error: 'Resource type must be Observation' };
  if (!resource.status) return { valid: false, error: 'Observation status required' };
  if (!resource.code?.coding?.[0]?.code) return { valid: false, error: 'Observation code required' };

  const loincCode = resource.code.coding[0].code;
  if (!VALID_LOINC_CODES[loincCode]) return { valid: false, error: `Invalid LOINC code: ${loincCode}` };
  if (!resource.subject?.reference) return { valid: false, error: 'Patient reference required' };

  return { valid: true };
}

function extractPatientId(resource) {
  const reference = resource.subject?.reference || '';
  return reference.replace('Patient/', '');
}

async function checkPatientAccess(userId, patientId, userGroups) {
  const validGroups = ['patients', 'attendants', 'relatives', 'doctors'];
  const groups = userGroups.split(',').map((g) => g.trim());
  return groups.some((g) => validGroups.includes(g));
}

function successResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/fhir+json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}

function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/fhir+json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: statusCode >= 500 ? 'exception' : 'invalid', diagnostics: message }],
    }),
  };
}

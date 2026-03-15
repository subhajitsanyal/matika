/**
 * DocumentReference Creation Lambda
 *
 * Creates FHIR DocumentReference after successful S3 upload.
 * Validates and stores in HealthLake.
 */

const {
  HealthLakeClient,
  CreateResourceCommand,
} = require('@aws-sdk/client-healthlake');

const healthLakeClient = new HealthLakeClient({
  region: process.env.AWS_REGION || 'ap-south-1',
});

const DATASTORE_ID = process.env.HEALTHLAKE_DATASTORE_ID;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Document type codes (custom codes for CareLog)
const DOCUMENT_TYPE_CODES = {
  prescription: { code: 'prescription', display: 'Prescription' },
  wound_photo: { code: 'wound-photo', display: 'Wound Photograph' },
  urine_photo: { code: 'urine-photo', display: 'Urine Photograph' },
  stool_photo: { code: 'stool-photo', display: 'Stool Photograph' },
  vomit_photo: { code: 'vomit-photo', display: 'Vomit Photograph' },
  medical_photo: { code: 'medical-photo', display: 'Medical Photograph' },
  voice_note: { code: 'voice-note', display: 'Voice Note' },
  video_note: { code: 'video-note', display: 'Video Note' },
  document: { code: 'document', display: 'General Document' },
};

exports.handler = async (event) => {
  console.log('Received DocumentReference creation request');

  try {
    // Parse request
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    // Get user info from Cognito authorizer
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;
    const userGroups = claims['cognito:groups'] || '';

    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    // Validate request
    const { patientId, s3Key, fileType, contentType, description } = body;

    if (!patientId) {
      return errorResponse(400, 'Patient ID required');
    }

    if (!s3Key) {
      return errorResponse(400, 'S3 key required');
    }

    if (!fileType || !DOCUMENT_TYPE_CODES[fileType]) {
      return errorResponse(400, 'Valid file type required');
    }

    if (!contentType) {
      return errorResponse(400, 'Content type required');
    }

    // Check authorization
    const hasAccess = await checkPatientAccess(userId, patientId, userGroups);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied to patient data');
    }

    // Create FHIR DocumentReference
    const typeCode = DOCUMENT_TYPE_CODES[fileType];
    const now = new Date().toISOString();

    const documentReference = {
      resourceType: 'DocumentReference',
      status: 'current',
      docStatus: 'final',
      type: {
        coding: [
          {
            system: 'urn:carelog:document-types',
            code: typeCode.code,
            display: typeCode.display,
          },
        ],
        text: typeCode.display,
      },
      subject: {
        reference: `Patient/${patientId}`,
      },
      date: now,
      author: [
        {
          reference: `Practitioner/${userId}`,
          display: 'CareLog User',
        },
      ],
      description: description || typeCode.display,
      content: [
        {
          attachment: {
            contentType,
            url: `s3://${S3_BUCKET_NAME}/${s3Key}`,
            title: extractFilename(s3Key),
            creation: now,
          },
        },
      ],
      context: {
        related: [
          {
            reference: `Patient/${patientId}`,
          },
        ],
      },
      meta: {
        lastUpdated: now,
        source: `urn:carelog:user:${userId}`,
      },
    };

    // Store in HealthLake
    const result = await createDocumentReference(documentReference);

    // Log audit event
    await logAuditEvent({
      action: 'CREATE',
      resourceType: 'DocumentReference',
      resourceId: result.id,
      userId,
      patientId,
      s3Key,
    });

    return successResponse(201, {
      id: result.id,
      resourceType: 'DocumentReference',
      s3Key,
      fileType,
    });
  } catch (error) {
    console.error('Error creating DocumentReference:', error);
    return errorResponse(500, 'Internal server error');
  }
};

/**
 * Extract filename from S3 key.
 */
function extractFilename(s3Key) {
  const parts = s3Key.split('/');
  return parts[parts.length - 1];
}

/**
 * Create DocumentReference in HealthLake.
 */
async function createDocumentReference(documentReference) {
  const command = new CreateResourceCommand({
    datastoreId: DATASTORE_ID,
    resourceType: 'DocumentReference',
    resourceBody: JSON.stringify(documentReference),
  });

  const response = await healthLakeClient.send(command);
  const createdResource = JSON.parse(response.resourceBody || '{}');

  return {
    id: createdResource.id,
    meta: createdResource.meta,
  };
}

/**
 * Check if user has access to patient data.
 */
async function checkPatientAccess(userId, patientId, userGroups) {
  const validGroups = ['patients', 'attendants', 'relatives', 'doctors'];
  const groups = userGroups.split(',').map((g) => g.trim());
  return groups.some((g) => validGroups.includes(g));
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
      'Content-Type': 'application/fhir+json',
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
      'Content-Type': 'application/fhir+json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      resourceType: 'OperationOutcome',
      issue: [
        {
          severity: 'error',
          code: statusCode >= 500 ? 'exception' : 'invalid',
          diagnostics: message,
        },
      ],
    }),
  };
}

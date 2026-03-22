/**
 * FHIR Observation Sync Lambda
 *
 * Accepts FHIR Observation resources, validates, and writes to HealthLake.
 * Returns server-assigned resource ID.
 */

const {
  HealthLakeClient,
  CreateResourceCommand,
  UpdateResourceCommand,
} = require('@aws-sdk/client-healthlake');

const healthLakeClient = new HealthLakeClient({
  region: process.env.AWS_REGION || 'ap-south-1',
});

const DATASTORE_ID = process.env.HEALTHLAKE_DATASTORE_ID;

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
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    // Parse request
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;

    // Get user info from Cognito authorizer
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;
    const userGroups = claims['cognito:groups'] || '';

    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    // Validate FHIR resource
    const validationResult = validateObservation(body);
    if (!validationResult.valid) {
      return errorResponse(400, validationResult.error);
    }

    // Check authorization - user must have access to this patient
    const patientId = extractPatientId(body);
    const hasAccess = await checkPatientAccess(userId, patientId, userGroups);
    if (!hasAccess) {
      return errorResponse(403, 'Access denied to patient data');
    }

    // Add metadata
    const observation = {
      ...body,
      meta: {
        ...body.meta,
        lastUpdated: new Date().toISOString(),
        source: `urn:carelog:user:${userId}`,
      },
    };

    let result;
    if (httpMethod === 'POST') {
      // Create new observation
      result = await createObservation(observation);
    } else if (httpMethod === 'PUT') {
      // Update existing observation
      const resourceId = event.pathParameters?.id || body.id;
      if (!resourceId) {
        return errorResponse(400, 'Resource ID required for update');
      }
      result = await updateObservation(resourceId, observation);
    } else {
      return errorResponse(405, 'Method not allowed');
    }

    // Log to audit trail
    await logAuditEvent({
      action: httpMethod === 'POST' ? 'CREATE' : 'UPDATE',
      resourceType: 'Observation',
      resourceId: result.id,
      userId,
      patientId,
    });

    return successResponse(httpMethod === 'POST' ? 201 : 200, result);
  } catch (error) {
    console.error('Error processing observation:', error);
    return errorResponse(500, 'Internal server error');
  }
};

/**
 * Validate FHIR Observation resource.
 */
function validateObservation(resource) {
  if (!resource) {
    return { valid: false, error: 'Resource body required' };
  }

  if (resource.resourceType !== 'Observation') {
    return { valid: false, error: 'Resource type must be Observation' };
  }

  if (!resource.status) {
    return { valid: false, error: 'Observation status required' };
  }

  if (!resource.code?.coding?.[0]?.code) {
    return { valid: false, error: 'Observation code required' };
  }

  const loincCode = resource.code.coding[0].code;
  if (!VALID_LOINC_CODES[loincCode]) {
    return { valid: false, error: `Invalid LOINC code: ${loincCode}` };
  }

  if (!resource.subject?.reference) {
    return { valid: false, error: 'Patient reference required' };
  }

  if (!resource.effectiveDateTime) {
    return { valid: false, error: 'Effective date/time required' };
  }

  return { valid: true };
}

/**
 * Extract patient ID from FHIR resource.
 */
function extractPatientId(resource) {
  const reference = resource.subject?.reference || '';
  // Format: "Patient/123" or just "123"
  return reference.replace('Patient/', '');
}

/**
 * Check if user has access to patient data.
 */
async function checkPatientAccess(userId, patientId, userGroups) {
  // TODO: Implement actual access check against RDS persona_links table
  // For now, allow access if user is in any valid group
  const validGroups = ['patients', 'attendants', 'relatives', 'doctors'];
  const groups = userGroups.split(',').map((g) => g.trim());
  return groups.some((g) => validGroups.includes(g));
}

/**
 * Create new observation in HealthLake.
 * Falls back to local ID generation if HealthLake is not configured.
 */
async function createObservation(observation) {
  if (!DATASTORE_ID || DATASTORE_ID === 'placeholder' || DATASTORE_ID === '') {
    // HealthLake not configured — generate local ID and return
    const id = `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`HealthLake not configured, generated local ID: ${id}`);
    return {
      id,
      resourceType: 'Observation',
      meta: { lastUpdated: new Date().toISOString(), versionId: '1' },
    };
  }

  const command = new CreateResourceCommand({
    datastoreId: DATASTORE_ID,
    resourceType: 'Observation',
    resourceBody: JSON.stringify(observation),
  });

  const response = await healthLakeClient.send(command);
  const createdResource = JSON.parse(response.resourceBody || '{}');

  return {
    id: createdResource.id,
    resourceType: 'Observation',
    meta: createdResource.meta,
  };
}

/**
 * Update existing observation in HealthLake.
 */
async function updateObservation(resourceId, observation) {
  if (!DATASTORE_ID || DATASTORE_ID === 'placeholder' || DATASTORE_ID === '') {
    console.log(`HealthLake not configured, returning update stub for ID: ${resourceId}`);
    return {
      id: resourceId,
      resourceType: 'Observation',
      meta: { lastUpdated: new Date().toISOString(), versionId: '2' },
    };
  }

  const command = new UpdateResourceCommand({
    datastoreId: DATASTORE_ID,
    resourceType: 'Observation',
    resourceId,
    resourceBody: JSON.stringify({
      ...observation,
      id: resourceId,
    }),
  });

  const response = await healthLakeClient.send(command);
  const updatedResource = JSON.parse(response.resourceBody || '{}');

  return {
    id: updatedResource.id,
    resourceType: 'Observation',
    meta: updatedResource.meta,
  };
}

/**
 * Log audit event.
 */
async function logAuditEvent(event) {
  // TODO: Write to RDS audit_log table
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

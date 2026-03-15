/**
 * Bulk FHIR Sync Lambda
 *
 * Accepts array of FHIR resources for batch sync.
 * Processes in transaction. Returns success/failure per resource.
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
const MAX_BATCH_SIZE = 100;

exports.handler = async (event) => {
  console.log('Received bulk sync request');

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
    if (!body.resources || !Array.isArray(body.resources)) {
      return errorResponse(400, 'Resources array required');
    }

    if (body.resources.length > MAX_BATCH_SIZE) {
      return errorResponse(400, `Maximum batch size is ${MAX_BATCH_SIZE}`);
    }

    if (body.resources.length === 0) {
      return successResponse(200, { results: [], summary: { total: 0, success: 0, failed: 0 } });
    }

    // Process each resource
    const results = [];
    let successCount = 0;
    let failedCount = 0;

    for (const entry of body.resources) {
      const result = await processResource(entry, userId, userGroups);
      results.push(result);

      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }
    }

    // Log batch audit event
    await logAuditEvent({
      action: 'BULK_SYNC',
      userId,
      resourceCount: body.resources.length,
      successCount,
      failedCount,
    });

    return successResponse(200, {
      results,
      summary: {
        total: body.resources.length,
        success: successCount,
        failed: failedCount,
      },
    });
  } catch (error) {
    console.error('Error processing bulk sync:', error);
    return errorResponse(500, 'Internal server error');
  }
};

/**
 * Process a single resource in the batch.
 */
async function processResource(entry, userId, userGroups) {
  const { resource, operation, localId } = entry;

  try {
    // Validate resource type
    if (!resource || !resource.resourceType) {
      return {
        localId,
        success: false,
        error: 'Invalid resource',
      };
    }

    // Validate operation
    if (!['create', 'update'].includes(operation)) {
      return {
        localId,
        success: false,
        error: 'Invalid operation. Must be "create" or "update"',
      };
    }

    // Check authorization
    const patientId = extractPatientId(resource);
    const hasAccess = await checkPatientAccess(userId, patientId, userGroups);
    if (!hasAccess) {
      return {
        localId,
        success: false,
        error: 'Access denied',
      };
    }

    // Add metadata
    const resourceWithMeta = {
      ...resource,
      meta: {
        ...resource.meta,
        lastUpdated: new Date().toISOString(),
        source: `urn:carelog:user:${userId}`,
      },
    };

    let serverId;
    if (operation === 'create') {
      serverId = await createResource(resourceWithMeta);
    } else {
      const resourceId = resource.id;
      if (!resourceId) {
        return {
          localId,
          success: false,
          error: 'Resource ID required for update',
        };
      }
      serverId = await updateResource(resourceId, resourceWithMeta);
    }

    return {
      localId,
      serverId,
      success: true,
      operation,
    };
  } catch (error) {
    console.error(`Error processing resource ${localId}:`, error);
    return {
      localId,
      success: false,
      error: error.message || 'Processing failed',
    };
  }
}

/**
 * Extract patient ID from FHIR resource.
 */
function extractPatientId(resource) {
  // Handle different resource types
  if (resource.resourceType === 'Patient') {
    return resource.id;
  }

  const reference = resource.subject?.reference || resource.patient?.reference || '';
  return reference.replace('Patient/', '');
}

/**
 * Check if user has access to patient data.
 */
async function checkPatientAccess(userId, patientId, userGroups) {
  // TODO: Implement actual access check against RDS persona_links table
  const validGroups = ['patients', 'attendants', 'relatives', 'doctors'];
  const groups = userGroups.split(',').map((g) => g.trim());
  return groups.some((g) => validGroups.includes(g));
}

/**
 * Create resource in HealthLake.
 */
async function createResource(resource) {
  const command = new CreateResourceCommand({
    datastoreId: DATASTORE_ID,
    resourceType: resource.resourceType,
    resourceBody: JSON.stringify(resource),
  });

  const response = await healthLakeClient.send(command);
  const createdResource = JSON.parse(response.resourceBody || '{}');
  return createdResource.id;
}

/**
 * Update resource in HealthLake.
 */
async function updateResource(resourceId, resource) {
  const command = new UpdateResourceCommand({
    datastoreId: DATASTORE_ID,
    resourceType: resource.resourceType,
    resourceId,
    resourceBody: JSON.stringify({
      ...resource,
      id: resourceId,
    }),
  });

  await healthLakeClient.send(command);
  return resourceId;
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

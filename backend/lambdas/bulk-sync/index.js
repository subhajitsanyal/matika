/**
 * Bulk FHIR Sync Lambda
 *
 * Accepts array of FHIR resources for batch sync to S3.
 * Returns success/failure per resource.
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });
const S3_BUCKET = process.env.S3_BUCKET_NAME;
const MAX_BATCH_SIZE = 100;

exports.handler = async (event) => {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;
    const userGroups = claims['cognito:groups'] || '';

    if (!userId) return errorResponse(401, 'Unauthorized');
    if (!body.resources || !Array.isArray(body.resources)) return errorResponse(400, 'Resources array required');
    if (body.resources.length > MAX_BATCH_SIZE) return errorResponse(400, `Maximum batch size is ${MAX_BATCH_SIZE}`);
    if (body.resources.length === 0) return successResponse(200, { results: [], summary: { total: 0, success: 0, failed: 0 } });

    const results = [];
    let successCount = 0;
    let failedCount = 0;

    for (const entry of body.resources) {
      const result = await processResource(entry, userId, userGroups);
      results.push(result);
      if (result.success) successCount++;
      else failedCount++;
    }

    console.log(`Bulk sync: ${successCount} succeeded, ${failedCount} failed out of ${body.resources.length}`);

    return successResponse(200, {
      results,
      summary: { total: body.resources.length, success: successCount, failed: failedCount },
    });
  } catch (error) {
    console.error('Error processing bulk sync:', error);
    return errorResponse(500, 'Internal server error');
  }
};

async function processResource(entry, userId, userGroups) {
  const { resource, operation, localId } = entry;

  try {
    if (!resource || !resource.resourceType) return { localId, success: false, error: 'Invalid resource' };
    if (!['create', 'update'].includes(operation)) return { localId, success: false, error: 'Invalid operation' };

    const patientId = extractPatientId(resource);
    const hasAccess = await checkPatientAccess(userId, patientId, userGroups);
    if (!hasAccess) return { localId, success: false, error: 'Access denied' };

    const resourceId = resource.id || `${resource.resourceType.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const resourceWithMeta = {
      ...resource,
      id: resourceId,
      meta: {
        ...resource.meta,
        lastUpdated: new Date().toISOString(),
        source: `urn:carelog:user:${userId}`,
      },
    };

    // Build S3 key based on resource type
    const now = new Date(resource.effectiveDateTime || Date.now());
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const folder = resource.resourceType === 'Observation' ? 'observations' : 'resources';
    const s3Key = `${folder}/${patientId}/${yyyy}/${mm}/${dd}/${resourceId}.json`;

    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(resourceWithMeta, null, 2),
      ContentType: 'application/fhir+json',
      Metadata: {
        'patient-id': patientId,
        'user-id': userId,
        'resource-type': resource.resourceType,
        'operation': operation,
      },
    }));

    return { localId, serverId: resourceId, success: true, operation, s3Key };
  } catch (error) {
    console.error(`Error processing resource ${localId}:`, error);
    return { localId, success: false, error: error.message || 'Processing failed' };
  }
}

function extractPatientId(resource) {
  if (resource.resourceType === 'Patient') return resource.id;
  const reference = resource.subject?.reference || resource.patient?.reference || '';
  return reference.replace('Patient/', '');
}

async function checkPatientAccess(userId, patientId, userGroups) {
  const validGroups = ['patients', 'attendants', 'relatives', 'doctors'];
  const groups = userGroups.split(',').map((g) => g.trim());
  return groups.some((g) => validGroups.includes(g));
}

function successResponse(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

function errorResponse(statusCode, message) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: message }) };
}

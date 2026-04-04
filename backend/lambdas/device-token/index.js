/**
 * Device Token Registration Lambda
 *
 * Registers device tokens for push notifications.
 * Creates SNS platform endpoints for iOS (APNs) and Android (FCM).
 */

const { SNSClient, CreatePlatformEndpointCommand, DeleteEndpointCommand, SetEndpointAttributesCommand, GetEndpointAttributesCommand } = require('@aws-sdk/client-sns');
const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const snsClient = new SNSClient({ region: process.env.AWS_REGION });
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

// Platform application ARNs
const PLATFORM_ARNS = {
  ios: process.env.IOS_PLATFORM_ARN,
  android: process.env.ANDROID_PLATFORM_ARN,
};

exports.handler = async (event) => {
  console.log('Device token request:', event.httpMethod, event.path);

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
        return await registerToken(client, event, userId);
      case 'DELETE':
        return await unregisterToken(client, event, userId);
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
 * Register a device token.
 */
async function registerToken(client, event, userId) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

  const { deviceToken, platform, deviceId } = body;

  // Validate inputs
  if (!deviceToken || !platform || !deviceId) {
    return errorResponse(400, 'deviceToken, platform, and deviceId are required');
  }

  if (!['ios', 'android'].includes(platform)) {
    return errorResponse(400, 'platform must be "ios" or "android"');
  }

  const platformArn = PLATFORM_ARNS[platform];
  if (!platformArn) {
    return errorResponse(500, 'Platform not configured');
  }

  try {
    // Check if we have an existing endpoint for this device
    const existingResult = await client.query(
      `SELECT endpoint_arn FROM device_tokens WHERE device_id = $1 AND user_id = $2`,
      [deviceId, userId]
    );

    let endpointArn;

    if (existingResult.rows.length > 0) {
      // Update existing endpoint
      endpointArn = existingResult.rows[0].endpoint_arn;

      try {
        // Check if endpoint still exists and update token
        await snsClient.send(new GetEndpointAttributesCommand({
          EndpointArn: endpointArn,
        }));

        // Update the token on existing endpoint
        await snsClient.send(new SetEndpointAttributesCommand({
          EndpointArn: endpointArn,
          Attributes: {
            Token: deviceToken,
            Enabled: 'true',
          },
        }));
      } catch (snsError) {
        // Endpoint doesn't exist anymore, create new one
        if (snsError.name === 'NotFoundException') {
          endpointArn = await createEndpoint(platformArn, deviceToken, userId);
        } else {
          throw snsError;
        }
      }
    } else {
      // Create new endpoint
      endpointArn = await createEndpoint(platformArn, deviceToken, userId);
    }

    // Upsert device token record
    await client.query(
      `INSERT INTO device_tokens (user_id, device_id, device_token, platform, endpoint_arn, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (device_id, user_id)
       DO UPDATE SET
         device_token = EXCLUDED.device_token,
         endpoint_arn = EXCLUDED.endpoint_arn,
         updated_at = NOW()`,
      [userId, deviceId, deviceToken, platform, endpointArn]
    );

    console.log(`Registered device token for user ${userId}, device ${deviceId}`);

    return successResponse(200, {
      message: 'Device token registered successfully',
      endpointArn,
    });
  } catch (error) {
    console.error('Failed to register device token:', error);
    return errorResponse(500, 'Failed to register device token');
  }
}

/**
 * Create SNS platform endpoint.
 */
async function createEndpoint(platformArn, deviceToken, userId) {
  const response = await snsClient.send(new CreatePlatformEndpointCommand({
    PlatformApplicationArn: platformArn,
    Token: deviceToken,
    CustomUserData: userId,
    Attributes: {
      Enabled: 'true',
    },
  }));

  return response.EndpointArn;
}

/**
 * Unregister a device token.
 */
async function unregisterToken(client, event, userId) {
  const deviceId = event.pathParameters?.deviceId || event.queryStringParameters?.deviceId;

  if (!deviceId) {
    return errorResponse(400, 'deviceId is required');
  }

  // Get existing endpoint
  const result = await client.query(
    `SELECT endpoint_arn FROM device_tokens WHERE device_id = $1 AND user_id = $2`,
    [deviceId, userId]
  );

  if (result.rows.length === 0) {
    return errorResponse(404, 'Device not found');
  }

  const endpointArn = result.rows[0].endpoint_arn;

  try {
    // Delete SNS endpoint
    if (endpointArn) {
      await snsClient.send(new DeleteEndpointCommand({
        EndpointArn: endpointArn,
      }));
    }
  } catch (snsError) {
    // Ignore if endpoint already deleted
    if (snsError.name !== 'NotFoundException') {
      console.error('Failed to delete SNS endpoint:', snsError);
    }
  }

  // Delete from database
  await client.query(
    `DELETE FROM device_tokens WHERE device_id = $1 AND user_id = $2`,
    [deviceId, userId]
  );

  console.log(`Unregistered device token for user ${userId}, device ${deviceId}`);

  return successResponse(200, {
    message: 'Device token unregistered successfully',
  });
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
    body: JSON.stringify({ error: message }),
  };
}

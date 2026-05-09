/**
 * Notification Sender Lambda
 *
 * Sends push notifications for threshold breaches, missed measurements,
 * and daily reminders. Pure SQS consumer of the v2 alert queue —
 * upstream producers are evaluate-thresholds-batch, check-missed-measurements,
 * check-daily-deadline, and the bedrock-router emergency path.
 *
 * Each handler:
 *   - Resolves device tokens via persona_links / users / device_tokens.
 *   - Hands off the platform-specific payload to SNS Mobile Push.
 *   - Stamps `alerts.is_sent / sent_at / send_error` so the row reflects
 *     what happened (success or no-transport / no-token).
 */

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
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

// SQS message `type` values produced by the v2 upstream lambdas. The
// notification-sender accepts only these; older uppercase variants
// (THRESHOLD_BREACH / REMINDER_LAPSE) are no longer emitted by anything
// in v2 and the legacy handler paths were removed (F14, 2026-05-09).
const P2_ALERT_TYPES = {
  THRESHOLD_BREACH: 'threshold_breach',
  MISSED_MEASUREMENT: 'missed_measurement',
  REMINDER: 'reminder',
};

// parameter_name → human-readable label, used in push title/body strings.
const VITAL_DISPLAY_NAMES = {
  blood_pressure_systolic: 'Blood Pressure (Systolic)',
  blood_pressure_diastolic: 'Blood Pressure (Diastolic)',
  blood_glucose: 'Blood Glucose',
  body_temperature: 'Body Temperature',
  body_weight: 'Weight',
  heart_rate: 'Heart Rate',
  oxygen_saturation: 'SpO2',
};

exports.handler = async (event) => {
  console.log('Notification sender triggered:', JSON.stringify(event));

  const client = await createDbConnection();

  try {
    if (event.Records) {
      for (const record of event.Records) {
        const message = JSON.parse(record.body);
        await processNotificationMessage(client, message);
      }
    } else {
      console.warn('Notification sender invoked with no SQS Records; ignoring.', {
        eventKeys: Object.keys(event || {}),
      });
    }

    return { statusCode: 200, body: 'Notifications processed' };
  } catch (error) {
    console.error('Error processing notifications:', error);
    throw error;
  } finally {
    await client.end();
  }
};

/**
 * Dispatch a single SQS message to the right handler.
 */
async function processNotificationMessage(client, message) {
  switch (message.type) {
    case P2_ALERT_TYPES.THRESHOLD_BREACH:
      await handleThresholdBreachNotification(client, message);
      break;
    case P2_ALERT_TYPES.MISSED_MEASUREMENT:
      await handleMissedMeasurementNotification(client, message);
      break;
    case P2_ALERT_TYPES.REMINDER:
      await handleReminderNotification(client, message);
      break;
    default:
      console.warn('Unknown message type:', message.type);
  }
}

/**
 * Handle P2 threshold breach notification.
 * Looks up caregiver device token and sends FCM via SNS.
 */
async function handleThresholdBreachNotification(client, message) {
  const {
    patient_id: patientId,
    caregiver_id: caregiverId,
    parameter,
    display_name: displayName,
    value,
    unit,
    threshold_max: thresholdMax,
    threshold_min: thresholdMin,
    patient_name: patientName,
    alert_id: alertId,
  } = message;

  const prettyName = displayName || (VITAL_DISPLAY_NAMES[parameter] || parameter.replace(/_/g, ' '));
  const threshold = thresholdMax !== null && thresholdMax !== undefined ? thresholdMax : thresholdMin;
  const direction = thresholdMax !== null && thresholdMax !== undefined ? 'above' : 'below';

  const title = `Alert: High ${prettyName}`;
  const body = `${patientName || 'Patient'}'s ${prettyName.toLowerCase()} is ${value} ${unit || ''} -- ${direction} ${threshold} threshold`;

  // Find caregiver device endpoints
  const endpoints = await getCaregiverDeviceEndpoints(client, patientId, caregiverId);

  if (endpoints.length === 0) {
    console.warn('No active caregiver device tokens found', { patientId, caregiverId, alertId });
  }

  let anyDelivered = false;
  for (const endpoint of endpoints) {
    try {
      const delivered = await sendPushNotification(endpoint.device_token, endpoint.platform, title, body, {
        alert_type: P2_ALERT_TYPES.THRESHOLD_BREACH,
        patient_id: patientId,
        parameter,
        value: String(value),
        threshold: String(threshold),
      });

      if (delivered) {
        anyDelivered = true;
        console.log(`Sent threshold breach notification to caregiver ${endpoint.user_name || endpoint.user_id}`);
      }
    } catch (error) {
      console.error(`Failed to send threshold breach notification:`, error);
    }
  }

  await markAlertSent(client, alertId, anyDelivered);
}

/**
 * Handle P2 missed measurement notification.
 * Looks up caregiver device token and sends FCM via SNS.
 */
async function handleMissedMeasurementNotification(client, message) {
  const {
    patient_id: patientId,
    caregiver_id: caregiverId,
    parameter,
    display_name: displayName,
    patient_name: patientName,
    days_overdue: daysOverdue,
    configured_frequency_days: frequencyDays,
  } = message;

  const prettyName = displayName || (VITAL_DISPLAY_NAMES[parameter] || parameter.replace(/_/g, ' '));
  const title = `Missed Measurement: ${prettyName}`;
  const body = message.body || `${patientName || 'Patient'} hasn't logged ${prettyName.toLowerCase()} in ${daysOverdue + frequencyDays} days (configured: every ${frequencyDays} days)`;

  // Find caregiver device endpoints
  const endpoints = await getCaregiverDeviceEndpoints(client, patientId, caregiverId);

  if (endpoints.length === 0) {
    console.warn('No active caregiver device tokens found', { patientId, caregiverId, alertId: message.alert_id });
  }

  let anyDelivered = false;
  for (const endpoint of endpoints) {
    try {
      const delivered = await sendPushNotification(endpoint.device_token, endpoint.platform, title, body, {
        alert_type: P2_ALERT_TYPES.MISSED_MEASUREMENT,
        patient_id: patientId,
        parameter,
        days_overdue: String(daysOverdue),
        configured_frequency_days: String(frequencyDays),
      });

      if (delivered) {
        anyDelivered = true;
        console.log(`Sent missed measurement notification for ${parameter} to caregiver`);
      }
    } catch (error) {
      console.error(`Failed to send missed measurement notification:`, error);
    }
  }

  await markAlertSent(client, message.alert_id, anyDelivered);
}

/**
 * Handle P2 reminder notification.
 * Sends reminder directly to the patient's device.
 */
async function handleReminderNotification(client, message) {
  const {
    patient_id: patientId,
    title: msgTitle,
    body: msgBody,
    action,
  } = message;

  const title = msgTitle || 'Health Check Reminder';
  const body = msgBody || 'It\'s time to log your health readings. Tap to start.';

  // Get patient's device endpoint
  const patientEndpoints = await getPatientDeviceEndpoints(client, patientId);

  if (patientEndpoints.length === 0) {
    console.warn('No active patient device tokens found', { patientId, alertId: message.alert_id });
  }

  let anyDelivered = false;
  for (const endpoint of patientEndpoints) {
    try {
      const delivered = await sendPushNotification(endpoint.device_token, endpoint.platform, title, body, {
        alert_type: P2_ALERT_TYPES.REMINDER,
        patient_id: patientId,
        action: action || 'open_conversation',
      });

      if (delivered) {
        anyDelivered = true;
        console.log(`Sent reminder notification to patient ${patientId}`);
      }
    } catch (error) {
      console.error(`Failed to send reminder notification:`, error);
    }
  }

  await markAlertSent(client, message.alert_id, anyDelivered);
}

/**
 * Get caregiver device endpoints for a patient.
 *
 * Schema notes (V001+):
 *   device_tokens.user_id is users.id (UUID), NOT users.cognito_sub. Earlier
 *   versions of this lambda joined `dt.user_id = u.cognito_sub` which always
 *   returned 0 rows due to the UUID-vs-text type mismatch.
 *
 *   The platform-specific transport credential is `device_tokens.device_token`
 *   (raw FCM/APNs token). The SNS-Platform-Endpoint-ARN column referenced by
 *   the older code (`endpoint_arn`) does not exist in the live schema.
 */
async function getCaregiverDeviceEndpoints(client, patientId, caregiverId) {
  let query;
  let params;

  if (caregiverId) {
    // Direct lookup by caregiver ID (the caregiver_id we ship in the SQS
    // payload is the resolved users.id UUID — see evaluate-thresholds-batch).
    query = `
      SELECT dt.device_token, dt.platform, u.name AS user_name, u.id AS user_id
      FROM device_tokens dt
      JOIN users u ON dt.user_id = u.id
      WHERE u.id = $1 AND dt.is_active = true`;
    params = [caregiverId];
  } else {
    // Find all caregivers linked to the patient.
    query = `
      SELECT dt.device_token, dt.platform, u.name AS user_name, pl.linked_user_id AS user_id
      FROM persona_links pl
      JOIN users u ON pl.linked_user_id = u.id
      JOIN device_tokens dt ON dt.user_id = u.id
      WHERE pl.patient_id = $1 AND pl.is_active = true AND pl.relationship = 'caregiver'
        AND dt.is_active = true`;
    params = [patientId];
  }

  const result = await client.query(query, params);
  return result.rows;
}

/**
 * Get patient device endpoints. Same schema fix as
 * getCaregiverDeviceEndpoints.
 */
async function getPatientDeviceEndpoints(client, patientId) {
  const result = await client.query(
    `SELECT dt.device_token, dt.platform, u.id AS user_id
     FROM patients p
     JOIN users u ON p.user_id = u.id
     JOIN device_tokens dt ON dt.user_id = u.id
     WHERE p.id = $1 AND dt.is_active = true`,
    [patientId]
  );
  return result.rows;
}

/**
 * Send push notification.
 *
 * Today the dev environment has no SNS Platform Application configured
 * (`IOS_PLATFORM_ARN` / `ANDROID_PLATFORM_ARN` env vars unset) and the live
 * device_tokens schema stores the raw FCM/APNs token, not an SNS endpoint
 * ARN. Until the platform-application infra is provisioned (or this lambda
 * is rewired to talk directly to FCM HTTP v1 / APNs), there is no transport
 * to call.
 *
 * Behavior:
 *   - When no transport is wired (env vars unset): log once per call and
 *     return false. Backend chain still completes (alerts row + sent_at
 *     bookkeeping); the push side is a no-op.
 *   - When transport IS wired: build the platform-specific payload and
 *     hand to SNS. Returns true on success.
 */
async function sendPushNotification(deviceToken, platform, title, body, data) {
  const platformArn =
    platform === 'ios' ? process.env.IOS_PLATFORM_ARN : process.env.ANDROID_PLATFORM_ARN;

  if (!platformArn) {
    console.warn(
      `Push transport not configured (${platform.toUpperCase()}_PLATFORM_ARN unset); skipping delivery`,
      { platform, hasToken: Boolean(deviceToken) }
    );
    return false;
  }

  if (!deviceToken) {
    console.warn('No device token to push to; skipping delivery', { platform });
    return false;
  }

  // Per-call ad-hoc endpoint: register the token with SNS (idempotent —
  // re-using an existing endpoint is allowed). We don't persist the
  // returned ARN today because device_tokens has no endpoint_arn column;
  // see F15 follow-up to add it + persist.
  const { CreatePlatformEndpointCommand } = require('@aws-sdk/client-sns');
  const endpointResp = await snsClient.send(
    new CreatePlatformEndpointCommand({
      PlatformApplicationArn: platformArn,
      Token: deviceToken,
      Attributes: { Enabled: 'true' },
    })
  );
  const endpointArn = endpointResp.EndpointArn;

  const message =
    platform === 'ios'
      ? JSON.stringify({
          APNS: JSON.stringify({
            aps: { alert: { title, body }, sound: 'default', badge: 1 },
            data,
          }),
        })
      : JSON.stringify({
          GCM: JSON.stringify({
            notification: { title, body, sound: 'default' },
            data,
          }),
        });

  await snsClient.send(
    new PublishCommand({
      TargetArn: endpointArn,
      Message: message,
      MessageStructure: 'json',
    })
  );

  return true;
}

/**
 * Mark an alerts row as sent. Idempotent — safe to call multiple times.
 *
 * `delivered` reflects whether at least one push was successfully handed off
 * to the transport. When false (no caregiver device token, transport not
 * configured), is_sent stays false and send_error captures the reason so
 * the row can be retried later.
 */
async function markAlertSent(client, alertId, delivered) {
  if (!alertId) {
    return;
  }
  if (delivered) {
    await client.query(
      `UPDATE alerts SET is_sent = true, sent_at = NOW(), send_error = NULL WHERE id = $1`,
      [alertId]
    );
  } else {
    await client.query(
      `UPDATE alerts SET send_error = $2 WHERE id = $1`,
      [alertId, 'no_transport_or_no_device_token']
    );
  }
}


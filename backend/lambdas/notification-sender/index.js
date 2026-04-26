/**
 * Notification Sender Lambda
 *
 * Sends push notifications for threshold breaches, missed measurements,
 * and daily reminders.
 *
 * Triggered by:
 * - SQS Alert Queue (threshold_breach, missed_measurement, reminder messages)
 * - CloudWatch scheduled event (legacy reminder lapse check)
 * - Direct invocation for threshold check (legacy)
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

// Alert types (legacy P0-P1)
const ALERT_TYPES = {
  THRESHOLD_BREACH: 'THRESHOLD_BREACH',
  REMINDER_LAPSE: 'REMINDER_LAPSE',
};

// P2 alert types (from SQS messages)
const P2_ALERT_TYPES = {
  THRESHOLD_BREACH: 'threshold_breach',
  MISSED_MEASUREMENT: 'missed_measurement',
  REMINDER: 'reminder',
};

// Vital type display names
const VITAL_DISPLAY_NAMES = {
  BLOOD_PRESSURE: 'Blood Pressure',
  GLUCOSE: 'Glucose',
  TEMPERATURE: 'Temperature',
  WEIGHT: 'Weight',
  PULSE: 'Pulse',
  SPO2: 'SpO2',
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
    // Handle different trigger types
    if (event.source === 'aws.events') {
      // CloudWatch scheduled event - check for reminder lapses (legacy)
      await checkReminderLapses(client);
    } else if (event.Records) {
      // SQS trigger - process notification requests
      for (const record of event.Records) {
        const message = JSON.parse(record.body);
        await processNotificationMessage(client, message);
      }
    } else if (event.type === 'THRESHOLD_CHECK') {
      // Direct invocation for threshold check (legacy)
      await checkThresholdBreach(client, event);
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
 * Process a notification message from SQS.
 * Supports both legacy format (alertType) and P2 format (type).
 */
async function processNotificationMessage(client, message) {
  // Detect P2 format (uses 'type' field) vs legacy (uses 'alertType')
  const messageType = message.type || message.alertType;

  switch (messageType) {
    case P2_ALERT_TYPES.THRESHOLD_BREACH:
      await handleThresholdBreachNotification(client, message);
      break;
    case P2_ALERT_TYPES.MISSED_MEASUREMENT:
      await handleMissedMeasurementNotification(client, message);
      break;
    case P2_ALERT_TYPES.REMINDER:
      await handleReminderNotification(client, message);
      break;
    // Legacy types
    case ALERT_TYPES.THRESHOLD_BREACH:
      await sendThresholdBreachNotification(client, message.patientId, message.vitalType, message.value, message.unit);
      break;
    case ALERT_TYPES.REMINDER_LAPSE:
      await sendReminderLapseNotification(client, message.patientId, message.vitalType);
      break;
    default:
      console.warn('Unknown message type:', messageType);
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

  for (const endpoint of endpoints) {
    try {
      await sendPushNotification(endpoint.endpoint_arn, endpoint.platform, title, body, {
        alert_type: P2_ALERT_TYPES.THRESHOLD_BREACH,
        patient_id: patientId,
        parameter,
        value: String(value),
        threshold: String(threshold),
      });

      console.log(`Sent threshold breach notification to caregiver ${endpoint.user_name || endpoint.user_id}`);
    } catch (error) {
      console.error(`Failed to send threshold breach notification:`, error);
    }
  }
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

  for (const endpoint of endpoints) {
    try {
      await sendPushNotification(endpoint.endpoint_arn, endpoint.platform, title, body, {
        alert_type: P2_ALERT_TYPES.MISSED_MEASUREMENT,
        patient_id: patientId,
        parameter,
        days_overdue: String(daysOverdue),
        configured_frequency_days: String(frequencyDays),
      });

      console.log(`Sent missed measurement notification for ${parameter} to caregiver`);
    } catch (error) {
      console.error(`Failed to send missed measurement notification:`, error);
    }
  }
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

  for (const endpoint of patientEndpoints) {
    try {
      await sendPushNotification(endpoint.endpoint_arn, endpoint.platform, title, body, {
        alert_type: P2_ALERT_TYPES.REMINDER,
        patient_id: patientId,
        action: action || 'open_conversation',
      });

      console.log(`Sent reminder notification to patient ${patientId}`);
    } catch (error) {
      console.error(`Failed to send reminder notification:`, error);
    }
  }
}

/**
 * Get caregiver device endpoints for a patient.
 */
async function getCaregiverDeviceEndpoints(client, patientId, caregiverId) {
  let query;
  let params;

  if (caregiverId) {
    // Direct lookup by caregiver ID
    query = `
      SELECT dt.endpoint_arn, dt.platform, u.name as user_name, u.id as user_id
      FROM device_tokens dt
      JOIN users u ON dt.user_id = u.cognito_sub
      WHERE u.id = $1`;
    params = [caregiverId];
  } else {
    // Find all caregivers linked to the patient
    query = `
      SELECT dt.endpoint_arn, dt.platform, u.name as user_name, pl.linked_user_id as user_id
      FROM persona_links pl
      JOIN users u ON pl.linked_user_id = u.id
      JOIN device_tokens dt ON dt.user_id = u.cognito_sub
      WHERE pl.patient_id = $1 AND pl.is_active = true AND pl.relationship = 'caregiver'`;
    params = [patientId];
  }

  const result = await client.query(query, params);
  return result.rows;
}

/**
 * Get patient device endpoints.
 */
async function getPatientDeviceEndpoints(client, patientId) {
  const result = await client.query(
    `SELECT dt.endpoint_arn, dt.platform, u.cognito_sub
     FROM patients p
     JOIN users u ON p.user_id = u.id
     JOIN device_tokens dt ON dt.user_id = u.cognito_sub
     WHERE p.id = $1`,
    [patientId]
  );
  return result.rows;
}

/**
 * Check if an observation breaches thresholds (legacy).
 */
async function checkThresholdBreach(client, event) {
  const { patientId, vitalType, value, unit } = event;

  // Get threshold for this vital
  const thresholdResult = await client.query(
    `SELECT min_value, max_value FROM thresholds WHERE patient_id = $1 AND vital_type = $2`,
    [patientId, vitalType]
  );

  if (thresholdResult.rows.length === 0) {
    console.log('No threshold configured for', vitalType);
    return;
  }

  const { min_value: minValue, max_value: maxValue } = thresholdResult.rows[0];

  // Check if value is outside threshold
  const isBreach = (minValue !== null && value < minValue) || (maxValue !== null && value > maxValue);

  if (isBreach) {
    console.log(`Threshold breach detected for patient ${patientId}: ${vitalType} = ${value}`);
    await sendThresholdBreachNotification(client, patientId, vitalType, value, unit);
  }
}

/**
 * Send threshold breach notification to relatives (legacy).
 */
async function sendThresholdBreachNotification(client, patientId, vitalType, value, unit) {
  // Get patient name
  const patientResult = await client.query(
    `SELECT name FROM users WHERE id = $1`,
    [patientId]
  );
  const patientName = patientResult.rows[0]?.name || 'Patient';

  // Get relatives' device endpoints
  const relativesResult = await client.query(
    `SELECT dt.endpoint_arn, dt.platform, u.name as relative_name, pl.user_id
     FROM persona_links pl
     JOIN device_tokens dt ON dt.user_id = pl.user_id
     JOIN users u ON u.cognito_sub = pl.user_id
     WHERE pl.patient_id = $1 AND pl.status = 'active' AND pl.role = 'relative'`,
    [patientId]
  );

  const vitalDisplayName = VITAL_DISPLAY_NAMES[vitalType] || vitalType;
  const title = `${vitalDisplayName} Alert`;
  const body = `${patientName}'s ${vitalDisplayName.toLowerCase()} reading of ${value} ${unit || ''} is outside the normal range.`;

  // Send notification to each relative
  for (const relative of relativesResult.rows) {
    try {
      await sendPushNotification(relative.endpoint_arn, relative.platform, title, body, {
        type: ALERT_TYPES.THRESHOLD_BREACH,
        patientId,
        vitalType,
        value: value.toString(),
      });

      // Store alert in database
      await storeAlert(client, {
        patientId,
        userId: relative.user_id,
        alertType: ALERT_TYPES.THRESHOLD_BREACH,
        vitalType,
        value,
        message: body,
      });

      console.log(`Sent threshold breach notification to ${relative.relative_name}`);
    } catch (error) {
      console.error(`Failed to send notification to ${relative.relative_name}:`, error);
    }
  }
}

/**
 * Check for reminder lapses across all patients (legacy).
 */
async function checkReminderLapses(client) {
  console.log('Checking for reminder lapses...');

  // Get all active reminder configs with their last observation times
  const result = await client.query(`
    SELECT
      rc.patient_id,
      rc.vital_type,
      rc.window_hours,
      rc.grace_period_minutes,
      (
        SELECT MAX(o.created_at)
        FROM observations o
        WHERE o.patient_id = rc.patient_id AND o.vital_type = rc.vital_type
      ) as last_observation_time
    FROM reminder_configs rc
    WHERE rc.enabled = true
  `);

  const now = new Date();

  for (const config of result.rows) {
    const {
      patient_id: patientId,
      vital_type: vitalType,
      window_hours: windowHours,
      grace_period_minutes: gracePeriodMinutes,
      last_observation_time: lastObservationTime,
    } = config;

    // Calculate if reminder has lapsed
    const windowMs = windowHours * 60 * 60 * 1000;
    const graceMs = gracePeriodMinutes * 60 * 1000;

    let hasLapsed = false;
    let shouldNotifyPatient = false;
    let shouldNotifyRelative = false;

    if (!lastObservationTime) {
      // Never logged - check against patient creation date
      hasLapsed = true;
      shouldNotifyRelative = true;
    } else {
      const lastTime = new Date(lastObservationTime);
      const timeSinceLastLog = now.getTime() - lastTime.getTime();

      if (timeSinceLastLog > windowMs) {
        shouldNotifyPatient = true;
      }

      if (timeSinceLastLog > windowMs + graceMs) {
        hasLapsed = true;
        shouldNotifyRelative = true;
      }
    }

    // Send notifications
    if (shouldNotifyPatient) {
      await sendPatientReminder(client, patientId, vitalType);
    }

    if (shouldNotifyRelative) {
      await sendReminderLapseNotification(client, patientId, vitalType);
    }
  }
}

/**
 * Send reminder to patient (legacy).
 */
async function sendPatientReminder(client, patientId, vitalType) {
  // Check if we already sent a reminder recently (within 1 hour)
  const recentReminder = await client.query(
    `SELECT 1 FROM alerts
     WHERE patient_id = $1 AND vital_type = $2 AND alert_type = 'PATIENT_REMINDER'
     AND created_at > NOW() - INTERVAL '1 hour'`,
    [patientId, vitalType]
  );

  if (recentReminder.rows.length > 0) {
    return; // Already sent reminder recently
  }

  // Get patient's device endpoint
  const patientResult = await client.query(
    `SELECT dt.endpoint_arn, dt.platform, u.cognito_sub
     FROM users u
     JOIN device_tokens dt ON dt.user_id = u.cognito_sub
     WHERE u.id = $1`,
    [patientId]
  );

  if (patientResult.rows.length === 0) {
    return;
  }

  const patient = patientResult.rows[0];
  const vitalDisplayName = VITAL_DISPLAY_NAMES[vitalType] || vitalType;
  const title = 'Reminder';
  const body = `Time to log your ${vitalDisplayName.toLowerCase()} reading.`;

  try {
    await sendPushNotification(patient.endpoint_arn, patient.platform, title, body, {
      type: 'PATIENT_REMINDER',
      vitalType,
    });

    // Store reminder record
    await storeAlert(client, {
      patientId,
      userId: patient.cognito_sub,
      alertType: 'PATIENT_REMINDER',
      vitalType,
      message: body,
    });

    console.log(`Sent reminder to patient for ${vitalType}`);
  } catch (error) {
    console.error('Failed to send patient reminder:', error);
  }
}

/**
 * Send reminder lapse notification to relatives (legacy).
 */
async function sendReminderLapseNotification(client, patientId, vitalType) {
  // Check if we already sent this alert recently (within 4 hours)
  const recentAlert = await client.query(
    `SELECT 1 FROM alerts
     WHERE patient_id = $1 AND vital_type = $2 AND alert_type = $3
     AND created_at > NOW() - INTERVAL '4 hours'`,
    [patientId, vitalType, ALERT_TYPES.REMINDER_LAPSE]
  );

  if (recentAlert.rows.length > 0) {
    return; // Already sent alert recently
  }

  // Get patient name
  const patientResult = await client.query(
    `SELECT name FROM users WHERE id = $1`,
    [patientId]
  );
  const patientName = patientResult.rows[0]?.name || 'Patient';

  // Get relatives' device endpoints
  const relativesResult = await client.query(
    `SELECT dt.endpoint_arn, dt.platform, u.name as relative_name, pl.user_id
     FROM persona_links pl
     JOIN device_tokens dt ON dt.user_id = pl.user_id
     JOIN users u ON u.cognito_sub = pl.user_id
     WHERE pl.patient_id = $1 AND pl.status = 'active' AND pl.role = 'relative'`,
    [patientId]
  );

  const vitalDisplayName = VITAL_DISPLAY_NAMES[vitalType] || vitalType;
  const title = 'Missed Reading';
  const body = `${patientName} hasn't logged their ${vitalDisplayName.toLowerCase()} reading.`;

  // Send notification to each relative
  for (const relative of relativesResult.rows) {
    try {
      await sendPushNotification(relative.endpoint_arn, relative.platform, title, body, {
        type: ALERT_TYPES.REMINDER_LAPSE,
        patientId,
        vitalType,
      });

      // Store alert in database
      await storeAlert(client, {
        patientId,
        userId: relative.user_id,
        alertType: ALERT_TYPES.REMINDER_LAPSE,
        vitalType,
        message: body,
      });

      console.log(`Sent reminder lapse notification to ${relative.relative_name}`);
    } catch (error) {
      console.error(`Failed to send notification to ${relative.relative_name}:`, error);
    }
  }
}

/**
 * Send push notification via SNS.
 */
async function sendPushNotification(endpointArn, platform, title, body, data) {
  let message;

  if (platform === 'ios') {
    message = JSON.stringify({
      APNS: JSON.stringify({
        aps: {
          alert: {
            title,
            body,
          },
          sound: 'default',
          badge: 1,
        },
        data,
      }),
    });
  } else {
    // Android FCM
    message = JSON.stringify({
      GCM: JSON.stringify({
        notification: {
          title,
          body,
          sound: 'default',
        },
        data,
      }),
    });
  }

  await snsClient.send(new PublishCommand({
    TargetArn: endpointArn,
    Message: message,
    MessageStructure: 'json',
  }));
}

/**
 * Store alert in database (legacy).
 */
async function storeAlert(client, alert) {
  await client.query(
    `INSERT INTO alerts (patient_id, user_id, alert_type, vital_type, value, message, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      alert.patientId,
      alert.userId,
      alert.alertType,
      alert.vitalType || null,
      alert.value || null,
      alert.message,
    ]
  );
}

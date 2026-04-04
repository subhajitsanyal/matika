/**
 * Notification Sender Lambda
 *
 * Sends push notifications for threshold breaches and reminder lapses.
 * Triggered by threshold check after observation sync or by scheduled reminder checker.
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

// Alert types
const ALERT_TYPES = {
  THRESHOLD_BREACH: 'THRESHOLD_BREACH',
  REMINDER_LAPSE: 'REMINDER_LAPSE',
};

// Vital type display names
const VITAL_DISPLAY_NAMES = {
  BLOOD_PRESSURE: 'Blood Pressure',
  GLUCOSE: 'Glucose',
  TEMPERATURE: 'Temperature',
  WEIGHT: 'Weight',
  PULSE: 'Pulse',
  SPO2: 'SpO2',
};

exports.handler = async (event) => {
  console.log('Notification sender triggered:', JSON.stringify(event));

  const client = await createDbConnection();

  try {
    // Handle different trigger types
    if (event.source === 'aws.events') {
      // CloudWatch scheduled event - check for reminder lapses
      await checkReminderLapses(client);
    } else if (event.Records) {
      // SQS trigger - process notification requests
      for (const record of event.Records) {
        const message = JSON.parse(record.body);
        await processNotificationRequest(client, message);
      }
    } else if (event.type === 'THRESHOLD_CHECK') {
      // Direct invocation for threshold check
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
 * Process a notification request from SQS.
 */
async function processNotificationRequest(client, message) {
  const { alertType, patientId, vitalType, value, unit } = message;

  switch (alertType) {
    case ALERT_TYPES.THRESHOLD_BREACH:
      await sendThresholdBreachNotification(client, patientId, vitalType, value, unit);
      break;
    case ALERT_TYPES.REMINDER_LAPSE:
      await sendReminderLapseNotification(client, patientId, vitalType);
      break;
    default:
      console.warn('Unknown alert type:', alertType);
  }
}

/**
 * Check if an observation breaches thresholds.
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
 * Send threshold breach notification to relatives.
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
 * Check for reminder lapses across all patients.
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
 * Send reminder to patient.
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
 * Send reminder lapse notification to relatives.
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
 * Store alert in database.
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

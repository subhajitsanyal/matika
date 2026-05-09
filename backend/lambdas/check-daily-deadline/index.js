/**
 * CareLog Check Daily Deadline Lambda
 *
 * Checks if patients have missed their daily measurement deadline:
 * - Queries all active parameter_configs with daily_deadline
 * - Groups by patient, finds earliest deadline per patient
 * - Checks if deadline has passed in patient's timezone
 * - If no complete session exists for today, sends reminder via SQS
 * - Prevents duplicate reminders (max once per hour)
 *
 * Triggered by: EventBridge rate(15 minutes)
 *
 * HIPAA Compliance:
 * - All PHI encrypted at rest (KMS) and in transit (TLS)
 */

const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const secretsClient = new SecretsManagerClient({});
const sqsClient = new SQSClient({});
let dbCredentials = null;

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
 * Get the current date string (YYYY-MM-DD) in a given timezone.
 */
function getTodayInTimezone(timezone) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

/**
 * Get the current time (HH:MM) in a given timezone.
 */
function getCurrentTimeInTimezone(timezone) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(now);
}

/**
 * Check if a time string (HH:MM) has passed relative to the current time (HH:MM).
 */
function hasDeadlinePassed(currentTime, deadline) {
  const [currentH, currentM] = currentTime.split(':').map(Number);
  const [deadlineH, deadlineM] = deadline.split(':').map(Number);
  const currentMinutes = currentH * 60 + currentM;
  const deadlineMinutes = deadlineH * 60 + deadlineM;
  return currentMinutes >= deadlineMinutes;
}

/**
 * Enqueue an SQS message for the notification-sender.
 */
async function enqueueNotification(messageBody) {
  const command = new SendMessageCommand({
    QueueUrl: process.env.SQS_ALERT_QUEUE_URL,
    MessageBody: JSON.stringify(messageBody),
  });
  await sqsClient.send(command);
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log('Check daily deadline triggered:', JSON.stringify(event));

  let dbClient = null;
  let remindersCount = 0;

  try {
    dbClient = await createDbConnection();

    // Query all active parameter_configs with daily_deadline, grouped by patient
    // Get the earliest deadline per patient
    const configResult = await dbClient.query(
      `SELECT
         pc.patient_id,
         MIN(pc.daily_deadline) as earliest_deadline,
         pc.timezone,
         p.user_id,
         u.name as patient_name
       FROM parameter_configs pc
       JOIN patients p ON pc.patient_id = p.id
       JOIN users u ON p.user_id = u.id
       WHERE pc.active = true AND pc.daily_deadline IS NOT NULL
       GROUP BY pc.patient_id, pc.timezone, p.user_id, u.name`
    );

    if (configResult.rows.length === 0) {
      console.log('No active parameter configs with deadlines found');
      return { reminders_sent: 0 };
    }

    for (const row of configResult.rows) {
      const { patient_id: patientId, earliest_deadline, timezone, patient_name: patientName } = row;
      const tz = timezone || 'Asia/Kolkata';

      try {
        // Check if deadline has passed in patient's timezone
        const currentTime = getCurrentTimeInTimezone(tz);
        // Format deadline as HH:MM (it comes as HH:MM:SS from DB)
        const deadlineStr = String(earliest_deadline).substring(0, 5);

        if (!hasDeadlinePassed(currentTime, deadlineStr)) {
          continue; // Deadline hasn't passed yet
        }

        // Check if a complete interaction_session exists for today in patient's timezone
        const todayStr = getTodayInTimezone(tz);
        const sessionResult = await dbClient.query(
          `SELECT 1 FROM interaction_sessions
           WHERE patient_id = $1
             AND status = 'complete'
             AND DATE(started_at AT TIME ZONE $2) = $3::date`,
          [patientId, tz, todayStr]
        );

        if (sessionResult.rows.length > 0) {
          continue; // Patient already completed a session today
        }

        // Check if a reminder was already sent in the last hour
        const recentReminderResult = await dbClient.query(
          `SELECT 1 FROM alerts
           WHERE patient_id = $1
             AND alert_type = 'patient_reminder'
             AND created_at > NOW() - INTERVAL '1 hour'`,
          [patientId]
        );

        if (recentReminderResult.rows.length > 0) {
          continue; // Already sent reminder recently
        }

        // Create alert record for the reminder
        await dbClient.query(
          `INSERT INTO alerts (patient_id, recipient_user_id, alert_type, message, created_at)
           VALUES ($1, $2, 'patient_reminder', $3, NOW())`,
          [patientId, row.user_id, 'Health Check Reminder: It\'s time to log your health readings.']
        );

        // Enqueue SQS message for notification-sender
        const sqsMessage = {
          type: 'reminder',
          alert_type: 'reminder',
          patient_id: patientId,
          patient_name: patientName,
          title: 'Health Check Reminder',
          body: 'It\'s time to log your health readings. Tap to start.',
          action: 'open_conversation',
        };

        await enqueueNotification(sqsMessage);
        remindersCount++;

        console.log(`Sent daily deadline reminder for patient ${patientId}`);
      } catch (patientErr) {
        console.error(`Error processing patient ${patientId}:`, patientErr);
      }
    }

    console.log(`Check daily deadline complete: ${remindersCount} reminders sent`);
    return { reminders_sent: remindersCount };
  } catch (error) {
    console.error('Error checking daily deadlines:', error);
    throw error;
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

// Export internals for testing
exports._getTodayInTimezone = getTodayInTimezone;
exports._getCurrentTimeInTimezone = getCurrentTimeInTimezone;
exports._hasDeadlinePassed = hasDeadlinePassed;

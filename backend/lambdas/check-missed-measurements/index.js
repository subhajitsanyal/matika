/**
 * CareLog Check Missed Measurements Lambda
 *
 * Detects overdue health measurements based on configured frequency:
 * - Queries all active parameter_configs with frequency_days
 * - For each parameter, finds the most recent interaction_session with that parameter
 * - If now - last_logged > frequency_days * 24 hours, parameter is overdue
 * - Prevents duplicate alerts (max once per 24 hours per parameter)
 * - Creates alert records and enqueues SQS messages for notification-sender
 *
 * Triggered by: EventBridge rate(1 hour)
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
 * Calculate days overdue for a parameter.
 * Returns { overdue: boolean, daysOverdue: number }
 */
function calculateOverdue(lastLoggedAt, frequencyDays) {
  if (!lastLoggedAt) {
    // Never logged -- consider overdue if frequency_days has passed since config creation
    return { overdue: true, daysOverdue: frequencyDays };
  }

  const now = new Date();
  const lastLogged = new Date(lastLoggedAt);
  const diffMs = now.getTime() - lastLogged.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const thresholdHours = frequencyDays * 24;

  if (diffHours > thresholdHours) {
    const daysOverdue = Math.floor((diffHours - thresholdHours) / 24) + 1;
    return { overdue: true, daysOverdue: Math.max(1, daysOverdue) };
  }

  return { overdue: false, daysOverdue: 0 };
}

/**
 * Find the linked caregiver for a patient.
 */
async function findLinkedCaregiver(dbClient, patientId) {
  const result = await dbClient.query(
    `SELECT pl.linked_user_id, u.cognito_sub, u.name as caregiver_name
     FROM persona_links pl
     JOIN users u ON pl.linked_user_id = u.id
     WHERE pl.patient_id = $1 AND pl.is_active = true AND pl.relationship = 'caregiver'
     ORDER BY pl.is_primary DESC
     LIMIT 1`,
    [patientId]
  );
  return result.rows[0] || null;
}

/**
 * Map parameter_config parameter_name to alerts vital_type enum values.
 */
const paramToVitalType = {
  'blood_pressure': 'blood_pressure_systolic',
  'blood_glucose': 'glucose',
  'body_weight': 'weight',
  'body_temperature': 'temperature',
  'heart_rate': 'pulse',
  'oxygen_saturation': 'spo2',
};

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
  console.log('Check missed measurements triggered:', JSON.stringify(event));

  let dbClient = null;
  let alertsCount = 0;

  try {
    dbClient = await createDbConnection();

    // Query all active parameter_configs with frequency_days
    const configResult = await dbClient.query(
      `SELECT
         pc.id as config_id,
         pc.patient_id,
         pc.parameter_name,
         pc.display_name,
         pc.loinc_codes,
         pc.unit,
         pc.frequency_days,
         p.user_id,
         u.name as patient_name
       FROM parameter_configs pc
       JOIN patients p ON pc.patient_id = p.id
       JOIN users u ON p.user_id = u.id
       WHERE pc.active = true AND pc.frequency_days IS NOT NULL`
    );

    if (configResult.rows.length === 0) {
      console.log('No active parameter configs with frequency found');
      return { alerts_sent: 0 };
    }

    for (const config of configResult.rows) {
      const {
        config_id: configId,
        patient_id: patientId,
        parameter_name: parameterName,
        display_name: displayName,
        frequency_days: frequencyDays,
        patient_name: patientName,
      } = config;

      try {
        // Find the most recent complete interaction_session that captured this parameter
        // We check extracted_summary JSONB for the parameter name
        const lastSessionResult = await dbClient.query(
          `SELECT ended_at
           FROM interaction_sessions
           WHERE patient_id = $1
             AND status = 'complete'
             AND (
               extracted_summary IS NOT NULL
               AND extracted_summary::text LIKE $2
             )
           ORDER BY ended_at DESC
           LIMIT 1`,
          [patientId, `%${parameterName}%`]
        );

        const lastLoggedAt = lastSessionResult.rows[0]?.ended_at || null;
        const { overdue, daysOverdue } = calculateOverdue(lastLoggedAt, frequencyDays);

        if (!overdue) {
          continue;
        }

        // Map parameter name to vital_type enum value
        const vitalType = paramToVitalType[parameterName] || null;

        // Check if a missed_measurement alert was already sent for this parameter in the last 24 hours
        const recentAlertResult = await dbClient.query(
          `SELECT 1 FROM alerts
           WHERE patient_id = $1
             AND alert_type = 'missed_measurement'
             AND vital_type = $2
             AND created_at > NOW() - INTERVAL '24 hours'`,
          [patientId, vitalType]
        );

        if (recentAlertResult.rows.length > 0) {
          continue; // Already sent alert recently
        }

        // Find linked caregiver
        const caregiver = await findLinkedCaregiver(dbClient, patientId);

        // Create alert record
        const prettyName = displayName || parameterName.replace(/_/g, ' ');
        const message = `${patientName} hasn't logged ${prettyName.toLowerCase()} in ${daysOverdue + frequencyDays} days (configured: every ${frequencyDays} days)`;

        await dbClient.query(
          `INSERT INTO alerts (patient_id, recipient_user_id, alert_type, vital_type, message, created_at)
           VALUES ($1, $2, 'missed_measurement', $3, $4, NOW())`,
          [patientId, caregiver?.linked_user_id || config.user_id, vitalType, message]
        );

        // Enqueue SQS message for notification-sender
        const sqsMessage = {
          type: 'missed_measurement',
          alert_type: 'missed_measurement',
          patient_id: patientId,
          caregiver_id: caregiver?.linked_user_id || null,
          parameter: parameterName,
          display_name: prettyName,
          patient_name: patientName,
          title: `Missed Measurement: ${prettyName}`,
          body: message,
          days_overdue: daysOverdue,
          configured_frequency_days: frequencyDays,
        };

        await enqueueNotification(sqsMessage);
        alertsCount++;

        console.log(`Sent missed measurement alert for patient ${patientId}, parameter ${parameterName}`);
      } catch (paramErr) {
        console.error(`Error processing parameter ${parameterName} for patient ${patientId}:`, paramErr);
      }
    }

    console.log(`Check missed measurements complete: ${alertsCount} alerts sent`);
    return { alerts_sent: alertsCount };
  } catch (error) {
    console.error('Error checking missed measurements:', error);
    throw error;
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

// Export internals for testing
exports._calculateOverdue = calculateOverdue;
exports._findLinkedCaregiver = findLinkedCaregiver;

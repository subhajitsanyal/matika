/**
 * CareLog Evaluate Thresholds Batch Lambda
 *
 * Evaluates patient observation values against configured thresholds:
 * - Fetches active parameter_configs for the patient from RDS
 * - Compares each value against threshold_min / threshold_max arrays
 * - Creates alert records for breaching values
 * - Enqueues SQS messages for notification-sender
 *
 * Triggered by: Async Lambda invoke from construct-fhir-batch
 *
 * HIPAA Compliance:
 * - All PHI encrypted at rest (KMS) and in transit (TLS)
 * - Audit logging for threshold breach detection
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
 * Evaluate a single value against threshold arrays.
 * threshold_min and threshold_max are arrays to support multi-component values (e.g., BP systolic/diastolic).
 * For single-component parameters, arrays will have one element.
 *
 * Returns { breached: boolean, direction: 'low'|'high'|null, thresholdValue: number|null }
 */
function evaluateThreshold(value, thresholdMin, thresholdMax) {
  // Check against threshold_min array (any element that applies)
  if (thresholdMin && Array.isArray(thresholdMin)) {
    for (const min of thresholdMin) {
      if (min !== null && min !== undefined && value < min) {
        return { breached: true, direction: 'low', thresholdValue: min };
      }
    }
  }

  // Check against threshold_max array
  if (thresholdMax && Array.isArray(thresholdMax)) {
    for (const max of thresholdMax) {
      if (max !== null && max !== undefined && value > max) {
        return { breached: true, direction: 'high', thresholdValue: max };
      }
    }
  }

  return { breached: false, direction: null, thresholdValue: null };
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
 * Create an alert record in the alerts table.
 */
async function createAlertRecord(dbClient, { patientId, alertType, vitalType, value, message }) {
  const result = await dbClient.query(
    `INSERT INTO alerts (patient_id, alert_type, vital_type, value, message, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id`,
    [patientId, alertType, vitalType, value, message]
  );
  return result.rows[0].id;
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
  console.log('Evaluate thresholds batch request received:', JSON.stringify(event));

  const { patient_id: patientId, session_id: sessionId, values } = event;

  if (!patientId || !values || !Array.isArray(values) || values.length === 0) {
    console.error('Invalid payload: missing patient_id or values');
    return { breaches: [], error: 'Invalid payload' };
  }

  let dbClient = null;
  const breaches = [];

  try {
    dbClient = await createDbConnection();

    // Fetch active parameter_configs for this patient
    const configResult = await dbClient.query(
      `SELECT id, parameter_name, loinc_codes, unit, threshold_min, threshold_max
       FROM parameter_configs
       WHERE patient_id = $1 AND active = true`,
      [patientId]
    );

    if (configResult.rows.length === 0) {
      console.log(`No active parameter_configs for patient ${patientId}`);
      return { breaches: [], breaches_found: 0, message: 'No thresholds configured' };
    }

    // Find linked caregiver
    const caregiver = await findLinkedCaregiver(dbClient, patientId);

    // Get patient name for notification messages
    const patientResult = await dbClient.query(
      `SELECT u.name FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = $1`,
      [patientId]
    );
    const patientName = patientResult.rows[0]?.name || 'Patient';

    // Evaluate each value against matching parameter configs
    for (const val of values) {
      if (val.value === undefined || val.value === null) continue;

      // Find matching config by loinc_code or parameter name
      const matchingConfig = configResult.rows.find((config) => {
        if (val.loinc_code && config.loinc_codes && Array.isArray(config.loinc_codes)) {
          return config.loinc_codes.includes(val.loinc_code);
        }
        if (val.parameter && config.parameter_name) {
          return config.parameter_name === val.parameter;
        }
        return false;
      });

      if (!matchingConfig) {
        console.log(`No matching config for parameter: ${val.parameter || val.loinc_code}`);
        continue;
      }

      // Evaluate threshold
      const result = evaluateThreshold(
        val.value,
        matchingConfig.threshold_min,
        matchingConfig.threshold_max
      );

      if (result.breached) {
        const direction = result.direction === 'high' ? 'above' : 'below';
        const displayName = matchingConfig.parameter_name.replace(/_/g, ' ');
        const message = `${patientName}'s ${displayName} is ${val.value} ${matchingConfig.unit || ''} -- ${direction} ${result.thresholdValue} threshold`;

        // Create alert record
        const alertId = await createAlertRecord(dbClient, {
          patientId,
          alertType: 'THRESHOLD_BREACH',
          vitalType: matchingConfig.parameter_name,
          value: val.value,
          message,
        });

        const breachInfo = {
          alert_id: alertId,
          parameter: matchingConfig.parameter_name,
          value: val.value,
          unit: matchingConfig.unit,
          direction: result.direction,
          threshold_value: result.thresholdValue,
          loinc_code: val.loinc_code,
        };
        breaches.push(breachInfo);

        // Enqueue SQS message for notification-sender
        const sqsMessage = {
          type: 'threshold_breach',
          patient_id: patientId,
          caregiver_id: caregiver?.linked_user_id || null,
          parameter: matchingConfig.parameter_name,
          display_name: displayName,
          value: val.value,
          unit: matchingConfig.unit || '',
          threshold_max: result.direction === 'high' ? result.thresholdValue : null,
          threshold_min: result.direction === 'low' ? result.thresholdValue : null,
          patient_name: patientName,
          alert_id: alertId,
          recorded_at: new Date().toISOString(),
        };

        try {
          await enqueueNotification(sqsMessage);
          console.log(`Enqueued threshold breach notification for ${matchingConfig.parameter_name}`);
        } catch (sqsErr) {
          console.error('Failed to enqueue SQS notification:', sqsErr);
        }
      }
    }

    // Audit log
    if (breaches.length > 0) {
      try {
        await dbClient.query(
          `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
           VALUES (
             (SELECT user_id FROM patients WHERE id = $1),
             'THRESHOLD_BREACH',
             'alert',
             $2,
             $3
           )`,
          [
            patientId,
            sessionId || breaches[0].alert_id,
            JSON.stringify({
              patient_id: patientId,
              session_id: sessionId,
              breach_count: breaches.length,
              breaches: breaches.map((b) => ({
                parameter: b.parameter,
                value: b.value,
                direction: b.direction,
              })),
            }),
          ]
        );
      } catch (auditErr) {
        console.error('Audit log error:', auditErr);
      }
    }

    console.log(`Evaluation complete: ${breaches.length} breaches found out of ${values.length} values`);

    return {
      patient_id: patientId,
      session_id: sessionId,
      values_evaluated: values.length,
      breaches_found: breaches.length,
      breaches,
    };
  } catch (error) {
    console.error('Error evaluating thresholds:', error);
    throw error;
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

// Export internals for testing
exports._evaluateThreshold = evaluateThreshold;
exports._findLinkedCaregiver = findLinkedCaregiver;
exports._createAlertRecord = createAlertRecord;

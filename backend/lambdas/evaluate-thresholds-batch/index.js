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
 *
 * Schema notes (V001 migration):
 *   alerts.vital_value      NUMERIC(10,2)            — the measured value
 *   alerts.vital_unit       VARCHAR(20)              — unit string
 *   alerts.threshold_min    NUMERIC(10,2)            — populated when direction='low'
 *   alerts.threshold_max    NUMERIC(10,2)            — populated when direction='high'
 *   alerts.recipient_user_id UUID NOT NULL           — caregiver to notify
 *
 * Caller MUST resolve a recipient (linked caregiver) before invoking this;
 * the schema NOT NULL constraint will reject any insert without one.
 */
async function createAlertRecord(
  dbClient,
  {
    patientId,
    recipientUserId,
    alertType,
    vitalType,
    vitalValue,
    vitalUnit,
    thresholdMin,
    thresholdMax,
    message,
  }
) {
  const result = await dbClient.query(
    `INSERT INTO alerts (
       patient_id, recipient_user_id, alert_type, vital_type,
       vital_value, vital_unit, threshold_min, threshold_max,
       message, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     RETURNING id`,
    [
      patientId,
      recipientUserId,
      alertType,
      vitalType,
      vitalValue,
      vitalUnit,
      thresholdMin,
      thresholdMax,
      message,
    ]
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

    // Find linked caregiver. The alerts schema requires recipient_user_id,
    // so if no caregiver is linked we can't create an alert row OR send a
    // useful SQS message — skip the patient entirely with a warning.
    const caregiver = await findLinkedCaregiver(dbClient, patientId);
    if (!caregiver) {
      console.warn(`No active caregiver linked to patient ${patientId}; skipping breach evaluation (no one to notify).`);
      return {
        breaches: [],
        breaches_found: 0,
        message: 'No caregiver linked; alerts skipped',
      };
    }

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

        // Create alert record. recipient_user_id is the caregiver we just
        // resolved; threshold_min / threshold_max get the breached side only
        // (the unbreached side stays NULL — the caregiver UI cares about
        // the bound that was crossed).
        const alertThresholdMin =
          result.direction === 'low' ? result.thresholdValue : null;
        const alertThresholdMax =
          result.direction === 'high' ? result.thresholdValue : null;
        const alertId = await createAlertRecord(dbClient, {
          patientId,
          recipientUserId: caregiver.linked_user_id,
          alertType: 'threshold_breach',
          vitalType: matchingConfig.parameter_name,
          vitalValue: val.value,
          vitalUnit: matchingConfig.unit || null,
          thresholdMin: alertThresholdMin,
          thresholdMax: alertThresholdMax,
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

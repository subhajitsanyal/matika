/**
 * matika-<env>-ses-suppression-handler Lambda
 *
 * Subscribes to the SNS topic that the SES configuration set's
 * event destination publishes Bounce + Complaint notifications to.
 * Persists each affected recipient address to email_suppression
 * (V014 migration) so future pre-send checks can skip them.
 *
 * Honors the "we will wire bounce handling" commitment in the
 * deferred AWS Support SES production-access ticket. The ticket
 * can cite this lambda's CloudWatch traces + the live SNS topic
 * subscription as evidence that bounces and complaints will not
 * impact account reputation.
 *
 * SNS → Lambda event shape:
 *   {
 *     "Records": [
 *       {
 *         "EventSource": "aws:sns",
 *         "Sns": { "Message": "<JSON-encoded SES event>", "MessageId": "..." }
 *       }
 *     ]
 *   }
 *
 * The SES event itself follows the schema documented at:
 *   https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html
 * For Bounce events the bouncedRecipients[] array carries the affected
 * addresses; for Complaint events the complainedRecipients[] array.
 *
 * Per-record try/catch so one malformed notification doesn't fail the
 * whole batch — failed records are CloudWatch-logged and SNS will
 * retry per its default retry policy.
 */

const { Client } = require("pg");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

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
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  return client;
}

const UPSERT_SQL = `
  INSERT INTO email_suppression (email, reason, details, classified_at, sns_message_id)
  VALUES ($1, $2, $3::jsonb, NOW(), $4)
  ON CONFLICT (email) DO UPDATE SET
    reason          = EXCLUDED.reason,
    details         = EXCLUDED.details,
    classified_at   = NOW(),
    sns_message_id  = EXCLUDED.sns_message_id
`;

// Extract a flat list of { email, eventType, details } from one SES
// event payload. Single SES event can carry multiple recipients.
function extractEntries(sesEvent) {
  const entries = [];
  if (sesEvent.eventType === "Bounce" && sesEvent.bounce) {
    const recipients = sesEvent.bounce.bouncedRecipients || [];
    for (const r of recipients) {
      if (!r.emailAddress) continue;
      entries.push({
        email: r.emailAddress,
        reason: "Bounce",
        details: {
          bounceType: sesEvent.bounce.bounceType,
          bounceSubType: sesEvent.bounce.bounceSubType,
          status: r.status,
          action: r.action,
          diagnosticCode: r.diagnosticCode,
          feedbackId: sesEvent.bounce.feedbackId,
          timestamp: sesEvent.bounce.timestamp,
        },
      });
    }
  } else if (sesEvent.eventType === "Complaint" && sesEvent.complaint) {
    const recipients = sesEvent.complaint.complainedRecipients || [];
    for (const r of recipients) {
      if (!r.emailAddress) continue;
      entries.push({
        email: r.emailAddress,
        reason: "Complaint",
        details: {
          complaintFeedbackType: sesEvent.complaint.complaintFeedbackType,
          userAgent: sesEvent.complaint.userAgent,
          feedbackId: sesEvent.complaint.feedbackId,
          timestamp: sesEvent.complaint.timestamp,
        },
      });
    }
  }
  return entries;
}

exports.handler = async (event) => {
  const records = event.Records || [];
  console.log(`ses-suppression-handler: received ${records.length} SNS records`);

  let upserts = 0;
  let skipped = 0;
  const errors = [];

  const client = await createDbConnection();
  try {
    for (const record of records) {
      try {
        if (record.EventSource !== "aws:sns" || !record.Sns) {
          skipped++;
          continue;
        }
        const sesEvent = JSON.parse(record.Sns.Message);
        const entries = extractEntries(sesEvent);
        if (entries.length === 0) {
          // Unknown eventType — log + skip.
          console.warn("ses_suppression_unknown_event_type", {
            eventType: sesEvent.eventType,
            messageId: record.Sns.MessageId,
          });
          skipped++;
          continue;
        }
        for (const entry of entries) {
          await client.query(UPSERT_SQL, [
            entry.email,
            entry.reason,
            JSON.stringify(entry.details),
            record.Sns.MessageId,
          ]);
          upserts++;
          console.log("ses_suppression_upserted", {
            email: entry.email,
            reason: entry.reason,
            messageId: record.Sns.MessageId,
          });
        }
      } catch (recordErr) {
        // One bad record shouldn't fail the whole batch — log and continue.
        console.error("ses_suppression_record_failed", {
          messageId: record?.Sns?.MessageId,
          error: recordErr.message,
        });
        errors.push(recordErr.message);
      }
    }
  } finally {
    await client.end();
  }

  return {
    processed: records.length,
    upserts,
    skipped,
    errors: errors.length,
  };
};

/**
 * CareLog Delete Patient Lambda
 *
 * Deletes a patient and cascades to remove all associated personas:
 *  1. Validates caregiver (relative) owns this patient
 *  2. Disables/deletes associated attendant and doctor Cognito users
 *  3. Deactivates all persona_links for this patient
 *  4. Soft-deletes invite records
 *  5. Hard-deletes device_tokens for patient + linked attendants/doctors
 *  6. Hard-deletes deletion_requests (defensive; V015 also adds FK CASCADE)
 *  7. Hard-deletes the patient record (FK CASCADE fans out across ~19 tables)
 *  8. Disables patient's Cognito user + soft-deletes patient's users row
 *  9. Clears deleting caregiver's Cognito custom:linked_patient_id
 * 10. Audit logs the cascade (DB truth only — counts of rows touched in txn)
 * 11. COMMIT
 * 12. Post-COMMIT best-effort cleanup (NOT rolled back on failure):
 *      - Clear secondary caregivers'/relatives' Cognito custom:linked_patient_id
 *      - Delete S3 objects under observations/{short_code}/
 *
 * HIPAA / DPDP notes:
 * - Users rows for the patient + linked attendants/doctors are SOFT-deleted
 *   (is_active=false). This preserves audit-trail integrity but means rows
 *   keyed on users.id (consent_records, audit_log entries) survive — by
 *   design, for HIPAA proof-of-consent retention. device_tokens are an
 *   exception: they are operational routing data with no audit value and
 *   are hard-deleted to prevent stale push delivery.
 * - S3 observations and secondary-caregiver Cognito attribute cleanup run
 *   AFTER the transaction commits. They are best-effort: failures are
 *   logged to CloudWatch but do not roll back the cascade. The DB is the
 *   source of truth; orphan S3 objects and stale Cognito attributes are
 *   recoverable by out-of-band sweepers.
 */

const {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
  AdminUpdateUserAttributesCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { Client } = require("pg");

const cognitoClient = new CognitoIdentityProviderClient({});
const s3Client = new S3Client({ region: process.env.AWS_REGION || "ap-south-1" });
const sesClient = new SESClient({});
const secretsClient = new SecretsManagerClient({});

let dbCredentials = null;

async function getDatabaseCredentials() {
  if (dbCredentials) return dbCredentials;
  const command = new GetSecretValueCommand({
    SecretId: process.env.DB_SECRET_NAME,
  });
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

/**
 * Disable a Cognito user (soft-delete — preserves the account but prevents login).
 */
async function disableCognitoUser(email) {
  try {
    await cognitoClient.send(
      new AdminDisableUserCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: email,
      })
    );
  } catch (error) {
    // User may not exist in Cognito (e.g. invite was never accepted)
    console.warn(`Could not disable Cognito user ${email}:`, error.message);
  }
}

/**
 * Send removal notification email.
 */
async function sendRemovalEmail(email, name, patientName, role) {
  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: process.env.FROM_EMAIL || "noreply@carelog.com",
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: {
            Data: `Your CareLog ${role} access has been removed`,
            Charset: "UTF-8",
          },
          Body: {
            Text: {
              Data: `Hello ${name},\n\nYour ${role} access to ${patientName}'s care record on CareLog has been removed by the caregiver.\n\nIf you believe this was done in error, please contact the caregiver directly.\n\nCareLog - Health monitoring made simple`,
              Charset: "UTF-8",
            },
          },
        },
      })
    );
  } catch (error) {
    console.warn(`Failed to send removal email to ${email}:`, error.message);
  }
}

/**
 * Clear custom:linked_patient_id on a Cognito user. Idempotent; best-effort.
 */
async function clearLinkedPatientAttribute(usernameOrSub) {
  try {
    await cognitoClient.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: usernameOrSub,
        UserAttributes: [{ Name: "custom:linked_patient_id", Value: "" }],
      })
    );
    return true;
  } catch (error) {
    console.warn(
      `Could not clear custom:linked_patient_id for ${usernameOrSub}: ${error.message}`
    );
    return false;
  }
}

/**
 * Delete every S3 object under observations/{shortCode}/. Best-effort: catches
 * its own errors and returns the deletion count for logging. Never throws.
 */
async function deletePatientObservations(shortCode) {
  const bucket = process.env.DOCUMENTS_BUCKET;
  if (!bucket) {
    console.warn(
      `DOCUMENTS_BUCKET not set; skipping S3 cascade for ${shortCode}`
    );
    return { deleted: 0, errors: 1 };
  }
  const prefix = `observations/${shortCode}/`;
  let deleted = 0;
  let errors = 0;
  let continuationToken;
  try {
    do {
      const list = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      const contents = list.Contents || [];
      if (contents.length > 0) {
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: contents.map((o) => ({ Key: o.Key })),
              Quiet: true,
            },
          })
        );
        deleted += contents.length;
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);
  } catch (error) {
    errors += 1;
    console.error(
      `S3 cascade failed for ${shortCode} (deleted=${deleted} before failure):`,
      error.message
    );
  }
  return { deleted, errors };
}

exports.handler = async (event) => {
  console.log("Delete patient request received");

  const patientId =
    event.pathParameters?.patientId ||
    JSON.parse(event.body || "{}").patientId;
  const relativeCognitoSub = event.requestContext.authorizer.claims.sub;

  if (!patientId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Patient ID is required" }),
    };
  }

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    // Verify caller is the primary caregiver
    const accessCheck = await dbClient.query(
      `SELECT p.id as patient_db_id, p.patient_id, u.name as patient_name
       FROM patients p
       JOIN persona_links pl ON pl.patient_id = p.id
       JOIN users u ON u.id = p.user_id
       WHERE (p.id::text = $1 OR p.patient_id = $1)
         AND pl.linked_user_id = (SELECT id FROM users WHERE cognito_sub = $2)
         AND pl.relationship = 'caregiver'
         AND pl.is_primary = true
         AND pl.is_active = true`,
      [patientId, relativeCognitoSub]
    );

    if (accessCheck.rows.length === 0) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error:
            "You do not have permission to delete this patient. Only the primary caregiver can do this.",
        }),
      };
    }

    const patientDbId = accessCheck.rows[0].patient_db_id;
    const patientShortCode = accessCheck.rows[0].patient_id;
    const patientName = accessCheck.rows[0].patient_name;

    // Hoisted for post-COMMIT phase
    let secondaryCaregiverSubs = [];
    let removedDeviceTokensCount = 0;
    let removedDeletionRequestsCount = 0;

    await dbClient.query("BEGIN");

    try {
      // 1. Get patient's own Cognito user (before delete)
      const patientUser = await dbClient.query(
        `SELECT u.id as user_id, u.cognito_sub, u.email FROM users u
         JOIN patients p ON p.user_id = u.id
         WHERE p.id = $1`,
        [patientDbId]
      );
      const patientUserId =
        patientUser.rows.length > 0 ? patientUser.rows[0].user_id : null;

      // 2. Find linked attendants/doctors (these get soft-deleted as users)
      const linkedUsers = await dbClient.query(
        `SELECT u.id, u.email, u.name, u.cognito_sub, pl.relationship
         FROM persona_links pl
         JOIN users u ON u.id = pl.linked_user_id
         WHERE pl.patient_id = $1
           AND pl.relationship IN ('attendant', 'doctor')
           AND pl.is_active = true`,
        [patientDbId]
      );

      // 3. Find linked secondary caregivers (these stay live but need their
      //    custom:linked_patient_id cleared in Cognito post-COMMIT). The
      //    persona_type enum in v2 is {patient, attendant, caregiver, doctor}
      //    — the legacy V001 'relative' value was renamed to 'caregiver' as
      //    part of the v1→v2 rename pass. Exclude the deleting caregiver —
      //    handled separately at step 9b.
      const secondaryCaregivers = await dbClient.query(
        `SELECT u.cognito_sub
         FROM persona_links pl
         JOIN users u ON u.id = pl.linked_user_id
         WHERE pl.patient_id = $1
           AND pl.relationship = 'caregiver'
           AND pl.is_active = true
           AND u.cognito_sub IS NOT NULL
           AND u.cognito_sub != $2`,
        [patientDbId, relativeCognitoSub]
      );
      secondaryCaregiverSubs = secondaryCaregivers.rows.map((r) => r.cognito_sub);

      // 4. Disable linked attendant/doctor Cognito + email + soft-delete users
      for (const linkedUser of linkedUsers.rows) {
        await disableCognitoUser(linkedUser.email);
        await sendRemovalEmail(
          linkedUser.email,
          linkedUser.name,
          patientName,
          linkedUser.relationship
        );

        await dbClient.query(
          `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
          [linkedUser.id]
        );
      }

      // 5. Deactivate all persona_links for this patient (FK cascade will
      //    hard-delete them along with the patient row at step 8; the
      //    deactivate keeps the legacy soft-delete behavior intact for any
      //    downstream observer reading rows between this UPDATE and the
      //    cascading DELETE within the same transaction).
      await dbClient.query(
        `UPDATE persona_links SET is_active = false WHERE patient_id = $1`,
        [patientDbId]
      );

      // 6. Cancel all pending invites (also FK-cascade-deleted at step 8,
      //    but the UPDATE preserves audit signal of "cancelled" vs "deleted").
      await dbClient.query(
        `UPDATE attendant_invites SET status = 'cancelled' WHERE patient_id = $1 AND status = 'pending'`,
        [patientDbId]
      );
      await dbClient.query(
        `UPDATE doctor_invites SET status = 'cancelled' WHERE patient_id = $1 AND status = 'pending'`,
        [patientDbId]
      );

      // 7a. Hard-delete device_tokens for the patient's user and for every
      //     attendant/doctor whose users row was just soft-deleted. Operational
      //     routing data with no audit value; FK CASCADE from users would only
      //     fire on hard-delete of users, which we don't do.
      const tokenUserIds = [
        ...(patientUserId ? [patientUserId] : []),
        ...linkedUsers.rows.map((u) => u.id),
      ];
      if (tokenUserIds.length > 0) {
        const tokenDelete = await dbClient.query(
          `DELETE FROM device_tokens WHERE user_id = ANY($1::uuid[])`,
          [tokenUserIds]
        );
        removedDeviceTokensCount = tokenDelete.rowCount || 0;
      }

      // 7b. Defensively delete deletion_requests for this patient. Once V015
      //     is in place this is redundant (FK CASCADE handles it on step 8),
      //     but during the deploy window we may run the new lambda code
      //     before the migration lands. Harmless after V015.
      const drDelete = await dbClient.query(
        `DELETE FROM deletion_requests WHERE patient_id = $1`,
        [patientDbId]
      );
      removedDeletionRequestsCount = drDelete.rowCount || 0;

      // 8. Hard-delete the patient row. FK CASCADE fans out across ~19 tables:
      //    persona_links, thresholds, reminder_configs, alerts,
      //    observation_sync_log, attendant_invites, doctor_invites, care_plans,
      //    documents, data_export_requests, observation_notes,
      //    interaction_sessions, parameter_configs, patient_topics,
      //    recommendations, vision_results, model_call, cost_telemetry,
      //    vital_coverage_daily. POINT OF NO RETURN within the txn.
      await dbClient.query(`DELETE FROM patients WHERE id = $1`, [patientDbId]);

      // 9a. Disable patient's own Cognito user
      if (patientUser.rows.length > 0) {
        await disableCognitoUser(patientUser.rows[0].email);
        await dbClient.query(
          `UPDATE users SET is_active = false, updated_at = NOW()
           WHERE cognito_sub = $1`,
          [patientUser.rows[0].cognito_sub]
        );
      }

      // 9b. Clear deleting caregiver's Cognito custom:linked_patient_id.
      //     Best-effort: a failure here does not block the cascade audit.
      await clearLinkedPatientAttribute(relativeCognitoSub);

      // 10. Audit log — DB-truth counts only. S3 + secondary-Cognito results
      //     are logged to CloudWatch post-COMMIT (see step 12) because they
      //     happen outside the transaction.
      await dbClient.query(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
         VALUES (
           (SELECT id FROM users WHERE cognito_sub = $1),
           'DELETE_CASCADE',
           'patient',
           $2,
           $3
         )`,
        [
          relativeCognitoSub,
          patientShortCode,
          JSON.stringify({
            patientName,
            removedAttendants: linkedUsers.rows
              .filter((u) => u.relationship === "attendant")
              .map((u) => u.email),
            removedDoctors: linkedUsers.rows
              .filter((u) => u.relationship === "doctor")
              .map((u) => u.email),
            removedDeviceTokens: removedDeviceTokensCount,
            removedDeletionRequests: removedDeletionRequestsCount,
            secondaryCaregiverCount: secondaryCaregiverSubs.length,
          }),
        ]
      );

      // 11. COMMIT.
      await dbClient.query("COMMIT");

      console.log(
        `Patient ${patientShortCode} cascade committed: ` +
          `${linkedUsers.rows.length} linked users disabled, ` +
          `${removedDeviceTokensCount} device tokens removed, ` +
          `${removedDeletionRequestsCount} deletion_requests removed, ` +
          `${secondaryCaregiverSubs.length} secondary caregivers to clear post-commit`
      );
    } catch (error) {
      await dbClient.query("ROLLBACK");
      throw error;
    }

    // 12. POST-COMMIT best-effort cleanup. Failures here are logged but do
    //     NOT roll back the cascade (txn is already committed).
    let secondariesCleared = 0;
    for (const sub of secondaryCaregiverSubs) {
      const ok = await clearLinkedPatientAttribute(sub);
      if (ok) secondariesCleared += 1;
    }

    const s3Result = await deletePatientObservations(patientShortCode);

    console.log(
      `Post-commit cleanup for ${patientShortCode}: ` +
        `${secondariesCleared}/${secondaryCaregiverSubs.length} secondary caregivers cleared, ` +
        `${s3Result.deleted} S3 objects deleted (${s3Result.errors} S3 errors)`
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Patient and all associated personas have been removed",
        removedCount: secondaryCaregiverSubs.length + removedDeviceTokensCount,
      }),
    };
  } catch (error) {
    console.error("Error deleting patient:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to delete patient" }),
    };
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

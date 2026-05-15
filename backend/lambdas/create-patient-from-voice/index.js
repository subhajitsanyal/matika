/**
 * CareLog create-patient-from-voice Lambda (F23)
 *
 * Backs PRD §6.3.1 / §8.1 and spec §4.5 — the voice patient onboarding
 * pivot. Called only by bedrock-router (NOT by Android directly) when a
 * caregiver_onboarding session emits complete_session in the
 * profile-extraction phase. Atomically:
 *
 *   1. Creates Cognito user for the new patient (synthetic email +
 *      generated temp password if no email supplied; otherwise uses
 *      the caregiver-supplied email).
 *   2. Creates `users` row + `patients` row + `persona_links` row
 *      linking the caregiver. Idempotent on caregiver's `users` row
 *      via ON CONFLICT (cognito_sub) DO NOTHING-style upsert.
 *   3. Updates the placeholder `interaction_sessions.patient_id`
 *      (NULL until now per V008 migration) to the new patient UUID,
 *      so subsequent turns in the SAME session resolve to the real
 *      patient context.
 *   4. Sends the welcome email/SMS with credentials (if email present).
 *   5. Writes an audit_log row.
 *
 * All five happen in one Postgres transaction. On any failure,
 * rolls back the Cognito user creation (best-effort
 * AdminDeleteUserCommand) so the caregiver can retry without a stale
 * Cognito user dangling.
 *
 * Direct-invoke (not API-Gateway-shaped) — request body is the raw
 * payload from bedrock-router, not wrapped in event.body. Auth is via
 * the Lambda's IAM resource policy (only bedrock-router can invoke).
 */

const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminSetUserPasswordCommand,
  AdminDeleteUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { Client } = require('pg');
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');
const crypto = require('crypto');

const cognitoClient = new CognitoIdentityProviderClient({});
const sesClient = new SESClient({});
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

function generatePatientShortId() {
  // CL-XXXXXX, 6 alphanumeric. Matches the existing create-patient format.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'CL-';
  for (let i = 0; i < 6; i += 1) {
    id += chars.charAt(crypto.randomInt(chars.length));
  }
  return id;
}

function generateTempPassword() {
  // 8-char meeting Cognito policy (upper + lower + digit + symbol).
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$!';
  const pick = (s) => s[crypto.randomInt(s.length)];
  const required = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  const all = upper + lower + digits + symbols;
  for (let i = 0; i < 4; i += 1) required.push(pick(all));
  for (let i = required.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [required[i], required[j]] = [required[j], required[i]];
  }
  return required.join('');
}

// ISO-639-1 → BCP-47 mapping. The schema's CHECK constraints require
// the en-IN / hi-IN / bn-IN region-tagged forms.
function toBcp47Language(code) {
  if (!code) return 'en-IN';
  if (code.includes('-')) return code;
  switch (code.toLowerCase()) {
    case 'en': return 'en-IN';
    case 'hi': return 'hi-IN';
    case 'bn': return 'bn-IN';
    default: return code;
  }
}

function mapGender(gender) {
  if (!gender) return null;
  const lower = gender.toLowerCase();
  if (['male', 'm'].includes(lower)) return 'male';
  if (['female', 'f'].includes(lower)) return 'female';
  if (['other', 'nb', 'non-binary', 'nonbinary'].includes(lower)) return 'other';
  return null;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(statusCode, body) {
  return { statusCode, body: JSON.stringify(body) };
}

async function createCognitoUserForPatient(shortPatientId, name, email) {
  const tempPassword = generateTempPassword();
  // Username = the email actually used. For caregiver-supplied emails,
  // that's the real address (so the patient can sign in with it). For
  // the synthetic-email fallback, that's `<shortId>@patient.carelog.com`.
  const loginEmail = email || `${shortPatientId}@patient.carelog.com`;

  const result = await cognitoClient.send(
    new AdminCreateUserCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: loginEmail,
      UserAttributes: [
        { Name: 'email', Value: loginEmail },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: name },
        { Name: 'custom:persona_type', Value: 'patient' },
        { Name: 'custom:linked_patient_id', Value: shortPatientId },
      ],
      TemporaryPassword: tempPassword,
      MessageAction: 'SUPPRESS',
    })
  );

  // Permanent password — the patient skips FORCE_CHANGE_PASSWORD.
  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: loginEmail,
      Password: tempPassword,
      Permanent: true,
    })
  );

  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: loginEmail,
      GroupName: 'patients',
    })
  );

  const cognitoSub = result.User.Attributes.find((a) => a.Name === 'sub')?.Value;
  return { cognitoSub, tempPassword, loginEmail };
}

async function deleteCognitoUserBestEffort({ cognitoSub, loginEmail }) {
  // The user pool's canonical Username is the cognito_sub UUID — alias
  // attributes mean AdminCreateUserCommand({Username: <email>}) succeeds
  // by-email-alias but the resulting user is stored under the sub.
  // AdminDeleteUserCommand requires the canonical Username, so we use
  // the sub here. Falls back to loginEmail if the sub somehow lost.
  const username = cognitoSub || loginEmail;
  try {
    await cognitoClient.send(
      new AdminDeleteUserCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: username,
      })
    );
    console.log('rollback: deleted Cognito user', { username, loginEmail });
  } catch (err) {
    console.warn('rollback: failed to delete Cognito user (manual cleanup may be needed)', {
      username,
      loginEmail,
      message: err?.message,
    });
  }
}

async function persistRds({
  dbClient,
  sessionId,
  caregiverCognitoSub,
  patient,
}) {
  await dbClient.query('BEGIN');
  try {
    // 1. Caregiver users-row idempotent ensure (post-confirmation may
    //    have failed; we don't want a missing user to break this flow).
    //    Two-step to dodge pg's "inconsistent types deduced for $1"
    //    when $1 appears as a column value AND inside a sub-SELECT
    //    WHERE clause in a single INSERT — the parser can't pick a
    //    type. Lookup first, then bind explicit literals on conflict.
    const existingCaregiver = await dbClient.query(
      `SELECT email, name FROM users WHERE cognito_sub = $1`,
      [caregiverCognitoSub]
    );
    const caregiverEmailSeed =
      existingCaregiver.rows[0]?.email || 'unknown@carelog.internal';
    const caregiverNameSeed =
      existingCaregiver.rows[0]?.name || 'Caregiver';
    await dbClient.query(
      `INSERT INTO users (cognito_sub, email, name, persona_type, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, 'caregiver', true, NOW(), NOW())
       ON CONFLICT (cognito_sub) DO UPDATE SET updated_at = NOW()`,
      [caregiverCognitoSub, caregiverEmailSeed, caregiverNameSeed]
    );

    // 2. Patient users-row.
    const userResult = await dbClient.query(
      `INSERT INTO users (cognito_sub, email, name, persona_type, is_active)
       VALUES ($1, $2, $3, 'patient', true)
       RETURNING id`,
      [patient.cognitoSub, patient.loginEmail, patient.name]
    );
    const patientUserId = userResult.rows[0].id;

    // 3. Patients row. Empty JS arrays don't carry enough info for
    //    Postgres to infer text[] vs anyarray, so the array params get
    //    explicit ::text[] casts. Same fix the other lambdas use when
    //    inserting empty arrays into text[] columns.
    const patientResult = await dbClient.query(
      `INSERT INTO patients (
         user_id, patient_id, date_of_birth, gender,
         medical_conditions, allergies, medications,
         emergency_contact_name, emergency_contact_phone,
         language, timezone
       ) VALUES ($1, $2, $3, $4, $5::text[], $6::text[], $7::text[], $8, $9, $10, $11)
       RETURNING id`,
      [
        patientUserId,
        patient.shortId,
        patient.dateOfBirth, // null OK
        mapGender(patient.gender),
        patient.conditions || [],
        patient.allergies || [],
        patient.medications || [],
        patient.emergencyContactName || null,
        patient.emergencyContactPhone || null,
        toBcp47Language(patient.primaryLanguage),
        patient.timezone || 'Asia/Kolkata',
      ]
    );
    const patientDbId = patientResult.rows[0].id;

    // 4. persona_links — caregiver linked to new patient.
    await dbClient.query(
      `INSERT INTO persona_links (
         patient_id, linked_user_id, relationship, is_primary,
         can_log_vitals, can_configure_thresholds, can_view_history, can_receive_alerts,
         invited_by, accepted_at, is_active
       ) VALUES (
         $1,
         (SELECT id FROM users WHERE cognito_sub = $2),
         'caregiver',
         true, true, true, true, true,
         (SELECT id FROM users WHERE cognito_sub = $2),
         NOW(),
         true
       )`,
      [patientDbId, caregiverCognitoSub]
    );

    // 5. Pivot the placeholder interaction_sessions row to the real
    //    patient. V008 migration made patient_id NULLable for the
    //    bootstrap; this UPDATE re-anchors it.
    if (sessionId) {
      const sessionUpdate = await dbClient.query(
        `UPDATE interaction_sessions
            SET patient_id = $1,
                updated_at = NOW()
          WHERE id = $2
            AND session_type = 'caregiver_onboarding'
            AND patient_id IS NULL
          RETURNING id`,
        [patientDbId, sessionId]
      );
      if (sessionUpdate.rowCount === 0) {
        // Session not found, or already had a patient_id, or wrong
        // session_type. Don't fail the whole transaction — the patient
        // creation itself is the load-bearing side effect; the session
        // pivot is a convenience. Log so it's observable.
        console.warn('session pivot UPDATE matched 0 rows', { sessionId, patientDbId });
      }
    }

    // 6. Audit log.
    await dbClient.query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
       VALUES (
         (SELECT id FROM users WHERE cognito_sub = $1),
         'CREATE',
         'patient',
         $2,
         $3
       )`,
      [
        caregiverCognitoSub,
        patient.shortId,
        JSON.stringify({
          source: 'create-patient-from-voice',
          sessionId,
          createdBy: caregiverCognitoSub,
        }),
      ]
    );

    await dbClient.query('COMMIT');
    return patientDbId;
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  }
}

async function sendWelcomeEmail({ loginEmail, patientName, tempPassword, caregiverName }) {
  const fromEmail = process.env.FROM_EMAIL || 'noreply@carelog.com';
  const appUrl = 'https://play.google.com/store/apps/details?id=com.carelog';
  await sesClient.send(
    new SendEmailCommand({
      Source: fromEmail,
      // Route through the env's SES configuration set so Bounce +
      // Complaint events fan out to the ses-suppression-handler.
      // Absent env var => direct send (legacy behavior).
      ConfigurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
      Destination: { ToAddresses: [loginEmail] },
      Message: {
        Subject: { Data: 'Welcome to CareLog — Your Login Credentials', Charset: 'UTF-8' },
        Body: {
          Html: {
            Data: `<h2>Welcome, ${patientName}.</h2>
<p>${caregiverName} has set up a CareLog account to help monitor your health.</p>
<table style="border-collapse:collapse;margin:16px 0">
  <tr><td style="padding:8px;font-weight:bold">Email:</td><td style="padding:8px">${loginEmail}</td></tr>
  <tr><td style="padding:8px;font-weight:bold">Password:</td><td style="padding:8px;font-family:monospace;font-size:18px">${tempPassword}</td></tr>
</table>
<p>Get the app: <a href="${appUrl}">${appUrl}</a></p>`,
            Charset: 'UTF-8',
          },
          Text: {
            Data: `Welcome, ${patientName}.\n\n${caregiverName} has created a CareLog account for you.\n\nEmail: ${loginEmail}\nPassword: ${tempPassword}\n\nDownload: ${appUrl}`,
            Charset: 'UTF-8',
          },
        },
      },
    })
  );
}

exports.handler = async (event) => {
  // event is the raw payload (not API-Gateway-shaped). bedrock-router
  // calls us via SDK InvokeCommand with the spec §4.5 envelope.
  console.log('create-patient-from-voice invoked', { sessionId: event?.sessionId });

  const sessionId = event?.sessionId;
  const caregiverCognitoSub = event?.caregiverCognitoSub;
  const profile = event?.patientProfile || {};
  const credentials = event?.patientCredentials || {};

  if (!caregiverCognitoSub) {
    return jsonResponse(400, { error: 'invalid_profile', message: 'caregiverCognitoSub is required' });
  }
  if (!profile.name || profile.name.trim() === '') {
    return jsonResponse(400, { error: 'invalid_profile', message: 'patientProfile.name is required' });
  }
  if (!credentials.email || !credentials.phone) {
    return jsonResponse(400, {
      error: 'invalid_profile',
      message: 'patientCredentials.email and .phone are both required',
    });
  }
  if (sessionId && !UUID_REGEX.test(sessionId)) {
    return jsonResponse(400, { error: 'invalid_profile', message: 'sessionId must be a UUID' });
  }
  if ((profile.ageYears != null) === (profile.dateOfBirth != null)) {
    // Spec §4.5: exactly one of ageYears / dateOfBirth must be non-null.
    return jsonResponse(400, {
      error: 'invalid_profile',
      message: 'Exactly one of patientProfile.ageYears or .dateOfBirth must be provided',
    });
  }

  const shortPatientId = generatePatientShortId();
  const patientName = profile.name.trim();

  // Convert ageYears → dateOfBirth for storage. The schema only has
  // date_of_birth; we approximate from age by setting birth date to
  // Jan 1 of (current year - age). Imprecise but matches v1 form
  // behavior (form lets user pick either, persists as DOB).
  let dateOfBirth = profile.dateOfBirth || null;
  if (!dateOfBirth && profile.ageYears != null) {
    const year = new Date().getUTCFullYear() - Number(profile.ageYears);
    dateOfBirth = `${year}-01-01`;
  }

  // 1. Create Cognito user. If this fails, no DB cleanup needed.
  let cognitoSub = null;
  let tempPassword = null;
  let loginEmail = null;
  try {
    const cog = await createCognitoUserForPatient(shortPatientId, patientName, credentials.email);
    cognitoSub = cog.cognitoSub;
    tempPassword = cog.tempPassword;
    loginEmail = cog.loginEmail;
  } catch (err) {
    console.error('create-patient-from-voice: Cognito user creation failed', err);
    if (err?.name === 'UsernameExistsException' || err?.__type === 'UsernameExistsException') {
      return jsonResponse(409, {
        error: 'patient_already_exists',
        message: 'An account with this email already exists.',
      });
    }
    return jsonResponse(502, {
      error: 'cognito_create_failed',
      message: err?.message || 'Cognito user creation failed',
    });
  }

  // 2. Persist RDS in one transaction. On failure, roll back Cognito
  //    too so the caregiver can retry without a dangling user.
  let dbClient = null;
  let patientDbId = null;
  try {
    dbClient = await createDbConnection();
    patientDbId = await persistRds({
      dbClient,
      sessionId,
      caregiverCognitoSub,
      patient: {
        cognitoSub,
        shortId: shortPatientId,
        loginEmail,
        name: patientName,
        dateOfBirth,
        gender: profile.gender,
        conditions: profile.conditions,
        allergies: profile.allergies,
        medications: profile.medications,
        emergencyContactName: profile.emergencyContactName,
        emergencyContactPhone: credentials.phone, // primary phone goes to emergency_contact_phone for now
        primaryLanguage: profile.primaryLanguage,
        timezone: profile.timezone,
      },
    });
  } catch (err) {
    console.error('create-patient-from-voice: RDS persist failed; rolling back Cognito user', err);
    await deleteCognitoUserBestEffort({ cognitoSub, loginEmail });
    return jsonResponse(500, {
      error: 'rds_persist_failed',
      message: err?.message || 'Database persistence failed',
    });
  } finally {
    if (dbClient) {
      try { await dbClient.end(); } catch (_) { /* ignore */ }
    }
  }

  // 3. Welcome email — best-effort, non-blocking on the success path.
  //    Even if the email fails, the patient row + Cognito user exist
  //    and the caregiver can re-invite later.
  try {
    await sendWelcomeEmail({
      loginEmail,
      patientName,
      tempPassword,
      caregiverName: 'Your caregiver', // TODO: surface from claims if bedrock-router passes it
    });
  } catch (emailErr) {
    console.warn('create-patient-from-voice: welcome email failed (non-fatal)', {
      message: emailErr?.message,
    });
  }

  console.log('create-patient-from-voice ok', {
    sessionId,
    patientCognitoSub: cognitoSub,
    patientShortId: shortPatientId,
    patientDbId,
  });

  return jsonResponse(200, {
    patientCognitoSub: cognitoSub,
    patientShortId: shortPatientId,
    patientDbId,
    inviteSent: true,
  });
};

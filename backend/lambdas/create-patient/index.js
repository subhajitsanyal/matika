/**
 * CareLog Create Patient Lambda
 *
 * Creates a new patient account:
 * 1. Creates Cognito user for patient
 * 2. Creates patient record in RDS
 * 3. Creates persona_link between caregiver and patient
 * 4. Creates FHIR Patient resource in HealthLake
 *
 * HIPAA Compliance:
 * - All PHI encrypted in transit and at rest
 * - Audit logging for patient creation
 */

const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminUpdateUserAttributesCommand,
  AdminSetUserPasswordCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const {
  HealthLakeClient,
  CreateResourceCommand,
} = require("@aws-sdk/client-healthlake");
const { Client } = require("pg");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const crypto = require("crypto");

const cognitoClient = new CognitoIdentityProviderClient({});
const sesClient = new SESClient({});
const healthLakeClient = new HealthLakeClient({});
const secretsClient = new SecretsManagerClient({});

let dbCredentials = null;

/**
 * Generate a unique patient ID.
 * Format: CL-XXXXXX (6 alphanumeric characters)
 */
function generatePatientId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "CL-";
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Parse date of birth from DD/MM/YYYY to YYYY-MM-DD (ISO) for PostgreSQL.
 * Returns null if input is empty or unparseable.
 */
function parseDateOfBirth(dob) {
  if (!dob) return null;
  // Handle DD/MM/YYYY format
  const parts = dob.split("/");
  if (parts.length === 3) {
    const [dd, mm, yyyy] = parts;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  // Already ISO format or other — pass through
  return dob;
}

/**
 * Get database credentials from Secrets Manager.
 */
async function getDatabaseCredentials() {
  if (dbCredentials) return dbCredentials;

  const command = new GetSecretValueCommand({
    SecretId: process.env.DB_SECRET_NAME,
  });
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
    ssl: { rejectUnauthorized: false },  // RDS uses AWS-managed certs; Lambda runtime may not have the CA
  });
  await client.connect();
  return client;
}

/**
 * Create Cognito user for patient.
 */
/**
 * Generate an 8-character password meeting Cognito policy:
 * uppercase + lowercase + digit + symbol.
 */
function generatePassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "@#$!";
  const pick = (s) => s[crypto.randomInt(s.length)];
  // Guarantee one of each required class
  const required = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  // Fill remaining 4 from all classes
  const all = upper + lower + digits + symbols;
  for (let i = 0; i < 4; i++) required.push(pick(all));
  // Shuffle
  for (let i = required.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [required[i], required[j]] = [required[j], required[i]];
  }
  return required.join("");
}

/**
 * Map ISO-639-1 language codes (en, hi, bn) to the BCP-47 region-tagged
 * forms (en-IN, hi-IN, bn-IN) that the v2 schema's
 * `patients_language_check` and `interaction_sessions_language_check`
 * constraints (V005 migration) require. Pass-through for any code
 * already containing a region tag.
 *
 * The v1 create-patient Lambda predates the constraint tightening;
 * without this mapping the INSERT fails with "violates check
 * constraint patients_language_check".
 */
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

async function createCognitoUser(patientId, patientName, patientEmail) {
  const tempPassword = generatePassword();

  // Use provided email or generate a placeholder
  const email = patientEmail || `patient.${patientId}@carelog.internal`;

  const command = new AdminCreateUserCommand({
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    Username: email,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" },
      { Name: "name", Value: patientName },
      { Name: "custom:persona_type", Value: "patient" },
      { Name: "custom:linked_patient_id", Value: patientId },
    ],
    TemporaryPassword: tempPassword,
    MessageAction: "SUPPRESS",
  });

  const result = await cognitoClient.send(command);

  // Set permanent password so patient doesn't face FORCE_CHANGE_PASSWORD challenge
  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: email,
      Password: tempPassword,
      Permanent: true,
    })
  );

  // Add to patients group
  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: email,
      GroupName: "patients",
    })
  );

  const cognitoSub = result.User.Attributes.find((a) => a.Name === "sub")?.Value;
  return { cognitoSub, tempPassword, email };
}

/**
 * Create FHIR Patient resource in HealthLake.
 */
async function createFHIRPatient(patientData) {
  const fhirPatient = {
    resourceType: "Patient",
    identifier: [
      {
        system: "https://carelog.com/patient-id",
        value: patientData.patientId,
      },
    ],
    name: [
      {
        use: "official",
        text: patientData.name,
      },
    ],
    gender: mapGender(patientData.gender),
    birthDate: patientData.dateOfBirth,
  };

  // Add contact if provided
  if (patientData.emergencyContactName || patientData.emergencyContactPhone) {
    fhirPatient.contact = [
      {
        relationship: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/v2-0131",
                code: "C",
                display: "Emergency Contact",
              },
            ],
          },
        ],
        name: { text: patientData.emergencyContactName },
        telecom: patientData.emergencyContactPhone
          ? [{ system: "phone", value: patientData.emergencyContactPhone }]
          : undefined,
      },
    ];
  }

  const command = new CreateResourceCommand({
    datastoreId: process.env.HEALTHLAKE_DATASTORE_ID,
    resourceType: "Patient",
    resourceBody: JSON.stringify(fhirPatient),
  });

  const result = await healthLakeClient.send(command);
  return result.resourceId;
}

/**
 * Map gender string to FHIR gender code.
 */
function mapGender(gender) {
  const mapping = {
    male: "male",
    female: "female",
    other: "other",
    "prefer not to say": "unknown",
  };
  return mapping[gender?.toLowerCase()] || "unknown";
}

/**
 * Create patient records in RDS.
 */
async function createPatientRecords(dbClient, patientData, caregiverCognitoSub, caregiverEmail, caregiverName) {
  // Start transaction
  await dbClient.query("BEGIN");

  try {
    // Ensure caregiver's user record exists (post-confirmation may have failed)
    await dbClient.query(
      `INSERT INTO users (cognito_sub, email, name, persona_type, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, 'caregiver', true, NOW(), NOW())
       ON CONFLICT (cognito_sub) DO UPDATE SET updated_at = NOW()`,
      [caregiverCognitoSub, caregiverEmail, caregiverName]
    );

    // Create user record for patient
    const userResult = await dbClient.query(
      `INSERT INTO users (cognito_sub, email, name, persona_type, is_active)
       VALUES ($1, $2, $3, 'patient', true)
       RETURNING id`,
      [
        patientData.cognitoSub,
        `${patientData.patientId}@patient.carelog.com`, // Placeholder email
        patientData.name,
      ]
    );
    const userId = userResult.rows[0].id;

    // Create patient record
    const patientResult = await dbClient.query(
      `INSERT INTO patients (
        user_id, patient_id, date_of_birth, gender, blood_type,
        medical_conditions, allergies, medications,
        emergency_contact_name, emergency_contact_phone, fhir_patient_id,
        language, timezone
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id`,
      [
        userId,
        patientData.patientId,
        parseDateOfBirth(patientData.dateOfBirth),
        patientData.gender || null,
        patientData.bloodType || null,
        patientData.medicalConditions || [],
        patientData.allergies || [],
        patientData.medications || [],
        patientData.emergencyContactName || null,
        patientData.emergencyContactPhone || null,
        patientData.fhirPatientId,
        toBcp47Language(patientData.language),
        patientData.timezone || 'Asia/Kolkata',
      ]
    );
    const patientDbId = patientResult.rows[0].id;

    // Create persona_link between caregiver and patient
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

    // Create audit log
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
        patientData.patientId,
        JSON.stringify({ createdBy: caregiverCognitoSub }),
      ]
    );

    await dbClient.query("COMMIT");
    return patientDbId;
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  }
}

/**
 * Send welcome email with login credentials to the patient.
 */
async function sendWelcomeEmail(email, patientName, password, caregiverName) {
  const fromEmail = process.env.FROM_EMAIL || "noreply@carelog.com";
  const appDownloadUrl = "https://play.google.com/store/apps/details?id=com.carelog";

  await sesClient.send(
    new SendEmailCommand({
      Source: fromEmail,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: {
          Data: "Welcome to CareLog - Your Login Credentials",
          Charset: "UTF-8",
        },
        Body: {
          Html: {
            Data: `
<h2>Welcome to CareLog, ${patientName}!</h2>
<p>${caregiverName} has created a CareLog account for you to help monitor your health.</p>
<h3>Your Login Credentials</h3>
<table style="border-collapse:collapse;margin:16px 0">
  <tr><td style="padding:8px;font-weight:bold">Email:</td><td style="padding:8px">${email}</td></tr>
  <tr><td style="padding:8px;font-weight:bold">Password:</td><td style="padding:8px;font-family:monospace;font-size:18px">${password}</td></tr>
</table>
<h3>Get Started</h3>
<ol>
  <li>Download the CareLog app: <a href="${appDownloadUrl}">${appDownloadUrl}</a></li>
  <li>Open the app and tap <strong>Sign In</strong></li>
  <li>Enter the email and password above</li>
  <li>You can change your password after logging in</li>
</ol>
<p style="color:#666;font-size:12px">If you did not expect this email, please contact ${caregiverName} directly.</p>
<p style="color:#666;font-size:12px">CareLog - Health monitoring made simple</p>`,
            Charset: "UTF-8",
          },
          Text: {
            Data: `Welcome to CareLog, ${patientName}!\n\n${caregiverName} has created a CareLog account for you.\n\nYour Login Credentials:\nEmail: ${email}\nPassword: ${password}\n\nDownload the app: ${appDownloadUrl}\n\nOpen the app, tap Sign In, and enter your credentials above.\n\nCareLog - Health monitoring made simple`,
            Charset: "UTF-8",
          },
        },
      },
    })
  );
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log("Create patient request received");

  // Parse request
  const body = JSON.parse(event.body);
  const claims = event.requestContext.authorizer.claims;
  const caregiverCognitoSub = claims.sub;
  const caregiverEmail = claims.email || "unknown@carelog.internal";
  const caregiverName = claims.name || claims.email || "Unknown";

  // Validate required fields
  if (!body.name) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Patient name is required" }),
    };
  }

  let dbClient = null;

  try {
    // Generate unique patient ID
    const patientId = generatePatientId();

    // Create Cognito user
    const patientEmail = body.patientEmail || body.patient_email || null;
    const { cognitoSub, tempPassword, email: patientLoginEmail } =
      await createCognitoUser(patientId, body.name, patientEmail);

    // Create FHIR Patient resource
    let fhirPatientId = null;
    try {
      fhirPatientId = await createFHIRPatient({
        patientId,
        name: body.name,
        gender: body.gender,
        dateOfBirth: body.dateOfBirth,
        emergencyContactName: body.emergencyContactName,
        emergencyContactPhone: body.emergencyContactPhone,
      });
    } catch (fhirError) {
      console.error("FHIR Patient creation failed:", fhirError);
      // Continue - FHIR can be reconciled later
    }

    // Create RDS records
    dbClient = await createDbConnection();
    await createPatientRecords(
      dbClient,
      {
        cognitoSub,
        patientId,
        name: body.name,
        dateOfBirth: body.dateOfBirth,
        gender: body.gender,
        bloodType: body.bloodType,
        medicalConditions: body.medicalConditions || body.conditions || [],
        allergies: body.allergies || [],
        medications: body.medications || [],
        emergencyContactName: body.emergencyContactName || (body.emergency_contact && body.emergency_contact.name) || null,
        emergencyContactPhone: body.emergencyContactPhone || (body.emergency_contact && body.emergency_contact.phone) || null,
        fhirPatientId,
        language: toBcp47Language(body.language),
        timezone: body.timezone || 'Asia/Kolkata',
      },
      caregiverCognitoSub,
      caregiverEmail,
      caregiverName
    );

    // Link patient to the caregiver's Cognito account
    // (server-side is more reliable than depending on the app to do it)
    const caregiverUsername = claims["cognito:username"] || claims.email || claims.sub;
    try {
      await cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: process.env.COGNITO_USER_POOL_ID,
          Username: caregiverUsername,
          UserAttributes: [
            { Name: "custom:linked_patient_id", Value: patientId },
          ],
        })
      );
      console.log(`Linked patient ${patientId} to caregiver ${caregiverUsername}`);
    } catch (linkError) {
      console.error("Failed to link patient to caregiver in Cognito:", linkError);
      // Don't fail the whole request — patient was created, app can retry linking
    }

    // Send welcome email with credentials to patient
    if (patientEmail) {
      try {
        await sendWelcomeEmail(patientLoginEmail, body.name, tempPassword, caregiverName);
        console.log(`Welcome email sent to ${patientLoginEmail}`);
      } catch (emailError) {
        console.warn("Failed to send welcome email:", emailError.message);
        // Don't fail — credentials are also shown in app
      }
    }

    console.log(`Patient created: ${patientId}`);

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId,
        // Phase C (Android v2 caregiver onboarding) needs the patient's
        // Cognito sub to drive /conversation/turn — the v2 backend takes
        // patientId-as-Cognito-sub on the wire and resolves the internal
        // UUID server-side. Pre-Phase-C clients can ignore this field.
        cognito_sub: cognitoSub,
        temporary_password: tempPassword,
        email: patientLoginEmail,
        message: "Patient created successfully",
      }),
    };
  } catch (error) {
    console.error("Error creating patient:", error);
    // F3 — distinguish UsernameExistsException (Cognito email collision)
    // from generic 500. The app's onboarding screen surfaces the body
    // string verbatim via the onboarding_error testTag, so the message
    // here must be user-facing.
    const isUsernameExists =
      error?.name === "UsernameExistsException" ||
      error?.__type === "UsernameExistsException";
    if (isUsernameExists) {
      return {
        statusCode: 409,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "An account with this email already exists. Use a different email or contact support.",
          code: "EMAIL_ALREADY_EXISTS",
        }),
      };
    }
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to create patient" }),
    };
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

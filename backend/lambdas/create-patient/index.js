/**
 * CareLog Create Patient Lambda
 *
 * Creates a new patient account:
 * 1. Creates Cognito user for patient
 * 2. Creates patient record in RDS
 * 3. Creates persona_link between relative and patient
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
} = require("@aws-sdk/client-cognito-identity-provider");
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
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  return client;
}

/**
 * Create Cognito user for patient.
 */
async function createCognitoUser(patientId, patientName) {
  // Generate a temporary password
  const tempPassword = crypto.randomBytes(16).toString("base64") + "Aa1!";

  // Pool requires email as username — generate a placeholder email for the patient
  const patientEmail = `patient.${patientId}@carelog.internal`;

  const command = new AdminCreateUserCommand({
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    Username: patientEmail,
    UserAttributes: [
      { Name: "email", Value: patientEmail },
      { Name: "name", Value: patientName },
      { Name: "custom:persona_type", Value: "patient" },
      { Name: "custom:linked_patient_id", Value: patientId },
    ],
    TemporaryPassword: tempPassword,
    MessageAction: "SUPPRESS", // Don't send welcome email yet
  });

  const result = await cognitoClient.send(command);

  // Add to patients group
  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: patientEmail,
      GroupName: "patients",
    })
  );

  return result.User.Attributes.find((a) => a.Name === "sub")?.Value;
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
async function createPatientRecords(dbClient, patientData, relativeCognitoSub) {
  // Start transaction
  await dbClient.query("BEGIN");

  try {
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
        emergency_contact_name, emergency_contact_phone, fhir_patient_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        userId,
        patientData.patientId,
        patientData.dateOfBirth || null,
        patientData.gender || null,
        patientData.bloodType || null,
        patientData.medicalConditions || [],
        patientData.allergies || [],
        patientData.medications || [],
        patientData.emergencyContactName || null,
        patientData.emergencyContactPhone || null,
        patientData.fhirPatientId,
      ]
    );
    const patientDbId = patientResult.rows[0].id;

    // Create persona_link between relative and patient
    await dbClient.query(
      `INSERT INTO persona_links (
        patient_id, linked_user_id, relationship, is_primary,
        can_log_vitals, can_configure_thresholds, can_view_history, can_receive_alerts,
        invited_by, accepted_at, is_active
      ) VALUES (
        $1,
        (SELECT id FROM users WHERE cognito_sub = $2),
        'relative',
        true, true, true, true, true,
        (SELECT id FROM users WHERE cognito_sub = $2),
        NOW(),
        true
      )`,
      [patientDbId, relativeCognitoSub]
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
        relativeCognitoSub,
        patientData.patientId,
        JSON.stringify({ createdBy: relativeCognitoSub }),
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
 * Lambda handler.
 */
exports.handler = async (event) => {
  console.log("Create patient request received");

  // Parse request
  const body = JSON.parse(event.body);
  const relativeCognitoSub = event.requestContext.authorizer.claims.sub;

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
    const cognitoSub = await createCognitoUser(patientId, body.name);

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
        medicalConditions: body.medicalConditions,
        allergies: body.allergies,
        medications: body.medications,
        emergencyContactName: body.emergencyContactName,
        emergencyContactPhone: body.emergencyContactPhone,
        fhirPatientId,
      },
      relativeCognitoSub
    );

    console.log(`Patient created: ${patientId}`);

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId,
        message: "Patient created successfully",
      }),
    };
  } catch (error) {
    console.error("Error creating patient:", error);
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

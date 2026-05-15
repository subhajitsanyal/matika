/**
 * CareLog Care Team Lambda
 *
 * Returns the care team for a patient:
 * - Caregivers and doctors linked via persona_links
 * - Pending invites from attendant_invites and doctor_invites
 */

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { Client } = require("pg");

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

exports.handler = async (event) => {
  const httpMethod = event.httpMethod || event.requestContext?.http?.method;
  console.log(`Care team ${httpMethod} request received`);

  const cognitoSub = event.requestContext?.authorizer?.claims?.sub;
  if (!cognitoSub) {
    return response(401, { error: "Unauthorized" });
  }

  const patientId = event.pathParameters?.patientId;
  if (!patientId) {
    return response(400, { error: "Patient ID required" });
  }

  let dbClient = null;

  try {
    dbClient = await createDbConnection();

    // Verify caller has access to this patient. Two valid cases:
    //   (a) caller is a caregiver/team-manager on this patient (existing
    //       persona_links row with relationship in caregiver/attendant/relative/doctor
    //       and is_active=true), OR
    //   (b) caller IS the patient themselves (patients.user_id → users.cognito_sub).
    //       PT-V2-22 — patients have read-only access to their own care team;
    //       see Stream D decision 2026-05-12.
    //
    // Accept either the UUID `patients.id` or the short form `patients.patient_id`
    // (e.g. CL-63NRGO). Patient apps know the short form via Cognito's
    // custom:linked_patient_id attribute, not the UUID.
    const accessCheck = await dbClient.query(
      `SELECT p.id AS patient_db_id
       FROM patients p
       LEFT JOIN persona_links pl
         ON pl.patient_id = p.id AND pl.is_active = true
       LEFT JOIN users u_caller
         ON u_caller.id = pl.linked_user_id
       LEFT JOIN users u_patient
         ON u_patient.id = p.user_id
       WHERE (p.id::text = $1 OR p.patient_id = $1)
         AND (u_caller.cognito_sub = $2 OR u_patient.cognito_sub = $2)
       LIMIT 1`,
      [patientId, cognitoSub]
    );

    if (accessCheck.rows.length === 0) {
      return response(403, { error: "Access denied" });
    }

    const patientDbId = accessCheck.rows[0].patient_db_id;

    // Handle DELETE — revoke a pending invite
    if (httpMethod === "DELETE") {
      const body = event.body ? JSON.parse(event.body) : {};
      const inviteId = body.inviteId || event.queryStringParameters?.inviteId;
      if (!inviteId) {
        return response(400, { error: "inviteId required" });
      }

      // Try attendant_invites first, then doctor_invites
      let result = await dbClient.query(
        `UPDATE attendant_invites SET status = 'revoked' WHERE id = $1 AND patient_id = $2 AND status = 'pending' RETURNING id`,
        [inviteId, patientDbId]
      );
      if (result.rows.length === 0) {
        result = await dbClient.query(
          `UPDATE doctor_invites SET status = 'revoked' WHERE id = $1 AND patient_id = $2 AND status = 'pending' RETURNING id`,
          [inviteId, patientDbId]
        );
      }

      return response(200, { message: "Invite revoked", inviteId });
    }

    // Fetch all active team members. is_primary surfaced for PT-V2-22's
    // patient-side read-only view (caregiver list shows a "Primary" badge).
    const teamResult = await dbClient.query(
      `SELECT u.id, u.name, u.email, u.phone_number AS phone,
              pl.relationship AS role, pl.accepted_at AS joined_at,
              pl.is_primary AS is_primary
       FROM persona_links pl
       JOIN users u ON pl.linked_user_id = u.id
       WHERE pl.patient_id = $1 AND pl.is_active = true
       ORDER BY pl.relationship, u.name`,
      [patientDbId]
    );

    // Group by role
    const caregivers = [];
    const doctors = [];

    for (const row of teamResult.rows) {
      const member = {
        id: row.id,
        name: row.name,
        email: row.email || "",
        phone: row.phone || "",
        role: row.role,
        joinedAt: row.joined_at ? row.joined_at.toISOString() : null,
        isPrimary: !!row.is_primary,
      };

      switch (row.role) {
        case "caregiver":
        // Legacy roles map to caregiver
        case "attendant":
        case "relative":
          member.role = "caregiver";
          caregivers.push(member);
          break;
        case "doctor":
          doctors.push(member);
          break;
      }
    }

    // Fetch pending invites
    const pendingCaregivers = await dbClient.query(
      `SELECT id, attendant_email AS email, attendant_name AS name, created_at AS sent_at
       FROM attendant_invites
       WHERE patient_id = $1 AND status = 'pending' AND expires_at > NOW()`,
      [patientDbId]
    );

    const pendingDoctors = await dbClient.query(
      `SELECT id, doctor_email AS email, doctor_name AS name, created_at AS sent_at
       FROM doctor_invites
       WHERE patient_id = $1 AND status = 'pending' AND expires_at > NOW()`,
      [patientDbId]
    );

    const pendingInvites = [
      ...pendingCaregivers.rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: "caregiver",
        sentAt: r.sent_at.toISOString(),
      })),
      ...pendingDoctors.rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: "doctor",
        sentAt: r.sent_at.toISOString(),
      })),
    ];

    return response(200, {
      caregivers,
      doctors,
      pendingInvites,
    });
  } catch (error) {
    console.error("Error fetching care team:", error);
    return response(500, { error: "Internal server error" });
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

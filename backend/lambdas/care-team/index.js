/**
 * CareLog Care Team Lambda
 *
 * Returns the care team for a patient:
 * - Attendants, doctors, relatives linked via persona_links
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

    // Verify caller has access to this patient
    const accessCheck = await dbClient.query(
      `SELECT p.id AS patient_db_id
       FROM patients p
       JOIN persona_links pl ON pl.patient_id = p.id
       JOIN users u ON pl.linked_user_id = u.id
       WHERE p.patient_id = $1 AND u.cognito_sub = $2 AND pl.is_active = true`,
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

    // Fetch all active team members
    const teamResult = await dbClient.query(
      `SELECT u.id, u.name, u.email, u.phone_number AS phone,
              pl.relationship AS role, pl.accepted_at AS joined_at
       FROM persona_links pl
       JOIN users u ON pl.linked_user_id = u.id
       WHERE pl.patient_id = $1 AND pl.is_active = true
       ORDER BY pl.relationship, u.name`,
      [patientDbId]
    );

    // Group by role
    const attendants = [];
    const doctors = [];
    const relatives = [];

    for (const row of teamResult.rows) {
      const member = {
        id: row.id,
        name: row.name,
        email: row.email || "",
        phone: row.phone || "",
        role: row.role,
        joinedAt: row.joined_at ? row.joined_at.toISOString() : null,
      };

      switch (row.role) {
        case "attendant":
          attendants.push(member);
          break;
        case "doctor":
          doctors.push(member);
          break;
        case "relative":
          relatives.push(member);
          break;
      }
    }

    // Fetch pending invites
    const pendingAttendants = await dbClient.query(
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
      ...pendingAttendants.rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: "attendant",
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
      attendants,
      doctors,
      relatives,
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

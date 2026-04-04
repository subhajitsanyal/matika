/**
 * CareLog Patient Summary Lambda
 *
 * Returns patient summary for the relative dashboard:
 * - Patient info (name, ID)
 * - Latest vital observations from S3
 * - Unread alert count
 * - Last activity time
 */

const { Client } = require("pg");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

const secretsClient = new SecretsManagerClient({});
const s3Client = new S3Client({});

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
 * Check that the requesting user has access to this patient.
 */
async function checkAccess(dbClient, cognitoSub, patientId) {
  const result = await dbClient.query(
    `SELECT 1 FROM persona_links pl
     JOIN patients p ON pl.patient_id = p.id
     JOIN users u ON pl.linked_user_id = u.id
     WHERE p.patient_id = $1 AND u.cognito_sub = $2 AND pl.is_active = true`,
    [patientId, cognitoSub]
  );
  return result.rows.length > 0;
}

/**
 * Fetch patient info from RDS.
 */
async function getPatientInfo(dbClient, patientId) {
  const result = await dbClient.query(
    `SELECT p.patient_id, u.name, p.date_of_birth, p.gender, p.blood_type
     FROM patients p
     JOIN users u ON p.user_id = u.id
     WHERE p.patient_id = $1`,
    [patientId]
  );
  return result.rows[0] || null;
}

/**
 * Count unread alerts for this patient addressed to the requesting user.
 */
async function getUnreadAlertCount(dbClient, patientId, cognitoSub) {
  const result = await dbClient.query(
    `SELECT COUNT(*)::int AS count
     FROM alerts a
     JOIN patients p ON a.patient_id = p.id
     JOIN users u ON a.recipient_user_id = u.id
     WHERE p.patient_id = $1 AND u.cognito_sub = $2 AND a.is_read = false`,
    [patientId, cognitoSub]
  );
  return result.rows[0]?.count || 0;
}

/**
 * Get the latest observation for each vital type from S3.
 * Observations are stored at: observations/{patientId}/{YYYY}/{MM}/{DD}/{id}.json
 */
async function getLatestVitals(patientId) {
  const bucket = process.env.OBSERVATIONS_BUCKET;
  if (!bucket) return {};

  const vitals = {};

  try {
    // List recent observation files (last 30 days worth, most recent first)
    const now = new Date();
    const files = [];

    // Check last 7 days for recent vitals
    for (let daysAgo = 0; daysAgo < 7 && files.length < 50; daysAgo++) {
      const d = new Date(now);
      d.setDate(d.getDate() - daysAgo);
      const prefix = `observations/${patientId}/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/`;

      try {
        const listResult = await s3Client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys: 20,
          })
        );
        if (listResult.Contents) {
          files.push(...listResult.Contents);
        }
      } catch (e) {
        // Day folder doesn't exist, continue
      }
    }

    // Sort by last modified descending
    files.sort((a, b) => (b.LastModified || 0) - (a.LastModified || 0));

    // Read observations to find latest per vital type
    const seenTypes = new Set();
    for (const file of files) {
      if (seenTypes.size >= 6) break; // All vital types covered

      try {
        const getResult = await s3Client.send(
          new GetObjectCommand({ Bucket: bucket, Key: file.Key })
        );
        const body = await getResult.Body.transformToString();
        const obs = JSON.parse(body);

        // Parse FHIR Observation
        const vitalType = mapFhirCodeToVitalType(obs);
        if (vitalType && !seenTypes.has(vitalType)) {
          seenTypes.add(vitalType);
          vitals[vitalType] = {
            value: extractValue(obs),
            secondaryValue: extractSecondaryValue(obs, vitalType),
            unit: extractUnit(obs),
            timestamp: obs.effectiveDateTime || obs.issued,
            status: "NORMAL", // Threshold checking would go here
          };
        }
      } catch (e) {
        // Skip unreadable files
      }
    }
  } catch (e) {
    console.error("Error reading observations from S3:", e);
  }

  return vitals;
}

function mapFhirCodeToVitalType(obs) {
  const coding = obs.code?.coding?.[0];
  if (!coding) return null;

  const loincMap = {
    "85354-9": "blood_pressure",
    "2339-0": "glucose",
    "8310-5": "temperature",
    "29463-7": "weight",
    "8867-4": "pulse",
    "2708-6": "spo2",
  };
  return loincMap[coding.code] || null;
}

function extractValue(obs) {
  if (obs.valueQuantity) return obs.valueQuantity.value;
  if (obs.component?.[0]?.valueQuantity) return obs.component[0].valueQuantity.value;
  return 0;
}

function extractSecondaryValue(obs, vitalType) {
  if (vitalType === "blood_pressure" && obs.component?.[1]?.valueQuantity) {
    return obs.component[1].valueQuantity.value;
  }
  return undefined;
}

function extractUnit(obs) {
  if (obs.valueQuantity) return obs.valueQuantity.unit || "";
  if (obs.component?.[0]?.valueQuantity) return obs.component[0].valueQuantity.unit || "";
  return "";
}

/**
 * Get last activity time from observation sync log.
 */
async function getLastActivityTime(dbClient, patientId) {
  const result = await dbClient.query(
    `SELECT MAX(osl.local_timestamp) AS last_activity
     FROM observation_sync_log osl
     JOIN patients p ON osl.patient_id = p.id
     WHERE p.patient_id = $1`,
    [patientId]
  );
  return result.rows[0]?.last_activity || null;
}

exports.handler = async (event) => {
  console.log("Patient summary request received");

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

    // Check access
    const hasAccess = await checkAccess(dbClient, cognitoSub, patientId);
    if (!hasAccess) {
      return response(403, { error: "Access denied" });
    }

    // Fetch data in parallel
    const [patientInfo, unreadAlertCount, latestVitals, lastActivityTime] =
      await Promise.all([
        getPatientInfo(dbClient, patientId),
        getUnreadAlertCount(dbClient, patientId, cognitoSub),
        getLatestVitals(patientId),
        getLastActivityTime(dbClient, patientId),
      ]);

    if (!patientInfo) {
      return response(404, { error: "Patient not found" });
    }

    return response(200, {
      patientId: patientInfo.patient_id,
      patientName: patientInfo.name,
      latestVitals,
      unreadAlertCount,
      lastActivityTime,
    });
  } catch (error) {
    console.error("Error fetching patient summary:", error);
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

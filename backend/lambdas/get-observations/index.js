/**
 * CareLog Get Observations Lambda
 *
 * Returns observations for a patient from S3 for the trends view.
 * Supports filtering by vital type, date range.
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

const LOINC_MAP = {
  "85354-9": "BLOOD_PRESSURE",
  "2339-0": "GLUCOSE",
  "8310-5": "TEMPERATURE",
  "29463-7": "WEIGHT",
  "8867-4": "PULSE",
  "2708-6": "SPO2",
};

function mapFhirToVitalType(obs) {
  const code = obs.code?.coding?.[0]?.code;
  return LOINC_MAP[code] || null;
}

exports.handler = async (event) => {
  const cognitoSub = event.requestContext?.authorizer?.claims?.sub;
  if (!cognitoSub) return resp(401, { error: "Unauthorized" });

  const patientIdParam = event.pathParameters?.patientId;
  if (!patientIdParam) return resp(400, { error: "Patient ID required" });

  const qs = event.queryStringParameters || {};
  const vitalTypeFilter = qs.vitalType?.toUpperCase();
  const startDate = qs.startDate ? new Date(qs.startDate) : null;
  const endDate = qs.endDate ? new Date(qs.endDate) : null;

  let dbClient = null;
  const bucket = process.env.OBSERVATIONS_BUCKET;

  try {
    dbClient = await createDbConnection();

    // Android client sends the short code (`CL-XXXXXX`) from
    // custom:linked_patient_id; the access check needs the UUID. Same
    // pattern as F52/F54. Also keep the short code in hand because
    // sync-observation writes S3 objects at
    // `observations/{short_code}/{YYYY}/...`.
    const resolved = await resolvePatientDbId(dbClient, patientIdParam);
    if (!resolved) return resp(404, { error: "Patient not found" });
    const patientUuid = resolved.id;
    const patientShortCode = resolved.patient_id;

    // Check access against the resolved UUID.
    const access = await dbClient.query(
      `SELECT 1 FROM persona_links pl
       JOIN users u ON pl.linked_user_id = u.id
       WHERE pl.patient_id = $1 AND u.cognito_sub = $2 AND pl.is_active = true
       UNION
       SELECT 1 FROM patients p
       JOIN users u ON p.user_id = u.id
       WHERE p.id = $1 AND u.cognito_sub = $2`,
      [patientUuid, cognitoSub]
    );
    if (access.rows.length === 0) return resp(403, { error: "Access denied" });

    // Determine date range to scan
    const end = endDate || new Date();
    const start = startDate || new Date(end.getTime() - 7 * 86400000);
    const observations = [];

    // sync-observation writes to `observations/{patient_short_code}/...`
    // (see sync-observation/index.js:72). We scan ONE prefix — the
    // patient's short code — not per-Cognito-sub. Caregiver-logged obs
    // also land under the same patient prefix because sync-observation
    // keys on patientId (from the FHIR resource), not the logger sub.
    {
      const d = new Date(end);
      while (d >= start) {
        const prefix = `observations/${patientShortCode}/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/`;

        try {
          const listResult = await s3Client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: prefix,
              MaxKeys: 100,
            })
          );

          if (listResult.Contents) {
            for (const file of listResult.Contents) {
              try {
                const getResult = await s3Client.send(
                  new GetObjectCommand({ Bucket: bucket, Key: file.Key })
                );
                const body = await getResult.Body.transformToString();
                const obs = JSON.parse(body);
                const vitalType = mapFhirToVitalType(obs);

                if (!vitalType) continue;
                if (vitalTypeFilter && vitalType !== vitalTypeFilter) continue;

                const timestamp = obs.effectiveDateTime || obs.issued;
                if (startDate && new Date(timestamp) < startDate) continue;
                if (endDate && new Date(timestamp) > endDate) continue;

                const entry = {
                  id: obs.id || file.Key,
                  vitalType,
                  value: obs.valueQuantity?.value ?? obs.component?.[0]?.valueQuantity?.value ?? 0,
                  secondaryValue: vitalType === "BLOOD_PRESSURE" ? obs.component?.[1]?.valueQuantity?.value : undefined,
                  unit: obs.valueQuantity?.unit ?? obs.component?.[0]?.valueQuantity?.unit ?? "",
                  timestamp,
                  performerName: null,
                  status: "NORMAL",
                };

                observations.push(entry);
              } catch (e) {
                // Skip unreadable files
              }
            }
          }
        } catch (e) {
          // Skip days with no data
        }

        d.setDate(d.getDate() - 1);
      }
    }

    // Sort by timestamp descending
    observations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return resp(200, { observations });
  } catch (error) {
    console.error("Error fetching observations:", error);
    return resp(500, { error: "Internal server error" });
  } finally {
    if (dbClient) await dbClient.end();
  }
};

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

/**
 * Resolve URL-supplied patient id (UUID or short code like `CL-012W6M`)
 * to the internal patients row. Returns { id, patient_id } or null.
 * Same pattern as alert-crud + manage-parameter-configs (F52/F54 class).
 */
async function resolvePatientDbId(client, patientIdParam) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(patientIdParam)) {
    const r = await client.query(
      `SELECT id, patient_id FROM patients WHERE id = $1`,
      [patientIdParam]
    );
    if (r.rows.length > 0) return r.rows[0];
  }
  const r = await client.query(
    `SELECT id, patient_id FROM patients WHERE patient_id = $1`,
    [patientIdParam]
  );
  return r.rows[0] || null;
}

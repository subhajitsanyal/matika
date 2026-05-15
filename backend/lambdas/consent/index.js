/**
 * Consent Lambda
 *
 * Manages DPDP (Digital Personal Data Protection) consent records.
 * Stores versioned consent with cryptographic hashes.
 */

const { Client } = require('pg');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

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

// Current consent version. Bump when getConsentDocument() text changes
// in a legally material way — clients with an older accepted version will
// be re-prompted (getConsentStatus → needsUpdate=true).
const CURRENT_CONSENT_VERSION = '2.0';

exports.handler = async (event) => {
  console.log('Consent request:', event.httpMethod, event.path);

  const client = await createDbConnection();

  try {
    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;

    switch (httpMethod) {
      case 'GET':
        if (!userId) {
          return errorResponse(401, 'Unauthorized');
        }
        // Returns the per-user status AND the current server-side
        // consent text/version/hash in one payload. Saves the client a
        // second round-trip and guarantees the hash the client posts
        // back was authored against the same server-side text.
        return await getConsentStatus(client, userId);
      case 'POST':
        if (!userId) {
          return errorResponse(401, 'Unauthorized');
        }
        return await recordConsent(client, event, userId);
      case 'DELETE':
        if (!userId) {
          return errorResponse(401, 'Unauthorized');
        }
        return await withdrawConsent(client, event, userId);
      default:
        return errorResponse(405, 'Method not allowed');
    }
  } catch (error) {
    console.error('Error:', error);
    return errorResponse(500, 'Internal server error');
  } finally {
    await client.end();
  }
};

/**
 * Get current consent text and version.
 */
async function getConsentText() {
  const consentText = getConsentDocument();

  return successResponse(200, {
    version: CURRENT_CONSENT_VERSION,
    text: consentText,
    hash: hashText(consentText),
    lastUpdated: '2026-03-01',
  });
}

/**
 * Get user's consent status. Resolves cognito_sub → users.id (records
 * are keyed by the internal UUID, not the Cognito sub) before hitting
 * consent_records. Always includes the current server-side text +
 * hash so the client can render the consent screen and submit the
 * matching hash back without a second round-trip.
 */
async function getConsentStatus(client, cognitoSub) {
  const consentText = getConsentDocument();
  const consentHash = hashText(consentText);
  const baseConsent = {
    currentVersion: CURRENT_CONSENT_VERSION,
    consentText,
    consentHash,
  };

  // Resolve cognito sub → internal user UUID. consent_records.user_id is
  // the internal users.id (FK), not the Cognito sub directly. If the
  // user row doesn't exist yet (post_confirmation Lambda hasn't fired or
  // failed silently), treat as not-yet-consented so the client routes
  // through the consent screen on first launch.
  const userRow = await client.query(
    `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
    [cognitoSub]
  );
  if (userRow.rows.length === 0) {
    return successResponse(200, {
      ...baseConsent,
      hasConsent: false,
      needsUpdate: true,
    });
  }
  const userId = userRow.rows[0].id;

  const result = await client.query(
    `SELECT
       id,
       consent_version,
       consent_text_hash,
       accepted_at,
       ip_address
     FROM consent_records
     WHERE user_id = $1 AND withdrawn_at IS NULL
     ORDER BY accepted_at DESC
     LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return successResponse(200, {
      ...baseConsent,
      hasConsent: false,
      needsUpdate: true,
    });
  }

  const record = result.rows[0];
  const needsUpdate = record.consent_version !== CURRENT_CONSENT_VERSION;

  return successResponse(200, {
    ...baseConsent,
    hasConsent: true,
    consentVersion: record.consent_version,
    acceptedAt: record.accepted_at,
    needsUpdate,
  });
}

/**
 * Record user consent acceptance. Resolves cognito_sub → users.id (FK
 * target) before writing to consent_records.
 */
async function recordConsent(client, event, cognitoSub) {
  const body = JSON.parse(event.body || '{}');
  // Client may send {acceptedTerms} explicitly or just {version, textHash}.
  // The fact that POST /consent was called at all is itself the affirmative
  // act on the consent screen, so default acceptedTerms to true when only
  // version+hash are present.
  const { version, textHash } = body;
  const acceptedTerms = body.acceptedTerms !== false;

  if (!version || !textHash) {
    return errorResponse(400, 'Version and text hash required');
  }

  if (!acceptedTerms) {
    return errorResponse(400, 'Must accept terms to proceed');
  }

  // Verify hash matches current consent text
  const currentText = getConsentDocument();
  const currentHash = hashText(currentText);

  if (textHash !== currentHash) {
    return errorResponse(400, 'Consent text has been updated. Please review the latest version.');
  }

  // Resolve internal user UUID. The post-confirmation Lambda is supposed
  // to have created the row; if it hasn't, surface 409 so the client can
  // retry rather than silently writing an orphan FK.
  const userRow = await client.query(
    `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
    [cognitoSub]
  );
  if (userRow.rows.length === 0) {
    return errorResponse(409, 'User record not yet provisioned. Try again in a moment.');
  }
  const userId = userRow.rows[0].id;

  // Get IP address from request
  const ipAddress = event.requestContext?.identity?.sourceIp ||
    event.headers?.['X-Forwarded-For']?.split(',')[0] ||
    'unknown';

  const id = uuidv4();

  await client.query(
    `INSERT INTO consent_records (
       id,
       user_id,
       consent_type,
       consent_version,
       consent_text_hash,
       is_accepted,
       ip_address,
       user_agent,
       accepted_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      id,
      userId,
      'cross_region_inference',
      version,
      textHash,
      true,
      ipAddress,
      event.headers?.['User-Agent'] || 'unknown',
    ]
  );

  // Log audit event. audit_log schema (V001) is action/resource_type/
  // resource_id/user_id/user_persona/details — no actor_role column.
  await client.query(
    `INSERT INTO audit_log (
       action,
       resource_type,
       resource_id,
       user_id,
       details,
       created_at
     ) VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      'CREATE',
      'Consent',
      id,
      userId,
      JSON.stringify({ version, ipAddress }),
    ]
  );

  return successResponse(201, {
    success: true,
    consentId: id,
    version,
    acceptedAt: new Date().toISOString(),
  });
}

/**
 * Withdraw consent (DPDP right to withdraw). Resolves cognito_sub →
 * users.id (FK) before updating consent_records.
 */
async function withdrawConsent(client, event, cognitoSub) {
  const body = JSON.parse(event.body || '{}');
  const { reason } = body;

  const userRow = await client.query(
    `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
    [cognitoSub]
  );
  if (userRow.rows.length === 0) {
    return errorResponse(404, 'User record not found');
  }
  const userId = userRow.rows[0].id;

  // Mark all active consent records as withdrawn. The schema doesn't have
  // a withdrawal_reason column today, so the reason text is preserved on
  // the audit_log row below — that's the durable surface for DPDP audit.
  const result = await client.query(
    `UPDATE consent_records
     SET withdrawn_at = NOW()
     WHERE user_id = $1 AND withdrawn_at IS NULL
     RETURNING id`,
    [userId]
  );

  if (result.rows.length === 0) {
    return errorResponse(404, 'No active consent found');
  }

  // Log audit event (DPDP withdrawal). Uses the same audit_log schema
  // as recordConsent's audit row above — no actor_role column.
  await client.query(
    `INSERT INTO audit_log (
       action,
       resource_type,
       resource_id,
       user_id,
       details,
       created_at
     ) VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      'DELETE',
      'Consent',
      result.rows[0].id,
      userId,
      JSON.stringify({ reason: reason || 'User requested withdrawal' }),
    ]
  );

  return successResponse(200, {
    success: true,
    message: 'Consent withdrawn successfully',
    withdrawnAt: new Date().toISOString(),
  });
}

/**
 * Get the consent document text.
 */
function getConsentDocument() {
  return `
CARELOG PRIVACY CONSENT AND DATA PROCESSING AGREEMENT

Version: ${CURRENT_CONSENT_VERSION}
Effective Date: March 1, 2026

1. INTRODUCTION

CareLog ("we," "our," or "us") is committed to protecting your privacy and personal health information. This consent form explains how we collect, use, store, and protect your data in compliance with the Digital Personal Data Protection Act (DPDP) 2023 and applicable healthcare regulations.

2. DATA WE COLLECT

We collect the following categories of personal and health data:
- Personal identifiers (name, email, phone number)
- Health vitals (blood pressure, glucose, temperature, weight, pulse, SpO2)
- Medical documents (prescriptions, lab reports, medical photos)
- Voice and video recordings related to health
- Device information and usage data

3. PURPOSE OF DATA PROCESSING

Your data is processed for the following purposes:
- Monitoring and tracking your health vitals
- Sharing health information with your designated care team
- Generating alerts when vitals exceed configured thresholds
- Enabling communication between patients, caregivers, and healthcare providers
- Improving our services through anonymized analytics

4. DATA SHARING

Your data may be shared with:
- Family members and caregivers you designate
- Healthcare providers you authorize
- Service providers who assist in operating CareLog (under strict confidentiality)

We will NEVER sell your personal health information.

5. DATA STORAGE AND SECURITY

- Your data is stored securely on AWS servers with encryption at rest and in transit
- Data for Indian users is stored in AWS ap-south-1 (Mumbai) region
- To answer your conversations quickly, your messages may be processed by AI on AWS regions outside India and routed back to you. No personal identifiers are stored outside India; only the conversation content transits cross-region for inference.
- Access to your data is controlled through multi-factor authentication
- We maintain comprehensive audit logs of all data access

6. YOUR RIGHTS

Under DPDP 2023, you have the right to:
- Access your personal data
- Request correction of inaccurate data
- Request deletion of your data (subject to legal retention requirements)
- Withdraw this consent at any time
- Lodge a complaint with the Data Protection Board of India

7. DATA RETENTION

We retain your data for:
- Active accounts: Duration of account plus 7 years
- Health records: As required by applicable medical record retention laws
- Audit logs: 7 years minimum for compliance

8. CONSENT WITHDRAWAL

You may withdraw this consent at any time through the app settings. Withdrawal will:
- Stop future data collection
- Trigger account deactivation process
- Not affect lawfulness of prior processing

9. CONTACT INFORMATION

Data Protection Officer: dpo@carelog.health
Address: [Company Address]
Email: privacy@carelog.health

By accepting this consent, you confirm that you have read, understood, and agree to the processing of your personal and health data as described above.
`.trim();
}

/**
 * Create SHA-256 hash of text.
 */
function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function successResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ error: message }),
  };
}

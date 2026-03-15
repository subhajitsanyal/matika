/**
 * Consent Lambda
 *
 * Manages DPDP (Digital Personal Data Protection) consent records.
 * Stores versioned consent with cryptographic hashes.
 */

const { Client } = require('pg');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
};

// Current consent version
const CURRENT_CONSENT_VERSION = '1.0';

exports.handler = async (event) => {
  console.log('Consent request:', event.httpMethod, event.path);

  const client = new Client(dbConfig);

  try {
    await client.connect();

    const httpMethod = event.httpMethod || event.requestContext?.http?.method;
    const claims = event.requestContext?.authorizer?.claims || {};
    const userId = claims.sub;

    switch (httpMethod) {
      case 'GET':
        if (event.path?.endsWith('/text')) {
          return await getConsentText();
        }
        if (!userId) {
          return errorResponse(401, 'Unauthorized');
        }
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
 * Get user's consent status.
 */
async function getConsentStatus(client, userId) {
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
      hasConsent: false,
      currentVersion: CURRENT_CONSENT_VERSION,
      needsUpdate: true,
    });
  }

  const record = result.rows[0];
  const needsUpdate = record.consent_version !== CURRENT_CONSENT_VERSION;

  return successResponse(200, {
    hasConsent: true,
    consentVersion: record.consent_version,
    acceptedAt: record.accepted_at,
    currentVersion: CURRENT_CONSENT_VERSION,
    needsUpdate,
  });
}

/**
 * Record user consent acceptance.
 */
async function recordConsent(client, event, userId) {
  const body = JSON.parse(event.body || '{}');
  const { version, textHash, acceptedTerms } = body;

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

  // Get IP address from request
  const ipAddress = event.requestContext?.identity?.sourceIp ||
    event.headers?.['X-Forwarded-For']?.split(',')[0] ||
    'unknown';

  const id = uuidv4();

  await client.query(
    `INSERT INTO consent_records (
       id,
       user_id,
       consent_version,
       consent_text_hash,
       ip_address,
       user_agent,
       accepted_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      id,
      userId,
      version,
      textHash,
      ipAddress,
      event.headers?.['User-Agent'] || 'unknown',
    ]
  );

  // Log audit event
  await client.query(
    `INSERT INTO audit_log (
       action,
       resource_type,
       resource_id,
       user_id,
       actor_role,
       details,
       created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      'CREATE',
      'Consent',
      id,
      userId,
      'user',
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
 * Withdraw consent (DPDP right to withdraw).
 */
async function withdrawConsent(client, event, userId) {
  const body = JSON.parse(event.body || '{}');
  const { reason } = body;

  // Mark all consent records as withdrawn
  const result = await client.query(
    `UPDATE consent_records
     SET withdrawn_at = NOW(), withdrawal_reason = $2
     WHERE user_id = $1 AND withdrawn_at IS NULL
     RETURNING id`,
    [userId, reason || 'User requested withdrawal']
  );

  if (result.rows.length === 0) {
    return errorResponse(404, 'No active consent found');
  }

  // Log audit event
  await client.query(
    `INSERT INTO audit_log (
       action,
       resource_type,
       resource_id,
       user_id,
       actor_role,
       details,
       created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      'DELETE',
      'Consent',
      result.rows[0].id,
      userId,
      'user',
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

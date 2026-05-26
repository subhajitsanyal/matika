/**
 * Care Notes Lambda
 *
 * Surfaces the patient-originated asides captured by bedrock-router during
 * patient_logging sessions (PRD §6.9; Spec §4.6 contracts; Spec §6.10
 * conversation-engine flow on the writer side).
 *
 * Three endpoints, all Cognito-authenticated:
 *   GET  /patients/{patientId}/care-notes
 *   POST /patients/{patientId}/care-notes/{noteId}/acknowledge
 *   GET  /caregivers/{caregiverUserId}/care-notes/unread-count
 *
 * Schema reference (V016, Spec §5.1):
 *   - `care_notes.recipient_user_id` is nullable; null when
 *     `disambiguation_status IN ('ambiguous','no_match')`.
 *   - `mentioned_name` carries the raw spoken referent regardless of
 *     resolution outcome — the caregiver UI uses it on ambiguous/no_match.
 *   - `acknowledged_at` + `acknowledged_by` are nullable until ack.
 *
 * Access model:
 *   - GET/POST on /patients/{patientId}/... — caller must have an active
 *     `persona_links` row for the patient (caregiver scope) OR be the
 *     patient themselves.
 *   - GET on /caregivers/{caregiverUserId}/... — caller's resolved
 *     `users.id` must equal the URL parameter; the URL param is there for
 *     symmetry with the spec, not as an authorization escape hatch.
 *
 * v2 naming: function deploys as `matika-${env}-care-notes` per
 * [[lambda_naming_matika_prefix]] memory.
 */

const { Client } = require('pg');
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

exports.handler = async (event) => {
  const httpMethod = event.httpMethod || event.requestContext?.http?.method;
  const rawPath = event.path || event.requestContext?.http?.path || '';
  console.log('Care Notes request:', httpMethod, rawPath);

  const claims = event.requestContext?.authorizer?.claims || {};
  const cognitoSub = claims.sub;
  if (!cognitoSub) {
    return errorResponse(401, 'Unauthorized');
  }

  const client = await createDbConnection();
  try {
    const userId = await resolveUserIdFromCognitoSub(client, cognitoSub);
    if (!userId) {
      return errorResponse(401, 'User not found');
    }

    const params = event.pathParameters || {};
    const { patientId: patientIdParam, noteId, caregiverUserId } = params;

    // Branch on path/method. Ordering matters — the unread-count + acknowledge
    // routes are checked before the generic list route so a path with both
    // patientId and noteId doesn't fall into list.
    if (caregiverUserId && rawPath.endsWith('/unread-count') && httpMethod === 'GET') {
      if (caregiverUserId !== userId) {
        return errorResponse(403, 'forbidden_user_scope');
      }
      return await handleUnreadCount(client, userId);
    }

    if (!patientIdParam) {
      return errorResponse(400, 'Patient ID required');
    }

    const resolved = await resolvePatientDbId(client, patientIdParam);
    if (!resolved) {
      return errorResponse(404, 'Patient not found');
    }
    const patientUuid = resolved.id;
    const patientShortId = resolved.patient_id;

    const hasAccess = await checkPatientAccess(client, userId, patientUuid);
    if (!hasAccess) {
      return errorResponse(403, 'not_in_care_team');
    }

    if (noteId && rawPath.endsWith('/acknowledge') && httpMethod === 'POST') {
      return await handleAcknowledge(client, patientUuid, noteId, userId);
    }

    if (httpMethod === 'GET' && !noteId) {
      return await handleList(client, event, patientUuid, patientShortId);
    }

    return errorResponse(405, 'Method not allowed');
  } catch (error) {
    console.error('Care Notes error:', error);
    return errorResponse(500, 'Internal server error');
  } finally {
    await client.end();
  }
};

/**
 * GET /patients/{patientId}/care-notes
 *
 * Query params (Spec §4.6):
 *   status — unacknowledged (default) | acknowledged | all
 *   from / to — ISO date bounds; defaults to last 30 days
 *   limit — page size (default 50, max 200)
 *   cursor — opaque base64 cursor of { createdAt, id }
 *
 * Cursor pagination is keyed on (created_at DESC, id DESC) so duplicate
 * timestamps stay stable. The query fetches limit+1 rows and trims; the
 * extra row signals there's a next page.
 */
async function handleList(client, event, patientUuid, patientShortId) {
  const q = event.queryStringParameters || {};
  const status = q.status || 'unacknowledged';
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);

  const filters = ['cn.patient_id = $1'];
  const queryParams = [patientUuid];

  if (status === 'unacknowledged') {
    filters.push('cn.acknowledged_at IS NULL');
  } else if (status === 'acknowledged') {
    filters.push('cn.acknowledged_at IS NOT NULL');
  } else if (status !== 'all') {
    return errorResponse(400, 'invalid_status');
  }

  // Date bounds (inclusive). Default window: last 30 days.
  const toIso = q.to || new Date().toISOString();
  const fromIso = q.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (Number.isNaN(Date.parse(fromIso)) || Number.isNaN(Date.parse(toIso))) {
    return errorResponse(400, 'invalid_date_bounds');
  }
  queryParams.push(fromIso);
  filters.push(`cn.created_at >= $${queryParams.length}`);
  queryParams.push(toIso);
  filters.push(`cn.created_at <= $${queryParams.length}`);

  if (q.cursor) {
    const decoded = decodeCursor(q.cursor);
    if (!decoded) return errorResponse(400, 'invalid_cursor');
    queryParams.push(decoded.createdAt, decoded.id);
    filters.push(
      `(cn.created_at, cn.id) < ($${queryParams.length - 1}::timestamptz, $${queryParams.length}::uuid)`
    );
  }

  queryParams.push(limit + 1);
  const limitPlaceholder = `$${queryParams.length}`;

  // Single round-trip for list. `u_rec.name` gives the recipient's display
  // name; `users.preferred_name` does not exist yet (open question §5(1) in
  // the execution plan — to ship as V017 when prompt-side work needs it).
  const listSql = `
    SELECT
      cn.id,
      cn.patient_id,
      cn.session_id,
      cn.turn_index,
      cn.source,
      cn.recipient_role,
      cn.recipient_user_id,
      u_rec.name        AS recipient_display_name,
      cn.candidate_user_ids,
      cn.mentioned_name,
      cn.disambiguation_status,
      cn.note_text,
      cn.note_language,
      cn.acknowledged_at,
      cn.acknowledged_by,
      cn.created_at
    FROM care_notes cn
    LEFT JOIN users u_rec ON u_rec.id = cn.recipient_user_id
    WHERE ${filters.join(' AND ')}
    ORDER BY cn.created_at DESC, cn.id DESC
    LIMIT ${limitPlaceholder}
  `;

  const result = await client.query(listSql, queryParams);
  const rows = result.rows;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  // The unacknowledged count is a separate, predictable query. Driven by the
  // partial index `idx_care_notes_patient_unacked` (V016).
  const unackResult = await client.query(
    `SELECT COUNT(*)::int AS unack
       FROM care_notes
      WHERE patient_id = $1 AND acknowledged_at IS NULL`,
    [patientUuid]
  );

  const items = pageRows.map((r) => ({
    id: r.id,
    patientId: r.patient_id,
    patientShortId,
    sessionId: r.session_id,
    turnIndex: r.turn_index,
    source: r.source,
    recipientRole: r.recipient_role,
    recipientUserId: r.recipient_user_id,
    recipientDisplayName: r.recipient_display_name,
    candidateUserIds: r.candidate_user_ids,
    mentionedName: r.mentioned_name,
    disambiguationStatus: r.disambiguation_status,
    noteText: r.note_text,
    noteLanguage: r.note_language,
    acknowledgedAt: r.acknowledged_at,
    acknowledgedBy: r.acknowledged_by,
    createdAt: r.created_at,
  }));

  let nextCursor = null;
  if (hasMore) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = encodeCursor({ createdAt: last.created_at, id: last.id });
  }

  return successResponse(200, {
    items,
    nextCursor,
    unacknowledgedCount: unackResult.rows[0].unack,
  });
}

/**
 * POST /patients/{patientId}/care-notes/{noteId}/acknowledge
 *
 * Idempotent: re-acking the same row is a no-op (returns the existing ack
 * fields). If a different caregiver already acked, we still 200 with their
 * details so the UI can show "Acked by X" — spec §4.6 calls this out.
 *
 * 404 if the note exists but belongs to a different patient — keeps the
 * caregiver from peeking into rows scoped to a patient they're not on.
 */
async function handleAcknowledge(client, patientUuid, noteId, userId) {
  const existing = await client.query(
    `SELECT id, patient_id, acknowledged_at, acknowledged_by
       FROM care_notes WHERE id = $1`,
    [noteId]
  );
  if (existing.rows.length === 0) {
    return errorResponse(404, 'note_not_found');
  }
  const row = existing.rows[0];
  if (row.patient_id !== patientUuid) {
    return errorResponse(404, 'note_not_found');
  }

  if (row.acknowledged_at) {
    // Idempotent — return existing ack regardless of who acked.
    return successResponse(200, {
      id: row.id,
      acknowledgedAt: row.acknowledged_at,
      acknowledgedBy: row.acknowledged_by,
    });
  }

  const update = await client.query(
    `UPDATE care_notes
        SET acknowledged_at = NOW(),
            acknowledged_by = $2
      WHERE id = $1
      RETURNING acknowledged_at, acknowledged_by`,
    [noteId, userId]
  );
  return successResponse(200, {
    id: noteId,
    acknowledgedAt: update.rows[0].acknowledged_at,
    acknowledgedBy: update.rows[0].acknowledged_by,
  });
}

/**
 * GET /caregivers/{caregiverUserId}/care-notes/unread-count
 *
 * Fans out across every patient linked to the caregiver. Backed by the
 * partial index `idx_care_notes_recipient_unacked` (V016).
 */
async function handleUnreadCount(client, userId) {
  const result = await client.query(
    `SELECT p.patient_id AS patient_short_id, COUNT(*)::int AS count
       FROM care_notes cn
       JOIN patients p ON p.id = cn.patient_id
      WHERE cn.recipient_user_id = $1 AND cn.acknowledged_at IS NULL
      GROUP BY p.id, p.patient_id
      ORDER BY count DESC`,
    [userId]
  );
  const perPatient = result.rows.map((r) => ({
    patientShortId: r.patient_short_id,
    count: r.count,
  }));
  const total = perPatient.reduce((acc, r) => acc + r.count, 0);
  return successResponse(200, { count: total, perPatient });
}

function encodeCursor(parts) {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed.createdAt || !parsed.id) return null;
    return parsed;
  } catch (_e) {
    return null;
  }
}

async function resolveUserIdFromCognitoSub(client, cognitoSub) {
  const result = await client.query(
    `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
    [cognitoSub]
  );
  return result.rows[0]?.id || null;
}

// F52/F54 class — accept either the patients.id UUID or the human-readable
// short code (`CL-012W6M`) at the URL boundary; downstream queries use UUID.
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

async function checkPatientAccess(client, userId, patientUuid) {
  const linkResult = await client.query(
    `SELECT 1 FROM persona_links
      WHERE linked_user_id = $1 AND patient_id = $2 AND is_active = true`,
    [userId, patientUuid]
  );
  if (linkResult.rows.length > 0) return true;

  const selfResult = await client.query(
    `SELECT 1 FROM patients WHERE id = $1 AND user_id = $2`,
    [patientUuid, userId]
  );
  return selfResult.rows.length > 0;
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

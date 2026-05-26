/**
 * Tests for care-notes Lambda.
 *
 * Mirrors the alert-crud test harness pattern: pg.Client and Secrets Manager
 * are mocked so each handler path exercises auth/access + the SQL shape
 * (column names from V016, partial-index-friendly WHERE clauses).
 */

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockEnd = jest.fn();
const mockSmSend = jest.fn();

jest.mock('pg', () => ({
  Client: jest.fn(),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: mockSmSend,
  })),
  GetSecretValueCommand: jest.fn(),
}));

process.env.DB_SECRET_NAME = 'test-secret';

const { Client } = require('pg');
const { handler } = require('../index');

const mockDbCredentials = {
  host: 'localhost',
  port: 5432,
  dbname: 'testdb',
  username: 'user',
  password: 'pass',
};

const COGNITO_SUB = 'cog-sub-1';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const PATIENT_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PATIENT_SHORT = 'CL-012W6M';
const NOTE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function buildEvent({
  method = 'GET',
  path = '',
  pathParameters = {},
  queryStringParameters = {},
  sub = COGNITO_SUB,
  body = null,
} = {}) {
  return {
    httpMethod: method,
    path,
    pathParameters,
    queryStringParameters,
    body: body ? JSON.stringify(body) : null,
    requestContext: { authorizer: { claims: sub ? { sub } : {} } },
  };
}

function lastQuery() {
  return mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
}

function queryAt(index) {
  return mockQuery.mock.calls[index];
}

describe('care-notes Lambda', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    Client.mockImplementation(() => ({
      connect: mockConnect,
      query: mockQuery,
      end: mockEnd,
    }));
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(mockDbCredentials) });
  });

  // ---------- AUTH & ACCESS ----------
  describe('auth & access', () => {
    test('401 when no Cognito sub on the request', async () => {
      const result = await handler(
        buildEvent({ method: 'GET', path: `/patients/${PATIENT_SHORT}/care-notes`, sub: null })
      );
      expect(result.statusCode).toBe(401);
    });

    test('401 when sub does not resolve to a users row', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // resolveUserIdFromCognitoSub
      const result = await handler(
        buildEvent({
          method: 'GET',
          path: `/patients/${PATIENT_SHORT}/care-notes`,
          pathParameters: { patientId: PATIENT_SHORT },
        })
      );
      expect(result.statusCode).toBe(401);
    });

    test('404 patient_not_found when short code does not resolve', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] }) // user
        .mockResolvedValueOnce({ rows: [] }); // patient (short-code lookup)
      const result = await handler(
        buildEvent({
          method: 'GET',
          path: `/patients/BOGUS/care-notes`,
          pathParameters: { patientId: 'BOGUS' },
        })
      );
      expect(result.statusCode).toBe(404);
    });

    test('403 not_in_care_team when caller has no active persona_link and is not the patient', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] }) // user
        .mockResolvedValueOnce({ rows: [{ id: PATIENT_UUID, patient_id: PATIENT_SHORT }] }) // patient (short)
        .mockResolvedValueOnce({ rows: [] }) // persona_links — none
        .mockResolvedValueOnce({ rows: [] }); // patients self-check — not the patient
      const result = await handler(
        buildEvent({
          method: 'GET',
          path: `/patients/${PATIENT_SHORT}/care-notes`,
          pathParameters: { patientId: PATIENT_SHORT },
        })
      );
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).error).toBe('not_in_care_team');
    });
  });

  // ---------- LIST ----------
  describe('GET /patients/{id}/care-notes', () => {
    function primeAccess() {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] }) // user
        .mockResolvedValueOnce({ rows: [{ id: PATIENT_UUID, patient_id: PATIENT_SHORT }] }) // patient by short code
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // persona_links access
    }

    test('returns items shaped per Spec §4.6 + unacknowledgedCount', async () => {
      primeAccess();
      const row = {
        id: NOTE_ID,
        patient_id: PATIENT_UUID,
        session_id: 'sess-uuid',
        turn_index: 4,
        source: 'patient_request',
        recipient_role: 'caregiver',
        recipient_user_id: USER_ID,
        recipient_display_name: 'John CG',
        candidate_user_ids: null,
        mentioned_name: 'caregiver',
        disambiguation_status: 'resolved_default',
        note_text: 'Add cholesterol to tracking',
        note_language: 'en-IN',
        acknowledged_at: null,
        acknowledged_by: null,
        created_at: '2026-05-25T17:48:37Z',
      };
      mockQuery
        .mockResolvedValueOnce({ rows: [row] }) // list
        .mockResolvedValueOnce({ rows: [{ unack: 1 }] }); // unack count

      const result = await handler(
        buildEvent({
          method: 'GET',
          path: `/patients/${PATIENT_SHORT}/care-notes`,
          pathParameters: { patientId: PATIENT_SHORT },
        })
      );
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        id: NOTE_ID,
        patientId: PATIENT_UUID,
        patientShortId: PATIENT_SHORT,
        sessionId: 'sess-uuid',
        recipientDisplayName: 'John CG',
        mentionedName: 'caregiver',
        disambiguationStatus: 'resolved_default',
        noteText: 'Add cholesterol to tracking',
      });
      expect(body.unacknowledgedCount).toBe(1);
      expect(body.nextCursor).toBeNull();
    });

    test('emits nextCursor when more rows exist beyond the page', async () => {
      primeAccess();
      // Limit=2 → fetch 3, drop the third, emit cursor from the second.
      const rowProto = {
        patient_id: PATIENT_UUID,
        session_id: null,
        turn_index: null,
        source: 'patient_request',
        recipient_role: 'caregiver',
        recipient_user_id: USER_ID,
        recipient_display_name: 'John CG',
        candidate_user_ids: null,
        mentioned_name: null,
        disambiguation_status: 'resolved_default',
        note_text: 'x',
        note_language: 'en-IN',
        acknowledged_at: null,
        acknowledged_by: null,
      };
      const r1 = { ...rowProto, id: 'aaaaaaaa-0001-0000-0000-000000000000', created_at: '2026-05-25T18:00:00Z' };
      const r2 = { ...rowProto, id: 'aaaaaaaa-0002-0000-0000-000000000000', created_at: '2026-05-25T17:00:00Z' };
      const r3 = { ...rowProto, id: 'aaaaaaaa-0003-0000-0000-000000000000', created_at: '2026-05-25T16:00:00Z' };
      mockQuery
        .mockResolvedValueOnce({ rows: [r1, r2, r3] })
        .mockResolvedValueOnce({ rows: [{ unack: 5 }] });

      const result = await handler(
        buildEvent({
          method: 'GET',
          path: `/patients/${PATIENT_SHORT}/care-notes`,
          pathParameters: { patientId: PATIENT_SHORT },
          queryStringParameters: { limit: '2' },
        })
      );
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.items).toHaveLength(2);
      expect(body.nextCursor).not.toBeNull();
      const decoded = JSON.parse(Buffer.from(body.nextCursor, 'base64url').toString('utf8'));
      expect(decoded.id).toBe(r2.id);
    });

    test('status=acknowledged filter switches the WHERE clause', async () => {
      primeAccess();
      mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ unack: 0 }] });
      await handler(
        buildEvent({
          method: 'GET',
          path: `/patients/${PATIENT_SHORT}/care-notes`,
          pathParameters: { patientId: PATIENT_SHORT },
          queryStringParameters: { status: 'acknowledged' },
        })
      );
      const listSql = queryAt(3)[0]; // user, patient, access, list
      expect(listSql).toMatch(/cn\.acknowledged_at IS NOT NULL/);
      expect(listSql).not.toMatch(/cn\.acknowledged_at IS NULL[^\s]/);
    });

    test('400 on invalid status', async () => {
      primeAccess();
      const result = await handler(
        buildEvent({
          method: 'GET',
          path: `/patients/${PATIENT_SHORT}/care-notes`,
          pathParameters: { patientId: PATIENT_SHORT },
          queryStringParameters: { status: 'banana' },
        })
      );
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('invalid_status');
    });

    test('400 on malformed cursor', async () => {
      primeAccess();
      const result = await handler(
        buildEvent({
          method: 'GET',
          path: `/patients/${PATIENT_SHORT}/care-notes`,
          pathParameters: { patientId: PATIENT_SHORT },
          queryStringParameters: { cursor: '!!!not-base64!!!' },
        })
      );
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('invalid_cursor');
    });
  });

  // ---------- ACKNOWLEDGE ----------
  describe('POST /patients/{id}/care-notes/{noteId}/acknowledge', () => {
    function primeAccess() {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] })
        .mockResolvedValueOnce({ rows: [{ id: PATIENT_UUID, patient_id: PATIENT_SHORT }] })
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    }

    test('happy path — stamps acknowledged_at + acknowledged_by', async () => {
      primeAccess();
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: NOTE_ID, patient_id: PATIENT_UUID, acknowledged_at: null, acknowledged_by: null }],
        })
        .mockResolvedValueOnce({
          rows: [{ acknowledged_at: '2026-05-25T18:00:00Z', acknowledged_by: USER_ID }],
        });
      const result = await handler(
        buildEvent({
          method: 'POST',
          path: `/patients/${PATIENT_SHORT}/care-notes/${NOTE_ID}/acknowledge`,
          pathParameters: { patientId: PATIENT_SHORT, noteId: NOTE_ID },
        })
      );
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.acknowledgedBy).toBe(USER_ID);
      expect(body.acknowledgedAt).toBe('2026-05-25T18:00:00Z');
    });

    test('idempotent — re-ack returns existing ack without re-UPDATE', async () => {
      primeAccess();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: NOTE_ID,
            patient_id: PATIENT_UUID,
            acknowledged_at: '2026-05-25T17:00:00Z',
            acknowledged_by: OTHER_USER_ID,
          },
        ],
      });
      const result = await handler(
        buildEvent({
          method: 'POST',
          path: `/patients/${PATIENT_SHORT}/care-notes/${NOTE_ID}/acknowledge`,
          pathParameters: { patientId: PATIENT_SHORT, noteId: NOTE_ID },
        })
      );
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.acknowledgedBy).toBe(OTHER_USER_ID); // ack-by stays with the original acker
      // Only 4 queries: user, patient, access, SELECT existing — no UPDATE.
      expect(mockQuery.mock.calls).toHaveLength(4);
    });

    test('404 note_not_found when noteId belongs to a different patient', async () => {
      primeAccess();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: NOTE_ID,
            patient_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            acknowledged_at: null,
            acknowledged_by: null,
          },
        ],
      });
      const result = await handler(
        buildEvent({
          method: 'POST',
          path: `/patients/${PATIENT_SHORT}/care-notes/${NOTE_ID}/acknowledge`,
          pathParameters: { patientId: PATIENT_SHORT, noteId: NOTE_ID },
        })
      );
      expect(result.statusCode).toBe(404);
    });

    test('404 when noteId does not exist at all', async () => {
      primeAccess();
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await handler(
        buildEvent({
          method: 'POST',
          path: `/patients/${PATIENT_SHORT}/care-notes/${NOTE_ID}/acknowledge`,
          pathParameters: { patientId: PATIENT_SHORT, noteId: NOTE_ID },
        })
      );
      expect(result.statusCode).toBe(404);
    });
  });

  // ---------- UNREAD COUNT ----------
  describe('GET /caregivers/{caregiverUserId}/care-notes/unread-count', () => {
    test('fans out across linked patients and returns total', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] }) // resolveUser
        .mockResolvedValueOnce({
          rows: [
            { patient_short_id: 'CL-012W6M', count: 2 },
            { patient_short_id: 'CL-PNDN1P', count: 1 },
          ],
        });
      const result = await handler(
        buildEvent({
          method: 'GET',
          path: `/caregivers/${USER_ID}/care-notes/unread-count`,
          pathParameters: { caregiverUserId: USER_ID },
        })
      );
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.count).toBe(3);
      expect(body.perPatient).toEqual([
        { patientShortId: 'CL-012W6M', count: 2 },
        { patientShortId: 'CL-PNDN1P', count: 1 },
      ]);
    });

    test('403 when URL caregiverUserId does not match the caller', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: USER_ID }] });
      const result = await handler(
        buildEvent({
          method: 'GET',
          path: `/caregivers/${OTHER_USER_ID}/care-notes/unread-count`,
          pathParameters: { caregiverUserId: OTHER_USER_ID },
        })
      );
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).error).toBe('forbidden_user_scope');
    });

    test('returns count=0 + empty perPatient when caregiver has no unacked notes', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] })
        .mockResolvedValueOnce({ rows: [] });
      const result = await handler(
        buildEvent({
          method: 'GET',
          path: `/caregivers/${USER_ID}/care-notes/unread-count`,
          pathParameters: { caregiverUserId: USER_ID },
        })
      );
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.count).toBe(0);
      expect(body.perPatient).toEqual([]);
    });
  });

  // ---------- SCHEMA-DRIFT REGRESSION GUARDS ----------
  describe('schema-drift regression guards (V016 columns)', () => {
    test('list SQL references V016 column names verbatim', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] })
        .mockResolvedValueOnce({ rows: [{ id: PATIENT_UUID, patient_id: PATIENT_SHORT }] })
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ unack: 0 }] });
      await handler(
        buildEvent({
          method: 'GET',
          path: `/patients/${PATIENT_SHORT}/care-notes`,
          pathParameters: { patientId: PATIENT_SHORT },
        })
      );
      const listSql = queryAt(3)[0];
      // Required V016 columns:
      ['cn.id', 'cn.patient_id', 'cn.session_id', 'cn.turn_index', 'cn.source',
        'cn.recipient_role', 'cn.recipient_user_id', 'cn.candidate_user_ids',
        'cn.mentioned_name', 'cn.disambiguation_status', 'cn.note_text',
        'cn.note_language', 'cn.acknowledged_at', 'cn.acknowledged_by', 'cn.created_at']
        .forEach((col) => expect(listSql).toContain(col));
      // Must NOT reference a non-existent display-name column. preferred_name
      // is the open §5(1) question — until V017 lands, the lambda uses
      // users.name (the only real column).
      expect(listSql).not.toMatch(/u_rec\.preferred_name/);
      expect(listSql).toMatch(/u_rec\.name\s+AS recipient_display_name/);
    });
  });
});

/**
 * Tests for alert-crud Lambda.
 *
 * Focus: schema-drift regression guards (F13). Each handler path is exercised
 * with mocked pg; the assertions verify the SQL contains the live-schema
 * column names and does NOT contain any of the dropped/renamed columns.
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
const USER_ID = 'user-uuid-1';
const PATIENT_ID = 'patient-uuid-1';
const ALERT_ID = 'alert-uuid-1';

function buildEvent({ method = 'GET', patientId, alertId, body, queryStringParameters } = {}) {
  return {
    httpMethod: method,
    pathParameters: {
      ...(patientId ? { patientId } : {}),
      ...(alertId ? { alertId } : {}),
    },
    queryStringParameters: queryStringParameters || {},
    body: body ? JSON.stringify(body) : null,
    requestContext: {
      authorizer: { claims: { sub: COGNITO_SUB } },
    },
  };
}

describe('alert-crud Lambda', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    Client.mockImplementation(() => ({
      connect: mockConnect,
      query: mockQuery,
      end: mockEnd,
    }));
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(mockDbCredentials) });
  });

  describe('auth & access', () => {
    test('returns 401 when no Cognito sub on the request', async () => {
      const event = buildEvent({ method: 'GET', patientId: PATIENT_ID });
      delete event.requestContext.authorizer.claims.sub;

      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    test('returns 401 when Cognito sub does not resolve to a users row', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // resolveUserIdFromCognitoSub
      const result = await handler(buildEvent({ method: 'GET', patientId: PATIENT_ID }));
      expect(result.statusCode).toBe(401);
    });

    test('returns 403 when the caller is neither linked to the patient nor the patient', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] })   // resolveUserIdFromCognitoSub
        .mockResolvedValueOnce({ rows: [] })                  // persona_links
        .mockResolvedValueOnce({ rows: [] });                 // patients self-check
      const result = await handler(buildEvent({ method: 'GET', patientId: PATIENT_ID }));
      expect(result.statusCode).toBe(403);
    });
  });

  describe('GET /alerts schema-drift regression guards', () => {
    beforeEach(() => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] })   // resolveUserIdFromCognitoSub
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // persona_links access
        // getAlerts: list / count / unread-count
        .mockResolvedValueOnce({
          rows: [
            {
              id: ALERT_ID,
              alert_type: 'threshold_breach',
              vital_type: 'blood_pressure_systolic',
              vital_value: '200.00',
              vital_unit: 'mmHg',
              threshold_min: null,
              threshold_max: '160.00',
              message: "Jane's BP is 200 mmHg",
              timestamp: '2026-05-09T18:13:25.000Z',
              is_read: false,
              read_at: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({ rows: [{ unread: 1 }] });
    });

    test('list query references vital_value / vital_unit / threshold_min / threshold_max + recipient_user_id', async () => {
      await handler(buildEvent({ method: 'GET', patientId: PATIENT_ID }));

      const listCall = mockQuery.mock.calls.find(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes('FROM alerts') &&
          sql.includes('ORDER BY')
      );
      expect(listCall).toBeDefined();
      const [listSql] = listCall;
      expect(listSql).toMatch(/a\.vital_value/);
      expect(listSql).toMatch(/a\.vital_unit/);
      expect(listSql).toMatch(/a\.threshold_min/);
      expect(listSql).toMatch(/a\.threshold_max/);
      expect(listSql).toMatch(/a\.is_read/);
      expect(listSql).toMatch(/a\.recipient_user_id = \$2/);
      // Negative guards: no references to the dropped/renamed shape.
      expect(listSql).not.toMatch(/\ba\.value\b/);
      expect(listSql).not.toMatch(/deleted_at/);
      expect(listSql).not.toMatch(/alert_reads/);
    });

    test('response surfaces vitalValue / vitalUnit / threshold bounds', async () => {
      const result = await handler(buildEvent({ method: 'GET', patientId: PATIENT_ID }));
      const payload = JSON.parse(result.body);
      expect(payload.alerts).toHaveLength(1);
      const alert = payload.alerts[0];
      expect(alert.vitalValue).toBe(200);
      expect(alert.vitalUnit).toBe('mmHg');
      expect(alert.thresholdMin).toBeNull();
      expect(alert.thresholdMax).toBe(160);
      expect(alert.read).toBe(false);
      expect(alert).not.toHaveProperty('value'); // legacy field should not leak
    });

    test('unreadOnly query string adds is_read=false filter (not alert_reads.read_at IS NULL)', async () => {
      await handler(
        buildEvent({
          method: 'GET',
          patientId: PATIENT_ID,
          queryStringParameters: { unreadOnly: 'true' },
        })
      );

      const listCall = mockQuery.mock.calls.find(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes('FROM alerts') &&
          sql.includes('ORDER BY')
      );
      expect(listCall[0]).toMatch(/a\.is_read = false/);
      expect(listCall[0]).not.toMatch(/alert_reads/);
    });
  });

  describe('PATCH /alerts/:id', () => {
    test('mark-read UPDATEs alerts.is_read directly (no alert_reads insert)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] })   // resolveUserIdFromCognitoSub
        .mockResolvedValueOnce({ rows: [{ recipient_user_id: USER_ID }] }) // ownership check
        .mockResolvedValueOnce({ rowCount: 1 });              // UPDATE

      await handler(
        buildEvent({ method: 'PATCH', alertId: ALERT_ID, body: { read: true } })
      );

      const updateCall = mockQuery.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE alerts SET is_read')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[0]).toMatch(/SET is_read = true, read_at = NOW\(\)/);
      expect(updateCall[0]).not.toMatch(/alert_reads/);
    });

    test('returns 403 when caller is not the alert recipient', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] })
        .mockResolvedValueOnce({ rows: [{ recipient_user_id: 'someone-else' }] });

      const result = await handler(
        buildEvent({ method: 'PATCH', alertId: ALERT_ID, body: { read: true } })
      );
      expect(result.statusCode).toBe(403);
    });
  });

  describe('DELETE /alerts/:id', () => {
    test('hard-deletes via DELETE FROM alerts (schema has no deleted_at)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] })
        .mockResolvedValueOnce({ rows: [{ recipient_user_id: USER_ID }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      await handler(buildEvent({ method: 'DELETE', alertId: ALERT_ID }));

      const deleteCall = mockQuery.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.startsWith('DELETE FROM alerts')
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall[0]).not.toMatch(/deleted_at/);
      expect(deleteCall[0]).not.toMatch(/UPDATE alerts/);
    });
  });

  describe('persona_links access query uses live column names', () => {
    test('checkPatientAccess SELECTs from persona_links by linked_user_id + is_active', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: USER_ID }] })
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })  // persona_links match
        .mockResolvedValueOnce({ rows: [] })                    // empty list
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [{ unread: 0 }] });

      await handler(buildEvent({ method: 'GET', patientId: PATIENT_ID }));

      const personaCall = mockQuery.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('FROM persona_links')
      );
      expect(personaCall).toBeDefined();
      expect(personaCall[0]).toMatch(/linked_user_id = \$1/);
      expect(personaCall[0]).toMatch(/is_active = true/);
      // Negative guards
      expect(personaCall[0]).not.toMatch(/\buser_id = \$1\b/); // pre-rename column name
      expect(personaCall[0]).not.toMatch(/status\s*=\s*'active'/);
    });
  });
});

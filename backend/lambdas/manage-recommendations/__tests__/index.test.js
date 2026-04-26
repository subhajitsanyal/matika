/**
 * Tests for manage-recommendations Lambda
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

describe('manage-recommendations Lambda', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    Client.mockImplementation(() => ({
      connect: mockConnect,
      query: mockQuery,
      end: mockEnd,
    }));
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(mockDbCredentials) });
  });

  const makeEvent = (method, patientId, extra = {}) => ({
    httpMethod: method,
    path: `/patients/${patientId}/recommendations`,
    pathParameters: { patientId, ...extra.pathParams },
    requestContext: {
      authorizer: {
        claims: { sub: extra.sub || 'user-sub-123' },
      },
    },
    body: extra.body ? JSON.stringify(extra.body) : null,
    queryStringParameters: extra.query || null,
  });

  // Helpers to configure mock query responses
  const setupPatientResolve = (patientDbId = 'patient-db-uuid') => {
    // resolvePatientDbId
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: patientDbId, patient_id: 'CL-123456' }],
    });
  };

  const setupAccessCheck = (userId = 'user-db-id', personaType = 'doctor', linked = true) => {
    // user lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: userId, persona_type: personaType }],
    });
    // persona_links check
    mockQuery.mockResolvedValueOnce({
      rows: linked ? [{ '?column?': 1 }] : [],
    });
  };

  test('returns 401 when no auth claims', async () => {
    const event = makeEvent('GET', 'patient-1', { sub: undefined });
    event.requestContext.authorizer.claims = {};

    const result = await handler(event);
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('Unauthorized');
  });

  test('returns 400 when no patientId', async () => {
    const event = makeEvent('GET', null);
    event.pathParameters = {};

    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  test('returns 404 when patient not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UUID check
    mockQuery.mockResolvedValueOnce({ rows: [] }); // patient_id check

    const result = await handler(makeEvent('GET', 'nonexistent'));
    expect(result.statusCode).toBe(404);
  });

  test('GET returns list of recommendations', async () => {
    setupPatientResolve();
    setupAccessCheck('user-1', 'doctor', true);

    // listRecommendations query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'rec-1',
          source: 'doctor',
          parameter_name: 'blood_glucose',
          status: 'pending',
          created_at: '2026-04-20T14:00:00Z',
        },
      ],
    });

    const result = await handler(makeEvent('GET', 'patient-db-uuid'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].parameter_name).toBe('blood_glucose');
  });

  test('POST creates recommendation when user is doctor', async () => {
    setupPatientResolve();
    setupAccessCheck('doctor-user-id', 'doctor', true);

    // INSERT
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'new-rec-id',
        source: 'doctor',
        parameter_name: 'blood_glucose_fasting',
        status: 'pending',
      }],
    });

    const result = await handler(makeEvent('POST', 'patient-db-uuid', {
      body: {
        parameter_name: 'blood_glucose_fasting',
        loinc_code: '1558-6',
        rationale: 'Track fasting glucose',
        suggested_frequency_days: 1,
      },
    }));

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.parameter_name).toBe('blood_glucose_fasting');
  });

  test('POST returns 403 when user is not doctor', async () => {
    setupPatientResolve();
    setupAccessCheck('caregiver-id', 'attendant', true);

    const result = await handler(makeEvent('POST', 'patient-db-uuid', {
      body: { parameter_name: 'test' },
    }));

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error).toContain('Only doctors');
  });

  test('PUT accepts recommendation when user is caregiver', async () => {
    setupPatientResolve();
    setupAccessCheck('caregiver-id', 'attendant', true);

    // existing recommendation check
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'rec-1',
        parameter_name: 'blood_glucose',
        loinc_code: '1558-6',
        suggested_frequency_days: 1,
      }],
    });

    // UPDATE
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rec-1', status: 'accepted', resolved_at: '2026-04-21T10:00:00Z' }],
    });

    // auto-create parameter_config
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await handler(makeEvent('PUT', 'patient-db-uuid', {
      pathParams: { recommendationId: 'rec-1' },
      body: { status: 'accepted' },
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).status).toBe('accepted');
  });

  test('PUT rejects with invalid status', async () => {
    setupPatientResolve();
    setupAccessCheck('caregiver-id', 'attendant', true);

    const result = await handler(makeEvent('PUT', 'patient-db-uuid', {
      pathParams: { recommendationId: 'rec-1' },
      body: { status: 'invalid' },
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('accepted');
  });

  test('PUT returns 403 when doctor tries to accept/reject', async () => {
    setupPatientResolve();
    setupAccessCheck('doctor-id', 'doctor', true);

    const result = await handler(makeEvent('PUT', 'patient-db-uuid', {
      pathParams: { recommendationId: 'rec-1' },
      body: { status: 'accepted' },
    }));

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error).toContain('Only caregivers');
  });

  test('returns 403 when user has no access', async () => {
    setupPatientResolve();
    // user lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'random-user', persona_type: 'attendant' }],
    });
    // persona_links - not linked
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // patient check - not the patient
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await handler(makeEvent('GET', 'patient-db-uuid'));
    expect(result.statusCode).toBe(403);
  });
});

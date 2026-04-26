/**
 * Tests for manage-parameter-configs Lambda
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

describe('manage-parameter-configs Lambda', () => {
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
    path: `/patients/${patientId}/parameter-configs`,
    pathParameters: { patientId, ...extra.pathParams },
    requestContext: {
      authorizer: {
        claims: { sub: extra.sub || 'user-sub-123' },
      },
    },
    body: extra.body ? JSON.stringify(extra.body) : null,
    queryStringParameters: extra.query || null,
  });

  const setupPatientResolve = (patientDbId = 'patient-db-uuid') => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: patientDbId, patient_id: 'CL-123456' }],
    });
  };

  const setupAccessCheck = (userId = 'user-db-id', personaType = 'attendant', linked = true) => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: userId, persona_type: personaType }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: linked ? [{ '?column?': 1 }] : [],
    });
  };

  test('returns 401 when no auth claims', async () => {
    const event = makeEvent('GET', 'patient-1');
    event.requestContext.authorizer.claims = {};

    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  test('returns 404 when patient not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await handler(makeEvent('GET', 'nonexistent'));
    expect(result.statusCode).toBe(404);
  });

  test('GET returns list of active parameter configs', async () => {
    setupPatientResolve();
    setupAccessCheck();

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'config-1',
          parameter_name: 'blood_pressure',
          display_name: 'Blood Pressure',
          loinc_codes: '["8480-6"]',
          unit: 'mmHg',
          frequency_days: 1,
          active: true,
        },
      ],
    });

    const result = await handler(makeEvent('GET', 'patient-db-uuid'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.parameter_configs).toHaveLength(1);
    expect(body.parameter_configs[0].parameter_name).toBe('blood_pressure');
  });

  test('POST creates parameter config with required fields', async () => {
    setupPatientResolve();
    setupAccessCheck('caregiver-id', 'attendant', true);

    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'new-config-id',
        parameter_name: 'blood_glucose',
        display_name: 'Blood Glucose',
        unit: 'mg/dL',
        frequency_days: 1,
      }],
    });

    const result = await handler(makeEvent('POST', 'patient-db-uuid', {
      body: {
        parameter_name: 'blood_glucose',
        display_name: 'Blood Glucose',
        loinc_codes: ['2339-0'],
        unit: 'mg/dL',
        frequency_days: 1,
      },
    }));

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).parameter_name).toBe('blood_glucose');
  });

  test('POST returns 400 when required fields missing', async () => {
    setupPatientResolve();
    setupAccessCheck();

    const result = await handler(makeEvent('POST', 'patient-db-uuid', {
      body: { parameter_name: 'test' },
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Missing required fields');
  });

  test('POST with doctor sets threshold_set_by when thresholds provided', async () => {
    setupPatientResolve();
    setupAccessCheck('doctor-id', 'doctor', true);

    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'new-config-id',
        parameter_name: 'blood_pressure',
        threshold_min: 90,
        threshold_max: 140,
        threshold_set_by: 'doctor-id',
      }],
    });

    const result = await handler(makeEvent('POST', 'patient-db-uuid', {
      body: {
        parameter_name: 'blood_pressure',
        display_name: 'Blood Pressure',
        loinc_codes: ['8480-6'],
        unit: 'mmHg',
        frequency_days: 1,
        threshold_min: 90,
        threshold_max: 140,
      },
    }));

    expect(result.statusCode).toBe(201);
    // Verify the INSERT query was called with doctor's userId as threshold_set_by
    const insertCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO parameter_configs')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain('doctor-id'); // threshold_set_by
  });

  test('PUT updates parameter config', async () => {
    setupPatientResolve();
    setupAccessCheck('caregiver-id', 'attendant', true);

    // existing check
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'config-1' }] });
    // UPDATE
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'config-1', frequency_days: 2 }],
    });

    const result = await handler(makeEvent('PUT', 'patient-db-uuid', {
      pathParams: { configId: 'config-1' },
      body: { frequency_days: 2 },
    }));

    expect(result.statusCode).toBe(200);
  });

  test('PUT returns 404 for non-existent config', async () => {
    setupPatientResolve();
    setupAccessCheck();

    mockQuery.mockResolvedValueOnce({ rows: [] }); // existing check

    const result = await handler(makeEvent('PUT', 'patient-db-uuid', {
      pathParams: { configId: 'nonexistent' },
      body: { frequency_days: 2 },
    }));

    expect(result.statusCode).toBe(404);
  });

  test('DELETE soft-deletes parameter config', async () => {
    setupPatientResolve();
    setupAccessCheck();

    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'config-1', active: false }],
    });

    const result = await handler(makeEvent('DELETE', 'patient-db-uuid', {
      pathParams: { configId: 'config-1' },
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).message).toContain('deactivated');
  });

  test('DELETE returns 404 for non-existent config', async () => {
    setupPatientResolve();
    setupAccessCheck();

    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await handler(makeEvent('DELETE', 'patient-db-uuid', {
      pathParams: { configId: 'nonexistent' },
    }));

    expect(result.statusCode).toBe(404);
  });

  test('returns 403 when user not linked to patient', async () => {
    setupPatientResolve();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'random-user', persona_type: 'attendant' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // not linked

    const result = await handler(makeEvent('GET', 'patient-db-uuid'));
    expect(result.statusCode).toBe(403);
  });
});

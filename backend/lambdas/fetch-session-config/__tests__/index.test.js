/**
 * Tests for fetch-session-config Lambda
 */

// Mock AWS SDK clients before requiring the handler
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockEnd = jest.fn();

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    query: mockQuery,
    end: mockEnd,
  })),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      SecretString: JSON.stringify({
        host: 'localhost',
        port: 5432,
        dbname: 'testdb',
        username: 'user',
        password: 'pass',
      }),
    }),
  })),
  GetSecretValueCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ Contents: [] }),
  })),
  ListObjectsV2Command: jest.fn(),
}));

process.env.DB_SECRET_NAME = 'test-secret';
process.env.S3_FHIR_BUCKET = 'test-fhir-bucket';

const { handler } = require('../index');

describe('fetch-session-config Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const makeEvent = (patientId, sub = 'user-sub-123') => ({
    httpMethod: 'GET',
    path: `/session-config/${patientId}`,
    pathParameters: { patientId },
    requestContext: {
      authorizer: {
        claims: { sub },
      },
    },
  });

  test('returns 401 when no auth claims', async () => {
    const event = {
      httpMethod: 'GET',
      path: '/session-config/patient-1',
      pathParameters: { patientId: 'patient-1' },
      requestContext: { authorizer: { claims: {} } },
    };

    const result = await handler(event);
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('Unauthorized');
  });

  test('returns 400 when no patientId', async () => {
    const event = {
      httpMethod: 'GET',
      path: '/session-config/',
      pathParameters: {},
      requestContext: { authorizer: { claims: { sub: 'user-123' } } },
    };

    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Patient ID required');
  });

  test('returns 404 when patient not found', async () => {
    // resolvePatientDbId: no UUID match, no patient_id match
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // UUID check
      .mockResolvedValueOnce({ rows: [] }); // patient_id check

    const result = await handler(makeEvent('00000000-0000-0000-0000-000000000000'));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toBe('Patient not found');
  });

  test('returns 403 when user has no access', async () => {
    const patientDbId = '11111111-1111-1111-1111-111111111111';

    mockQuery
      // resolvePatientDbId (UUID match)
      .mockResolvedValueOnce({ rows: [{ id: patientDbId, patient_id: 'CL-ABC123' }] })
      // checkPatientAccess: patient check
      .mockResolvedValueOnce({ rows: [] })
      // checkPatientAccess: caregiver check
      .mockResolvedValueOnce({ rows: [] });

    const result = await handler(makeEvent(patientDbId));
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error).toBe('Access denied');
  });

  test('returns 200 with full config when patient is the user', async () => {
    const patientDbId = '11111111-1111-1111-1111-111111111111';

    mockQuery
      // resolvePatientDbId (UUID match)
      .mockResolvedValueOnce({ rows: [{ id: patientDbId, patient_id: 'CL-ABC123' }] })
      // checkPatientAccess: patient check - found
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      // fetchPatientProfile
      .mockResolvedValueOnce({
        rows: [{
          patient_id: 'CL-ABC123',
          patient_name: 'Ramesh Kumar',
          language: 'hi',
          timezone: 'Asia/Kolkata',
        }],
      })
      // fetchParameterConfigs
      .mockResolvedValueOnce({
        rows: [{
          id: 'param-1',
          name: 'blood_pressure',
          display_name: 'Blood Pressure',
          loinc_codes: ['8480-6', '8462-4'],
          unit: 'mmHg',
          frequency_days: 1,
          daily_deadline: '18:00',
          threshold_min: [90, 60],
          threshold_max: [140, 90],
          threshold_set_by: 'doctor',
        }],
      })
      // fetchTopics
      .mockResolvedValueOnce({
        rows: [{
          id: 'topic-1',
          name: 'medications',
          description: 'Current medications and recent changes',
          status: 'incomplete',
          collected_data: null,
          last_updated: null,
        }],
      })
      // fetchPrompts
      .mockResolvedValueOnce({
        rows: [
          { prompt_type: 'caregiver_config', system_prompt: 'Config prompt...' },
          { prompt_type: 'caregiver_onboarding', system_prompt: 'Onboarding prompt...' },
          { prompt_type: 'patient_logging', system_prompt: 'Logging prompt...' },
        ],
      })
      // fetchRecommendations
      .mockResolvedValueOnce({
        rows: [{
          id: 'rec-1',
          source: 'doctor',
          parameter_name: 'blood_glucose_fasting',
          rationale: 'Patient is diabetic',
          status: 'pending',
        }],
      })
      // fetchLastSessionSummary
      .mockResolvedValueOnce({
        rows: [{
          date: '2026-04-24T09:30:00Z',
          confirmed_values: ['blood_pressure: 128/82'],
          status: 'complete',
        }],
      });

    const result = await handler(makeEvent(patientDbId));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.patient_id).toBe(patientDbId);
    expect(body.patient_name).toBe('Ramesh Kumar');
    expect(body.language).toBe('hi');
    expect(body.timezone).toBe('Asia/Kolkata');
    expect(body.parameters).toHaveLength(1);
    expect(body.parameters[0].name).toBe('blood_pressure');
    expect(body.topics).toHaveLength(1);
    expect(body.prompts.patient_logging).toBe('Logging prompt...');
    expect(body.prompts.caregiver_config).toBe('Config prompt...');
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].source).toBe('doctor');
    expect(body.last_session_summary).not.toBeNull();
    expect(body.last_session_summary.status).toBe('complete');
  });

  test('returns 200 with empty configs when patient has no data', async () => {
    const patientDbId = '22222222-2222-2222-2222-222222222222';

    mockQuery
      // resolvePatientDbId
      .mockResolvedValueOnce({ rows: [{ id: patientDbId, patient_id: 'CL-XYZ789' }] })
      // checkPatientAccess: patient check - found
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      // fetchPatientProfile
      .mockResolvedValueOnce({
        rows: [{
          patient_id: 'CL-XYZ789',
          patient_name: 'Test Patient',
          language: 'en',
          timezone: 'Asia/Kolkata',
        }],
      })
      // fetchParameterConfigs
      .mockResolvedValueOnce({ rows: [] })
      // fetchTopics
      .mockResolvedValueOnce({ rows: [] })
      // fetchPrompts
      .mockResolvedValueOnce({ rows: [] })
      // fetchRecommendations
      .mockResolvedValueOnce({ rows: [] })
      // fetchLastSessionSummary
      .mockResolvedValueOnce({ rows: [] });

    const result = await handler(makeEvent(patientDbId));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.parameters).toEqual([]);
    expect(body.topics).toEqual([]);
    expect(body.prompts).toEqual({});
    expect(body.recommendations).toEqual([]);
    expect(body.last_session_summary).toBeNull();
  });

  test('returns CORS headers', async () => {
    const event = makeEvent('nonexistent');
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await handler(event);
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers['Content-Type']).toBe('application/json');
  });
});

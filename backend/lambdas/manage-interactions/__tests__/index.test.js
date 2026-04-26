/**
 * Tests for manage-interactions Lambda
 */

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockEnd = jest.fn();
const mockS3Send = jest.fn();
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

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockS3Send,
  })),
  GetObjectCommand: jest.fn(),
}));

process.env.DB_SECRET_NAME = 'test-secret';
process.env.S3_RAW_BUCKET = 'test-raw-bucket';

const { Client } = require('pg');
const { handler } = require('../index');

const mockDbCredentials = {
  host: 'localhost',
  port: 5432,
  dbname: 'testdb',
  username: 'user',
  password: 'pass',
};

describe('manage-interactions Lambda', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    Client.mockImplementation(() => ({
      connect: mockConnect,
      query: mockQuery,
      end: mockEnd,
    }));
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(mockDbCredentials) });
  });

  const makeEvent = (patientId, extra = {}) => ({
    httpMethod: 'GET',
    path: extra.path || `/patients/${patientId}/interactions`,
    pathParameters: { patientId, ...extra.pathParams },
    requestContext: {
      authorizer: {
        claims: { sub: extra.sub || 'user-sub-123' },
      },
    },
    queryStringParameters: extra.query || null,
  });

  const setupPatientResolve = (patientDbId = 'patient-db-uuid') => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: patientDbId, patient_id: 'CL-123456' }],
    });
  };

  const setupAccessCheck = (linked = true) => {
    // user lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'user-db-id' }],
    });
    // persona_links check
    mockQuery.mockResolvedValueOnce({
      rows: linked ? [{ '?column?': 1 }] : [],
    });
  };

  test('returns 401 when no auth claims', async () => {
    const event = makeEvent('patient-1');
    event.requestContext.authorizer.claims = {};

    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  test('returns 404 when patient not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await handler(makeEvent('nonexistent'));
    expect(result.statusCode).toBe(404);
  });

  test('GET returns paginated list of interactions', async () => {
    setupPatientResolve();
    setupAccessCheck();

    // list query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'session-1',
          session_type: 'patient_logging',
          language: 'en',
          status: 'completed',
          turn_count: 5,
          duration_ms: 120000,
          extracted_summary: { values: [] },
          started_at: '2026-04-20T10:00:00Z',
          ended_at: '2026-04-20T10:02:00Z',
        },
      ],
    });

    // count query
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: '1' }],
    });

    const result = await handler(makeEvent('patient-db-uuid', {
      query: { limit: '10', offset: '0' },
    }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.interactions).toHaveLength(1);
    expect(body.pagination.total).toBe(1);
    expect(body.pagination.limit).toBe(10);
    expect(body.pagination.offset).toBe(0);
  });

  test('GET uses default pagination values', async () => {
    setupPatientResolve();
    setupAccessCheck();

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const result = await handler(makeEvent('patient-db-uuid'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.pagination.limit).toBe(20);
    expect(body.pagination.offset).toBe(0);
  });

  test('GET transcript fetches from S3', async () => {
    setupPatientResolve();
    setupAccessCheck();

    // interaction record
    mockQuery.mockResolvedValueOnce({
      rows: [{ transcript_s3_key: 'transcripts/patient-1/session-1.json' }],
    });

    // S3 response
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValue(JSON.stringify([
          { role: 'assistant', content: 'Hello' },
          { role: 'user', content: 'Hi' },
        ])),
      },
    });

    const result = await handler(makeEvent('patient-db-uuid', {
      path: '/patients/patient-db-uuid/interactions/session-1/transcript',
      pathParams: { interactionId: 'session-1' },
    }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.transcript).toHaveLength(2);
  });

  test('GET transcript returns 404 when interaction not found', async () => {
    setupPatientResolve();
    setupAccessCheck();

    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await handler(makeEvent('patient-db-uuid', {
      path: '/patients/patient-db-uuid/interactions/nonexistent/transcript',
      pathParams: { interactionId: 'nonexistent' },
    }));

    expect(result.statusCode).toBe(404);
  });

  test('GET transcript returns 404 when no S3 key', async () => {
    setupPatientResolve();
    setupAccessCheck();

    mockQuery.mockResolvedValueOnce({
      rows: [{ transcript_s3_key: null }],
    });

    const result = await handler(makeEvent('patient-db-uuid', {
      path: '/patients/patient-db-uuid/interactions/session-1/transcript',
      pathParams: { interactionId: 'session-1' },
    }));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toContain('not available');
  });

  test('returns 403 when user has no access', async () => {
    setupPatientResolve();
    // user lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'random-user' }] });
    // not linked
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // not the patient
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await handler(makeEvent('patient-db-uuid'));
    expect(result.statusCode).toBe(403);
  });

  test('returns 405 for non-GET methods', async () => {
    setupPatientResolve();
    setupAccessCheck();

    const event = makeEvent('patient-db-uuid');
    event.httpMethod = 'POST';

    const result = await handler(event);
    expect(result.statusCode).toBe(405);
  });
});

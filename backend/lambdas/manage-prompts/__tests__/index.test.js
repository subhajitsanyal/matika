/**
 * Tests for manage-prompts Lambda
 */

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

process.env.DB_SECRET_NAME = 'test-secret';

const { handler } = require('../index');

describe('manage-prompts Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const makeEvent = (method, extra = {}) => ({
    httpMethod: method,
    path: extra.path || '/prompts',
    pathParameters: extra.pathParams || {},
    requestContext: {
      authorizer: {
        claims: { sub: extra.sub || 'user-sub-123' },
      },
    },
    body: extra.body ? JSON.stringify(extra.body) : null,
  });

  test('returns 401 when no auth claims', async () => {
    const event = makeEvent('GET');
    event.requestContext.authorizer.claims = {};

    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  test('GET returns all prompts grouped by type', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          prompt_type: 'caregiver_config',
          system_prompt: 'You are CareLog, helping a caregiver configure...',
          version: '1.0',
          updated_at: '2026-04-15T10:00:00Z',
        },
        {
          prompt_type: 'caregiver_onboarding',
          system_prompt: 'You are CareLog, helping a caregiver register...',
          version: '1.1',
          updated_at: '2026-04-18T10:00:00Z',
        },
        {
          prompt_type: 'patient_logging',
          system_prompt: 'You are CareLog, a compassionate health companion...',
          version: '1.2',
          updated_at: '2026-04-20T10:00:00Z',
        },
      ],
    });

    const result = await handler(makeEvent('GET'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.prompts).toBeDefined();
    expect(body.prompts.patient_logging.version).toBe('1.2');
    expect(body.prompts.caregiver_config.version).toBe('1.0');
    expect(body.prompts.caregiver_onboarding.version).toBe('1.1');
  });

  test('PUT updates prompt and bumps version when user is doctor', async () => {
    // isUserDoctor check
    mockQuery.mockResolvedValueOnce({
      rows: [{ persona_type: 'doctor' }],
    });

    // existing version check
    mockQuery.mockResolvedValueOnce({
      rows: [{ version: '1.2' }],
    });

    // UPDATE
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await handler(makeEvent('PUT', {
      pathParams: { promptType: 'patient_logging' },
      body: { system_prompt: 'Updated prompt text here' },
    }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.version).toBe('1.3');
    expect(body.prompt_type).toBe('patient_logging');
  });

  test('PUT returns 403 when user is not doctor', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ persona_type: 'attendant' }],
    });

    const result = await handler(makeEvent('PUT', {
      pathParams: { promptType: 'patient_logging' },
      body: { system_prompt: 'test' },
    }));

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error).toContain('Only doctors');
  });

  test('PUT returns 400 for invalid prompt type', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ persona_type: 'doctor' }],
    });

    const result = await handler(makeEvent('PUT', {
      pathParams: { promptType: 'invalid_type' },
      body: { system_prompt: 'test' },
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Invalid prompt type');
  });

  test('PUT returns 400 when system_prompt is missing', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ persona_type: 'doctor' }],
    });

    const result = await handler(makeEvent('PUT', {
      pathParams: { promptType: 'patient_logging' },
      body: {},
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('system_prompt');
  });

  test('PUT creates new prompt if it does not exist', async () => {
    // isUserDoctor
    mockQuery.mockResolvedValueOnce({
      rows: [{ persona_type: 'doctor' }],
    });

    // existing check - not found
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // INSERT
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await handler(makeEvent('PUT', {
      pathParams: { promptType: 'caregiver_config' },
      body: { system_prompt: 'Brand new prompt' },
    }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.version).toBe('1.0');
  });

  test('returns 405 for unsupported methods', async () => {
    const result = await handler(makeEvent('DELETE'));
    expect(result.statusCode).toBe(405);
  });
});

// All three external clients (pg, Bedrock, S3) are mocked at the module
// level. Each test resets the mocks and configures them for the scenario.

const mockPgQuery = jest.fn();
const mockBedrockSend = jest.fn();
const mockS3Send = jest.fn();
const mockSecretsSend = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: mockPgQuery,
    end: jest.fn(),
  })),
}));

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
    send: mockBedrockSend,
  })),
  InvokeModelCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockS3Send,
  })),
  ListObjectsV2Command: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: mockSecretsSend,
  })),
  GetSecretValueCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const validSecretResponse = {
  SecretString: JSON.stringify({
    host: 'rds.example.com',
    port: 5432,
    username: 'admin',
    password: 'pw',
    dbname: 'matika',
  }),
};

describe('health-check handler', () => {
  let handler: typeof import('../src/handler').handler;

  beforeEach(() => {
    jest.resetModules();
    mockPgQuery.mockReset();
    mockBedrockSend.mockReset();
    mockS3Send.mockReset();
    mockSecretsSend.mockReset();
    mockSecretsSend.mockResolvedValue(validSecretResponse);
    process.env.BEDROCK_HAIKU_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
    process.env.RAW_INTERACTIONS_BUCKET = 'matika-dev-raw-interactions';
    process.env.INFERENCE_PROFILE_REGION = 'ap-south-1';
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:ap-south-1:000000000000:secret:test';
    // Re-require the handler so module-load picks up fresh env vars and
    // resets the cold-start `isWarm` flag.
    handler = require('../src/handler').handler;
  });

  it('returns healthy/200 when all probes succeed', async () => {
    mockPgQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    mockBedrockSend.mockResolvedValue({});
    mockS3Send.mockResolvedValue({ Contents: [] });

    const result = await handler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('healthy');
    expect(body.checks).toEqual({
      rds: 'up',
      bedrock: 'up',
      bedrock_inference_region: 'ap-south-1',
      s3: 'up',
      lambda_warm: false, // first invocation since module reset
    });
    expect(body.errors).toBeUndefined();
  });

  it('reports lambda_warm=true on second invocation', async () => {
    mockPgQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    mockBedrockSend.mockResolvedValue({});
    mockS3Send.mockResolvedValue({ Contents: [] });

    await handler();
    const second = await handler();
    expect(JSON.parse(second.body).checks.lambda_warm).toBe(true);
  });

  it('returns degraded/503 when RDS probe fails', async () => {
    mockPgQuery.mockRejectedValue(new Error('connect ECONNREFUSED'));
    mockBedrockSend.mockResolvedValue({});
    mockS3Send.mockResolvedValue({ Contents: [] });

    const result = await handler();

    expect(result.statusCode).toBe(503);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('degraded');
    expect(body.checks.rds).toBe('down');
    expect(body.checks.bedrock).toBe('up');
    expect(body.checks.s3).toBe('up');
    expect(body.errors.rds).toContain('ECONNREFUSED');
  });

  it('returns degraded/503 when Bedrock probe fails', async () => {
    mockPgQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    mockBedrockSend.mockRejectedValue(new Error('AccessDeniedException'));
    mockS3Send.mockResolvedValue({ Contents: [] });

    const result = await handler();

    expect(result.statusCode).toBe(503);
    const body = JSON.parse(result.body);
    expect(body.checks.bedrock).toBe('down');
    expect(body.checks.bedrock_inference_region).toBeNull();
    expect(body.errors.bedrock).toContain('AccessDeniedException');
  });

  it('returns degraded/503 when S3 probe fails', async () => {
    mockPgQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    mockBedrockSend.mockResolvedValue({});
    mockS3Send.mockRejectedValue(new Error('NoSuchBucket'));

    const result = await handler();

    expect(result.statusCode).toBe(503);
    const body = JSON.parse(result.body);
    expect(body.checks.s3).toBe('down');
    expect(body.errors.s3).toContain('NoSuchBucket');
  });

  it('reports all three failures together', async () => {
    mockPgQuery.mockRejectedValue(new Error('rds boom'));
    mockBedrockSend.mockRejectedValue(new Error('bedrock boom'));
    mockS3Send.mockRejectedValue(new Error('s3 boom'));

    const result = await handler();

    expect(result.statusCode).toBe(503);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('degraded');
    expect(body.checks.rds).toBe('down');
    expect(body.checks.bedrock).toBe('down');
    expect(body.checks.s3).toBe('down');
    expect(Object.keys(body.errors).sort()).toEqual(['bedrock', 'rds', 's3']);
  });

  it('marks RDS probe down when DB_SECRET_ARN is missing', async () => {
    delete process.env.DB_SECRET_ARN;
    jest.resetModules();
    handler = require('../src/handler').handler;
    mockBedrockSend.mockResolvedValue({});
    mockS3Send.mockResolvedValue({ Contents: [] });

    const result = await handler();

    expect(result.statusCode).toBe(503);
    const body = JSON.parse(result.body);
    expect(body.checks.rds).toBe('down');
    expect(body.errors.rds).toContain('DB_SECRET_ARN');
    expect(mockSecretsSend).not.toHaveBeenCalled();
  });

  it('marks Bedrock probe down when BEDROCK_HAIKU_MODEL_ID is missing', async () => {
    delete process.env.BEDROCK_HAIKU_MODEL_ID;
    jest.resetModules();
    handler = require('../src/handler').handler;
    mockPgQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    mockS3Send.mockResolvedValue({ Contents: [] });

    const result = await handler();

    expect(result.statusCode).toBe(503);
    const body = JSON.parse(result.body);
    expect(body.checks.bedrock).toBe('down');
    expect(body.errors.bedrock).toContain('BEDROCK_HAIKU_MODEL_ID not set');
    expect(mockBedrockSend).not.toHaveBeenCalled();
  });

  it('produces a valid ISO timestamp', async () => {
    mockPgQuery.mockResolvedValue({ rows: [] });
    mockBedrockSend.mockResolvedValue({});
    mockS3Send.mockResolvedValue({ Contents: [] });
    const result = await handler();
    const body = JSON.parse(result.body);
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
  });
});

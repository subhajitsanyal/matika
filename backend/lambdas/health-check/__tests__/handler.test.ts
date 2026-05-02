import { handler } from '../src/handler';

describe('health-check handler (scaffold)', () => {
  it('returns a healthy stub with all check fields present', async () => {
    const result = await handler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('healthy');
    expect(body.checks).toEqual(
      expect.objectContaining({
        rds: expect.any(String),
        bedrock: expect.any(String),
        s3: expect.any(String),
        lambda_warm: expect.any(Boolean),
      }),
    );
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

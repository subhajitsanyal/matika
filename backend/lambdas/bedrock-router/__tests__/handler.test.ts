import { handler } from '../src/handler';

describe('bedrock-router handler (scaffold)', () => {
  it('returns a 200 stub response', async () => {
    const result = await handler({
      sessionId: 'test-session',
      patientId: 'test-patient',
      transcript: 'hello',
      language: 'en-IN',
      turnSequence: 1,
    });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.scaffold).toBe(true);
    expect(body.version).toBe('v2.0');
  });
});

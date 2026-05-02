import { handler } from '../src/handler';

describe('bedrock-vision handler (scaffold)', () => {
  it('returns a 200 stub response', async () => {
    const result = await handler({
      sessionId: 'test-session',
      patientId: 'test-patient',
      photoS3Key: 'interactions/test/2026/05/02/test-session/photos/uuid.jpg',
      expectedParameter: 'blood_glucose',
      expectedUnit: 'mg/dL',
    });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.scaffold).toBe(true);
  });
});

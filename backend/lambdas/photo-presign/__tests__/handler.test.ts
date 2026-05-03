import { handlePresign, HandlerError, HandlerDeps } from '../src/handler';

const FAKE_S3 = {} as unknown as HandlerDeps['s3'];

function buildDeps(presigner = jest.fn().mockResolvedValue('https://signed.example/abc')): HandlerDeps {
  return {
    s3: FAKE_S3,
    bucket: 'matika-dev-raw-interactions',
    presigner: presigner as unknown as HandlerDeps['presigner'],
    now: () => new Date(Date.UTC(2026, 4, 3, 12, 30, 0)), // 2026-05-03 12:30 UTC
  };
}

describe('handlePresign', () => {
  const validReq = {
    patientId: '11111111-2222-3333-4444-555555555555',
    sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  };

  it('builds a date-partitioned key and returns the signed URL', async () => {
    const presigner = jest.fn().mockResolvedValue('https://signed.example/upload');
    const deps = buildDeps(presigner);

    const result = await handlePresign(validReq, deps);

    expect(result.uploadUrl).toBe('https://signed.example/upload');
    expect(result.expiresIn).toBe(300);
    expect(result.s3Key).toMatch(
      /^interactions\/11111111-2222-3333-4444-555555555555\/2026\/05\/03\/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\/photos\/[0-9a-f-]+\.jpg$/,
    );
    expect(presigner).toHaveBeenCalledTimes(1);
  });

  it('uses image/jpeg when contentType is not provided', async () => {
    const presigner = jest.fn().mockResolvedValue('url');
    const deps = buildDeps(presigner);
    await handlePresign(validReq, deps);
    const command = presigner.mock.calls[0][1];
    expect(command.input.ContentType).toBe('image/jpeg');
    expect(command.input.Bucket).toBe('matika-dev-raw-interactions');
  });

  it('signs the URL with ServerSideEncryption=aws:kms (bucket policy requires it)', async () => {
    const presigner = jest.fn().mockResolvedValue('url');
    const deps = buildDeps(presigner);
    await handlePresign(validReq, deps);
    const command = presigner.mock.calls[0][1];
    expect(command.input.ServerSideEncryption).toBe('aws:kms');
  });

  it('returns requiredHeaders telling the client what to send on the PUT', async () => {
    const result = await handlePresign(validReq, buildDeps());
    expect(result.requiredHeaders).toEqual({
      'Content-Type': 'image/jpeg',
      'x-amz-server-side-encryption': 'aws:kms',
    });
  });

  it('requiredHeaders Content-Type follows the requested contentType', async () => {
    const result = await handlePresign({ ...validReq, contentType: 'image/png' }, buildDeps());
    expect(result.requiredHeaders['Content-Type']).toBe('image/png');
  });

  it('honors a supported override contentType', async () => {
    const presigner = jest.fn().mockResolvedValue('url');
    const deps = buildDeps(presigner);
    const result = await handlePresign({ ...validReq, contentType: 'image/png' }, deps);
    expect(result.s3Key).toMatch(/\.png$/);
    expect(presigner.mock.calls[0][1].input.ContentType).toBe('image/png');
  });

  it('rejects non-image contentType', async () => {
    await expect(
      handlePresign({ ...validReq, contentType: 'application/pdf' }, buildDeps()),
    ).rejects.toThrow(HandlerError);
  });

  it('rejects bare image/* without a known extension', async () => {
    await expect(
      handlePresign({ ...validReq, contentType: 'image/svg+xml' }, buildDeps()),
    ).rejects.toThrow(HandlerError);
  });

  it('rejects missing patientId', async () => {
    await expect(handlePresign({ ...validReq, patientId: '' }, buildDeps())).rejects.toThrow(
      'patientId is required',
    );
  });

  it('rejects non-UUID patientId', async () => {
    await expect(handlePresign({ ...validReq, patientId: 'not-a-uuid' }, buildDeps())).rejects.toThrow(
      'patientId is required and must be a UUID',
    );
  });

  it('rejects missing sessionId', async () => {
    await expect(handlePresign({ ...validReq, sessionId: '' }, buildDeps())).rejects.toThrow(
      'sessionId is required',
    );
  });

  it('rejects non-UUID sessionId', async () => {
    await expect(handlePresign({ ...validReq, sessionId: 'session1' }, buildDeps())).rejects.toThrow(
      'sessionId is required and must be a UUID',
    );
  });

  it('attaches HandlerError statusCode 400 on validation failures', async () => {
    expect.assertions(2);
    try {
      await handlePresign({ ...validReq, patientId: '' }, buildDeps());
    } catch (e) {
      expect(e).toBeInstanceOf(HandlerError);
      expect((e as HandlerError).statusCode).toBe(400);
    }
  });

  it('partitions keys by UTC date (not local) at month/day boundaries', async () => {
    const presigner = jest.fn().mockResolvedValue('url');
    const deps: HandlerDeps = {
      s3: FAKE_S3,
      bucket: 'b',
      presigner: presigner as unknown as HandlerDeps['presigner'],
      now: () => new Date(Date.UTC(2026, 11, 31, 23, 59, 59)), // Dec 31
    };
    const result = await handlePresign(validReq, deps);
    expect(result.s3Key).toContain('/2026/12/31/');
  });
});

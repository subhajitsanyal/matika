import { S3ObservationWriter, buildFhirObservation, ObservationWriteInput } from '../src/observation_writer';
import type { ExtractedValue } from '../src/parser';

const baseValue: ExtractedValue = {
  parameter: 'blood_pressure_systolic',
  value: 130,
  unit: 'mmHg',
  loincCode: '8480-6',
  status: 'confirmed',
  confidence: 0.95,
};

const baseInput: ObservationWriteInput = {
  patientCognitoSub: '71438dca-9051-70e1-5baa-fa6fa0bded65',
  patientInternalId: 'ef322075-c930-4fef-b994-4c8c14635eb9',
  sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  value: baseValue,
  observedAt: new Date(Date.UTC(2026, 4, 3, 8, 30, 0)), // 2026-05-03 08:30 UTC
};

describe('buildFhirObservation', () => {
  it('produces a valid FHIR R4 Observation shape for a vital sign', () => {
    const obs = buildFhirObservation(baseInput, 'obs-test-id') as Record<string, unknown>;
    expect(obs.resourceType).toBe('Observation');
    expect(obs.id).toBe('obs-test-id');
    expect(obs.status).toBe('final');
    expect((obs.subject as Record<string, string>).reference).toBe(
      'Patient/71438dca-9051-70e1-5baa-fa6fa0bded65',
    );
  });

  it('encodes the LOINC code with the correct system + display', () => {
    const obs = buildFhirObservation(baseInput, 'obs-1') as { code: { coding: Array<{ system: string; code: string; display: string }> } };
    expect(obs.code.coding[0]).toEqual({
      system: 'http://loinc.org',
      code: '8480-6',
      display: 'Systolic Blood Pressure',
    });
  });

  it('falls back to the parameter name as display when LOINC has no mapping', () => {
    // body_temperature_f is a real ParameterName but its display is mapped
    // via 8310-5 (the °C entry shares the LOINC). Use a synthetic LOINC
    // that's not in DISPLAY_BY_LOINC to force the fallback.
    const obs = buildFhirObservation(
      { ...baseInput, value: { ...baseValue, loincCode: '99999-9' } },
      'obs-2',
    ) as { code: { coding: Array<{ display: string }> } };
    expect(obs.code.coding[0].display).toBe('blood_pressure_systolic'); // falls back to parameter
  });

  it('translates UCUM-friendly units in valueQuantity.code', () => {
    const obs = buildFhirObservation(baseInput, 'obs-3') as { valueQuantity: { unit: string; code: string; value: number } };
    expect(obs.valueQuantity.unit).toBe('mmHg'); // human display
    expect(obs.valueQuantity.code).toBe('mm[Hg]'); // UCUM
    expect(obs.valueQuantity.value).toBe(130);
  });

  it('tags the observation with the source session URN + internal patient id', () => {
    const obs = buildFhirObservation(baseInput, 'obs-4') as {
      meta: { source: string; tag: Array<{ system: string; code: string }> };
    };
    expect(obs.meta.source).toBe('urn:matika:session:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(obs.meta.tag[0]).toEqual({
      system: 'urn:matika:patient-internal-id',
      code: 'ef322075-c930-4fef-b994-4c8c14635eb9',
    });
  });

  it('classifies as vital-signs in the FHIR category coding', () => {
    const obs = buildFhirObservation(baseInput, 'obs-5') as {
      category: Array<{ coding: Array<{ code: string }> }>;
    };
    expect(obs.category[0].coding[0].code).toBe('vital-signs');
  });

  it('emits effectiveDateTime and issued in ISO8601 from observedAt', () => {
    const obs = buildFhirObservation(baseInput, 'obs-6') as { effectiveDateTime: string; issued: string };
    expect(obs.effectiveDateTime).toBe('2026-05-03T08:30:00.000Z');
    expect(obs.issued).toBe('2026-05-03T08:30:00.000Z');
  });
});

describe('S3ObservationWriter.write', () => {
  it('partitions the S3 key by patient + UTC date + observation id', async () => {
    const sends: unknown[] = [];
    const fakeS3 = {
      send: async (cmd: unknown) => {
        sends.push(cmd);
        return {};
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new S3ObservationWriter(fakeS3 as any, 'matika-dev-documents', 'kms-key-id');
    const { s3Key, observationId } = await writer.write(baseInput);

    expect(s3Key).toMatch(
      /^observations\/71438dca-9051-70e1-5baa-fa6fa0bded65\/2026\/05\/03\/obs-aaaaaaaa-[0-9a-f]{8}\.json$/,
    );
    expect(observationId).toMatch(/^obs-aaaaaaaa-/);
    expect(sends).toHaveLength(1);
  });

  it('writes with SSE-KMS encryption when a key is provided', async () => {
    const sends: Array<{ input?: Record<string, unknown> }> = [];
    const fakeS3 = {
      send: async (cmd: { input?: Record<string, unknown> }) => {
        sends.push(cmd);
        return {};
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new S3ObservationWriter(fakeS3 as any, 'b', 'arn:aws:kms:...:key/abc');
    await writer.write(baseInput);
    const input = sends[0].input as Record<string, unknown>;
    expect(input.ServerSideEncryption).toBe('aws:kms');
    expect(input.SSEKMSKeyId).toBe('arn:aws:kms:...:key/abc');
    expect(input.ContentType).toBe('application/fhir+json');
    expect(input.Bucket).toBe('b');
  });

  it('omits SSEKMSKeyId when no key is provided (bucket default still applies)', async () => {
    const sends: Array<{ input?: Record<string, unknown> }> = [];
    const fakeS3 = {
      send: async (cmd: { input?: Record<string, unknown> }) => {
        sends.push(cmd);
        return {};
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new S3ObservationWriter(fakeS3 as any, 'b', undefined);
    await writer.write(baseInput);
    const input = sends[0].input as Record<string, unknown>;
    expect(input.ServerSideEncryption).toBe('aws:kms');
    expect('SSEKMSKeyId' in input).toBe(false);
  });

  it('serializes the FHIR JSON in the request body', async () => {
    const sends: Array<{ input?: Record<string, unknown> }> = [];
    const fakeS3 = {
      send: async (cmd: { input?: Record<string, unknown> }) => {
        sends.push(cmd);
        return {};
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = new S3ObservationWriter(fakeS3 as any, 'b', 'k');
    await writer.write(baseInput);
    const body = (sends[0].input as Record<string, unknown>).Body as string;
    const parsed = JSON.parse(body);
    expect(parsed.resourceType).toBe('Observation');
    expect(parsed.valueQuantity.value).toBe(130);
  });
});

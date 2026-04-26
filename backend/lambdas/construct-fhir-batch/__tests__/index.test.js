/**
 * Tests for construct-fhir-batch Lambda
 */

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockEnd = jest.fn();
const mockS3Send = jest.fn().mockResolvedValue({});
const mockLambdaSend = jest.fn().mockResolvedValue({});

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
    send: mockS3Send,
  })),
  PutObjectCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({
    send: mockLambdaSend,
  })),
  InvokeCommand: jest.fn().mockImplementation((params) => params),
}));

process.env.DB_SECRET_NAME = 'test-secret';
process.env.S3_FHIR_BUCKET = 'test-fhir-bucket';
process.env.EVALUATE_THRESHOLDS_FUNCTION_NAME = 'carelog-dev-evaluate-thresholds-batch';

const { handler, _constructFhirObservation, _generateObservationS3Key, _LOINC_TO_UCUM } = require('../index');

describe('construct-fhir-batch Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const makeEvent = (body, sub = 'user-sub-123') => ({
    httpMethod: 'POST',
    path: '/observations/batch',
    requestContext: {
      authorizer: {
        claims: { sub },
      },
    },
    body: JSON.stringify(body),
  });

  describe('FHIR Observation construction', () => {
    test('constructs valid FHIR R4 Observation for blood pressure systolic', () => {
      const obs = _constructFhirObservation({
        observationId: 'obs-123',
        patientId: 'patient-456',
        recordedBy: 'user-789',
        recordedAt: '2026-04-25T09:03:00Z',
        loincCode: '8480-6',
        parameterName: 'blood_pressure_systolic',
        value: 130,
        unit: 'mmHg',
      });

      expect(obs.resourceType).toBe('Observation');
      expect(obs.id).toBe('obs-123');
      expect(obs.status).toBe('final');
      expect(obs.category[0].coding[0].code).toBe('vital-signs');
      expect(obs.category[0].coding[0].system).toBe(
        'http://terminology.hl7.org/CodeSystem/observation-category'
      );
      expect(obs.code.coding[0].system).toBe('http://loinc.org');
      expect(obs.code.coding[0].code).toBe('8480-6');
      expect(obs.code.coding[0].display).toBe('Systolic blood pressure');
      expect(obs.subject.reference).toBe('Patient/patient-456');
      expect(obs.effectiveDateTime).toBe('2026-04-25T09:03:00Z');
      expect(obs.valueQuantity.value).toBe(130);
      expect(obs.valueQuantity.unit).toBe('mmHg');
      expect(obs.valueQuantity.system).toBe('http://unitsofmeasure.org');
      expect(obs.valueQuantity.code).toBe('mm[Hg]');
      expect(obs.performer[0].reference).toBe('Practitioner/user-789');
      expect(obs.meta.source).toBe('carelog-conversation');
      expect(obs.meta.lastUpdated).toBeDefined();
    });

    test('constructs valid FHIR Observation for glucose', () => {
      const obs = _constructFhirObservation({
        observationId: 'obs-glucose',
        patientId: 'p-1',
        recordedBy: 'u-1',
        recordedAt: '2026-04-25T10:00:00Z',
        loincCode: '2339-0',
        parameterName: 'blood_glucose',
        value: 140,
        unit: 'mg/dL',
      });

      expect(obs.code.coding[0].code).toBe('2339-0');
      expect(obs.valueQuantity.value).toBe(140);
      expect(obs.valueQuantity.code).toBe('mg/dL');
    });

    test('constructs valid FHIR Observation for SpO2', () => {
      const obs = _constructFhirObservation({
        observationId: 'obs-spo2',
        patientId: 'p-1',
        recordedBy: 'u-1',
        recordedAt: '2026-04-25T10:00:00Z',
        loincCode: '2708-6',
        parameterName: 'spo2',
        value: 97,
        unit: '%',
      });

      expect(obs.code.coding[0].code).toBe('2708-6');
      expect(obs.valueQuantity.value).toBe(97);
      expect(obs.valueQuantity.code).toBe('%');
    });

    test('constructs valid FHIR Observation for heart rate', () => {
      const obs = _constructFhirObservation({
        observationId: 'obs-hr',
        patientId: 'p-1',
        recordedBy: 'u-1',
        recordedAt: '2026-04-25T10:00:00Z',
        loincCode: '8867-4',
        parameterName: 'heart_rate',
        value: 72,
        unit: '/min',
      });

      expect(obs.code.coding[0].code).toBe('8867-4');
      expect(obs.valueQuantity.code).toBe('/min');
    });

    test('handles unknown LOINC code gracefully', () => {
      const obs = _constructFhirObservation({
        observationId: 'obs-unknown',
        patientId: 'p-1',
        recordedBy: 'u-1',
        recordedAt: '2026-04-25T10:00:00Z',
        loincCode: '99999-9',
        parameterName: 'custom_parameter',
        value: 42,
        unit: 'custom_unit',
      });

      expect(obs.code.coding[0].code).toBe('99999-9');
      expect(obs.code.coding[0].display).toBe('custom_parameter');
      expect(obs.valueQuantity.unit).toBe('custom_unit');
      expect(obs.valueQuantity.code).toBe('custom_unit');
    });
  });

  describe('S3 key generation', () => {
    test('generates correct S3 key for observation', () => {
      const key = _generateObservationS3Key(
        'patient-123',
        'obs-456',
        '2026-04-25T09:03:00Z'
      );
      expect(key).toBe('observations/patient-123/2026/04/25/obs-456.json');
    });

    test('handles different dates correctly', () => {
      const key = _generateObservationS3Key(
        'p-1',
        'obs-1',
        '2026-01-05T23:59:59Z'
      );
      expect(key).toBe('observations/p-1/2026/01/05/obs-1.json');
    });

    test('zero-pads month and day', () => {
      const key = _generateObservationS3Key(
        'p-1',
        'obs-1',
        '2026-03-09T12:00:00Z'
      );
      expect(key).toBe('observations/p-1/2026/03/09/obs-1.json');
    });
  });

  describe('LOINC to UCUM mapping', () => {
    test('contains all required vital mappings', () => {
      expect(_LOINC_TO_UCUM['8480-6'].ucum).toBe('mm[Hg]');
      expect(_LOINC_TO_UCUM['8462-4'].ucum).toBe('mm[Hg]');
      expect(_LOINC_TO_UCUM['2339-0'].ucum).toBe('mg/dL');
      expect(_LOINC_TO_UCUM['8310-5'].ucum).toBe('Cel');
      expect(_LOINC_TO_UCUM['2708-6'].ucum).toBe('%');
      expect(_LOINC_TO_UCUM['8867-4'].ucum).toBe('/min');
      expect(_LOINC_TO_UCUM['29463-7'].ucum).toBe('kg');
    });
  });

  describe('handler', () => {
    test('returns 401 when no auth claims', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/observations/batch',
        requestContext: { authorizer: { claims: {} } },
        body: '{}',
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    test('returns 400 when patient_id is missing', async () => {
      const event = makeEvent({ values: [{ loinc_code: '8480-6', value: 130 }] });

      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('patient_id');
    });

    test('returns 400 when values array is empty', async () => {
      const event = makeEvent({ patient_id: 'p-1', values: [] });

      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('values');
    });

    test('returns 400 when values is missing', async () => {
      const event = makeEvent({ patient_id: 'p-1' });

      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    test('returns 201 with observation IDs and S3 keys on success', async () => {
      const patientId = '11111111-1111-1111-1111-111111111111';

      mockQuery
        // checkPatientAccess: patient check - found
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
        // getUserId for audit log
        .mockResolvedValueOnce({ rows: [{ id: 'user-db-id' }] })
        // audit log insert
        .mockResolvedValueOnce({ rows: [] });

      const event = makeEvent({
        patient_id: patientId,
        session_id: 'sess-1',
        recorded_by: 'user-789',
        recorded_at: '2026-04-25T09:03:00Z',
        values: [
          { parameter: 'blood_pressure_systolic', loinc_code: '8480-6', value: 130, unit: 'mmHg' },
          { parameter: 'blood_pressure_diastolic', loinc_code: '8462-4', value: 85, unit: 'mmHg' },
          { parameter: 'blood_glucose', loinc_code: '2339-0', value: 140, unit: 'mg/dL' },
        ],
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.observations_created).toBe(3);
      expect(body.observation_ids).toHaveLength(3);
      expect(body.s3_keys).toHaveLength(3);

      // Verify S3 keys follow the spec pattern
      body.s3_keys.forEach((key) => {
        expect(key).toMatch(
          /^observations\/[^/]+\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.json$/
        );
      });

      // Verify S3 uploads were called
      expect(mockS3Send).toHaveBeenCalledTimes(3);

      // Verify async Lambda invocation was triggered
      expect(mockLambdaSend).toHaveBeenCalledTimes(1);
      expect(body.threshold_evaluation).toBeDefined();
      expect(body.threshold_evaluation.status).toBe('triggered');
    });

    test('returns 403 when user has no access to patient', async () => {
      mockQuery
        // checkPatientAccess: patient check - not found
        .mockResolvedValueOnce({ rows: [] })
        // checkPatientAccess: caregiver check - not found
        .mockResolvedValueOnce({ rows: [] });

      const event = makeEvent({
        patient_id: 'patient-no-access',
        values: [{ loinc_code: '8480-6', value: 130 }],
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });

    test('skips values with missing loinc_code or value', async () => {
      const patientId = '11111111-1111-1111-1111-111111111111';

      mockQuery
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 'user-db-id' }] })
        .mockResolvedValueOnce({ rows: [] });

      const event = makeEvent({
        patient_id: patientId,
        recorded_at: '2026-04-25T09:03:00Z',
        values: [
          { parameter: 'bp_systolic', loinc_code: '8480-6', value: 130, unit: 'mmHg' },
          { parameter: 'missing_loinc', value: 100 }, // no loinc_code
          { parameter: 'missing_value', loinc_code: '2339-0' }, // no value
        ],
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.observations_created).toBe(1);
    });

    test('handles threshold evaluation Lambda failure gracefully', async () => {
      const patientId = '11111111-1111-1111-1111-111111111111';
      mockLambdaSend.mockRejectedValueOnce(new Error('Lambda invoke failed'));

      mockQuery
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 'user-db-id' }] })
        .mockResolvedValueOnce({ rows: [] });

      const event = makeEvent({
        patient_id: patientId,
        recorded_at: '2026-04-25T09:03:00Z',
        values: [
          { parameter: 'bp_systolic', loinc_code: '8480-6', value: 130, unit: 'mmHg' },
        ],
      });

      const result = await handler(event);
      // Should still succeed even if threshold Lambda fails
      expect(result.statusCode).toBe(201);

      const body = JSON.parse(result.body);
      expect(body.threshold_evaluation.status).toBe('failed');
    });
  });
});

/**
 * Tests for evaluate-thresholds-batch Lambda
 */

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockEnd = jest.fn();
const mockSqsSend = jest.fn();
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

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({
    send: mockSqsSend,
  })),
  SendMessageCommand: jest.fn().mockImplementation((params) => params),
}));

process.env.DB_SECRET_NAME = 'test-secret';
process.env.SQS_ALERT_QUEUE_URL = 'https://sqs.ap-south-1.amazonaws.com/123456789/test-alerts';

const { Client } = require('pg');
const { handler, _evaluateThreshold } = require('../index');

const mockDbCredentials = {
  host: 'localhost',
  port: 5432,
  dbname: 'testdb',
  username: 'user',
  password: 'pass',
};

describe('evaluate-thresholds-batch Lambda', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    Client.mockImplementation(() => ({
      connect: mockConnect,
      query: mockQuery,
      end: mockEnd,
    }));
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(mockDbCredentials) });
    mockSqsSend.mockResolvedValue({});
  });

  describe('evaluateThreshold', () => {
    test('detects high breach when value exceeds threshold_max', () => {
      const result = _evaluateThreshold(165, [null], [140]);
      expect(result.breached).toBe(true);
      expect(result.direction).toBe('high');
      expect(result.thresholdValue).toBe(140);
    });

    test('detects low breach when value is below threshold_min', () => {
      const result = _evaluateThreshold(80, [90], [null]);
      expect(result.breached).toBe(true);
      expect(result.direction).toBe('low');
      expect(result.thresholdValue).toBe(90);
    });

    test('returns no breach when value is within range', () => {
      const result = _evaluateThreshold(120, [90], [140]);
      expect(result.breached).toBe(false);
      expect(result.direction).toBeNull();
    });

    test('handles null threshold_min array', () => {
      const result = _evaluateThreshold(120, null, [140]);
      expect(result.breached).toBe(false);
    });

    test('handles null threshold_max array', () => {
      const result = _evaluateThreshold(120, [90], null);
      expect(result.breached).toBe(false);
    });

    test('handles multi-component thresholds (BP systolic/diastolic)', () => {
      // For systolic: max 140
      const systolicResult = _evaluateThreshold(165, [null], [140]);
      expect(systolicResult.breached).toBe(true);
      expect(systolicResult.direction).toBe('high');
    });

    test('handles empty threshold arrays', () => {
      const result = _evaluateThreshold(120, [], []);
      expect(result.breached).toBe(false);
    });

    test('handles threshold arrays with null elements', () => {
      const result = _evaluateThreshold(120, [null, null], [null, null]);
      expect(result.breached).toBe(false);
    });

    test('detects breach at exact boundary (value equals max)', () => {
      const result = _evaluateThreshold(140, [90], [140]);
      expect(result.breached).toBe(false); // Equal is not a breach
    });

    test('detects breach just above max', () => {
      const result = _evaluateThreshold(140.1, [90], [140]);
      expect(result.breached).toBe(true);
      expect(result.direction).toBe('high');
    });
  });

  describe('handler', () => {
    test('returns error for invalid payload (missing patient_id)', async () => {
      const result = await handler({ values: [{ value: 120 }] });
      expect(result.error).toBe('Invalid payload');
    });

    test('returns error for invalid payload (missing values)', async () => {
      const result = await handler({ patient_id: 'p-1' });
      expect(result.error).toBe('Invalid payload');
    });

    test('returns no breaches when no parameter_configs exist', async () => {
      mockQuery
        // parameter_configs query
        .mockResolvedValueOnce({ rows: [] });

      const result = await handler({
        patient_id: 'patient-1',
        session_id: 'session-1',
        values: [{ parameter: 'blood_pressure_systolic', value: 165, loinc_code: '8480-6' }],
      });

      expect(result.breaches_found).toBe(0);
      expect(result.message).toBe('No thresholds configured');
    });

    test('detects threshold breach and enqueues SQS message', async () => {
      mockQuery
        // parameter_configs query
        .mockResolvedValueOnce({
          rows: [{
            id: 'config-1',
            parameter_name: 'blood_pressure_systolic',
            loinc_codes: ['8480-6'],
            unit: 'mmHg',
            threshold_min: [90],
            threshold_max: [140],
          }],
        })
        // findLinkedCaregiver
        .mockResolvedValueOnce({
          rows: [{ linked_user_id: 'cg-1', cognito_sub: 'cg-sub-1', caregiver_name: 'Caregiver' }],
        })
        // patient name
        .mockResolvedValueOnce({ rows: [{ name: 'Ramesh' }] })
        // create alert record
        .mockResolvedValueOnce({ rows: [{ id: 'alert-1' }] })
        // audit log
        .mockResolvedValueOnce({ rows: [] });

      const result = await handler({
        patient_id: 'patient-1',
        session_id: 'session-1',
        values: [{ parameter: 'blood_pressure_systolic', value: 165, loinc_code: '8480-6' }],
      });

      expect(result.breaches_found).toBe(1);
      expect(result.breaches[0].parameter).toBe('blood_pressure_systolic');
      expect(result.breaches[0].value).toBe(165);
      expect(result.breaches[0].direction).toBe('high');
      expect(mockSqsSend).toHaveBeenCalledTimes(1);

      // Assert the alert INSERT matches the live RDS schema (V001):
      // recipient_user_id MUST be set (NOT NULL); columns are vital_value /
      // vital_unit / threshold_min / threshold_max — F11 regression guard.
      const insertCall = mockQuery.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.startsWith('INSERT INTO alerts')
      );
      expect(insertCall).toBeDefined();
      const [insertSql, insertParams] = insertCall;
      expect(insertSql).toMatch(/recipient_user_id/);
      expect(insertSql).toMatch(/vital_value/);
      expect(insertSql).toMatch(/vital_unit/);
      expect(insertSql).toMatch(/threshold_min/);
      expect(insertSql).toMatch(/threshold_max/);
      expect(insertSql).not.toMatch(/\bvalue\b(?!_)/);
      expect(insertParams).toEqual([
        'patient-1',           // patient_id
        'cg-1',                // recipient_user_id (caregiver's linked_user_id)
        'THRESHOLD_BREACH',    // alert_type
        'blood_pressure_systolic',
        165,                   // vital_value
        'mmHg',                // vital_unit
        null,                  // threshold_min — NULL on a high-side breach
        140,                   // threshold_max — populated on a high-side breach
        expect.stringContaining("Ramesh's blood pressure systolic is 165 mmHg -- above 140"),
      ]);
    });

    test('skips entirely when no caregiver is linked (alerts.recipient_user_id is NOT NULL)', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'config-1',
            parameter_name: 'blood_pressure_systolic',
            loinc_codes: ['8480-6'],
            unit: 'mmHg',
            threshold_min: [90],
            threshold_max: [140],
          }],
        })
        // findLinkedCaregiver — empty
        .mockResolvedValueOnce({ rows: [] });

      const result = await handler({
        patient_id: 'patient-1',
        values: [{ parameter: 'blood_pressure_systolic', value: 165, loinc_code: '8480-6' }],
      });

      expect(result.breaches_found).toBe(0);
      expect(result.message).toMatch(/No caregiver linked/);
      // No INSERT into alerts must have been attempted.
      const insertCall = mockQuery.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.startsWith('INSERT INTO alerts')
      );
      expect(insertCall).toBeUndefined();
      expect(mockSqsSend).not.toHaveBeenCalled();
    });

    test('no breach when values are within range', async () => {
      mockQuery
        // parameter_configs
        .mockResolvedValueOnce({
          rows: [{
            id: 'config-1',
            parameter_name: 'blood_pressure_systolic',
            loinc_codes: ['8480-6'],
            unit: 'mmHg',
            threshold_min: [90],
            threshold_max: [140],
          }],
        })
        // findLinkedCaregiver
        .mockResolvedValueOnce({
          rows: [{ linked_user_id: 'cg-1', cognito_sub: 'cg-sub-1', caregiver_name: 'Caregiver' }],
        })
        // patient name
        .mockResolvedValueOnce({ rows: [{ name: 'Ramesh' }] });

      const result = await handler({
        patient_id: 'patient-1',
        session_id: 'session-1',
        values: [{ parameter: 'blood_pressure_systolic', value: 120, loinc_code: '8480-6' }],
      });

      expect(result.breaches_found).toBe(0);
      expect(mockSqsSend).not.toHaveBeenCalled();
    });

    test('evaluates multiple values and detects partial breaches', async () => {
      mockQuery
        // parameter_configs
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'config-1',
              parameter_name: 'blood_pressure_systolic',
              loinc_codes: ['8480-6'],
              unit: 'mmHg',
              threshold_min: [90],
              threshold_max: [140],
            },
            {
              id: 'config-2',
              parameter_name: 'blood_glucose',
              loinc_codes: ['2339-0'],
              unit: 'mg/dL',
              threshold_min: [70],
              threshold_max: [200],
            },
          ],
        })
        // findLinkedCaregiver
        .mockResolvedValueOnce({
          rows: [{ linked_user_id: 'cg-1', cognito_sub: 'cg-sub-1', caregiver_name: 'Caregiver' }],
        })
        // patient name
        .mockResolvedValueOnce({ rows: [{ name: 'Ramesh' }] })
        // create alert for BP breach
        .mockResolvedValueOnce({ rows: [{ id: 'alert-1' }] })
        // audit log
        .mockResolvedValueOnce({ rows: [] });

      const result = await handler({
        patient_id: 'patient-1',
        session_id: 'session-1',
        values: [
          { parameter: 'blood_pressure_systolic', value: 165, loinc_code: '8480-6' },
          { parameter: 'blood_glucose', value: 140, loinc_code: '2339-0' },
        ],
      });

      // BP breaches (165 > 140), glucose is fine (140 < 200)
      expect(result.breaches_found).toBe(1);
      expect(result.values_evaluated).toBe(2);
      expect(result.breaches[0].parameter).toBe('blood_pressure_systolic');
    });

    test('skips values with no matching config', async () => {
      mockQuery
        // parameter_configs (no matching config for unknown parameter)
        .mockResolvedValueOnce({
          rows: [{
            id: 'config-1',
            parameter_name: 'blood_glucose',
            loinc_codes: ['2339-0'],
            unit: 'mg/dL',
            threshold_min: [70],
            threshold_max: [200],
          }],
        })
        // findLinkedCaregiver — populated so we don't early-exit on "no caregiver"
        .mockResolvedValueOnce({
          rows: [{ linked_user_id: 'cg-1', cognito_sub: 'cg-sub-1', caregiver_name: 'Caregiver' }],
        })
        // patient name
        .mockResolvedValueOnce({ rows: [{ name: 'Ramesh' }] });

      const result = await handler({
        patient_id: 'patient-1',
        values: [{ parameter: 'unknown_param', value: 999, loinc_code: '99999-9' }],
      });

      expect(result.breaches_found).toBe(0);
    });
  });
});

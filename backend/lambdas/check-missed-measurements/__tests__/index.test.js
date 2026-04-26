/**
 * Tests for check-missed-measurements Lambda
 */

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockEnd = jest.fn();
const mockSqsSend = jest.fn().mockResolvedValue({});

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

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({
    send: mockSqsSend,
  })),
  SendMessageCommand: jest.fn().mockImplementation((params) => params),
}));

process.env.DB_SECRET_NAME = 'test-secret';
process.env.SQS_ALERT_QUEUE_URL = 'https://sqs.ap-south-1.amazonaws.com/123456789/test-alerts';

const { handler, _calculateOverdue } = require('../index');

describe('check-missed-measurements Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateOverdue', () => {
    test('returns overdue when last logged is beyond frequency', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const result = _calculateOverdue(threeDaysAgo.toISOString(), 1);
      expect(result.overdue).toBe(true);
      expect(result.daysOverdue).toBeGreaterThanOrEqual(1);
    });

    test('returns not overdue when recently logged', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const result = _calculateOverdue(oneHourAgo.toISOString(), 1);
      expect(result.overdue).toBe(false);
      expect(result.daysOverdue).toBe(0);
    });

    test('returns overdue when never logged (null lastLoggedAt)', () => {
      const result = _calculateOverdue(null, 1);
      expect(result.overdue).toBe(true);
      expect(result.daysOverdue).toBe(1);
    });

    test('handles frequency_days of 3 correctly', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const result = _calculateOverdue(twoDaysAgo.toISOString(), 3);
      expect(result.overdue).toBe(false);
    });

    test('handles frequency_days of 3 when 4 days elapsed', () => {
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
      const result = _calculateOverdue(fourDaysAgo.toISOString(), 3);
      expect(result.overdue).toBe(true);
      expect(result.daysOverdue).toBeGreaterThanOrEqual(1);
    });

    test('returns overdue with correct days count for weekly frequency', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const result = _calculateOverdue(tenDaysAgo.toISOString(), 7);
      expect(result.overdue).toBe(true);
      expect(result.daysOverdue).toBeGreaterThanOrEqual(1);
    });

    test('not overdue when exactly at frequency boundary', () => {
      // Just under 24 hours for frequency_days=1
      const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);
      const result = _calculateOverdue(twentyThreeHoursAgo.toISOString(), 1);
      expect(result.overdue).toBe(false);
    });
  });

  describe('handler', () => {
    test('returns 0 alerts when no parameter configs exist', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] });

      const result = await handler({ source: 'aws.events' });
      expect(result.alerts_sent).toBe(0);
    });

    test('sends alert when measurement is overdue', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

      mockQuery
        // config query
        .mockResolvedValueOnce({
          rows: [{
            config_id: 'config-1',
            patient_id: 'patient-1',
            parameter_name: 'body_weight',
            display_name: 'Weight',
            loinc_codes: ['29463-7'],
            unit: 'kg',
            frequency_days: 1,
            user_id: 'user-1',
            patient_name: 'Ramesh',
          }],
        })
        // last session query - logged 3 days ago
        .mockResolvedValueOnce({ rows: [{ ended_at: threeDaysAgo }] })
        // recent alert check - none sent
        .mockResolvedValueOnce({ rows: [] })
        // find caregiver
        .mockResolvedValueOnce({
          rows: [{ linked_user_id: 'cg-1', cognito_sub: 'cg-sub-1', caregiver_name: 'Caregiver' }],
        })
        // create alert
        .mockResolvedValueOnce({ rows: [] });

      const result = await handler({ source: 'aws.events' });
      expect(result.alerts_sent).toBe(1);
      expect(mockSqsSend).toHaveBeenCalledTimes(1);
    });

    test('does not send alert when measurement is recent', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      mockQuery
        // config query
        .mockResolvedValueOnce({
          rows: [{
            config_id: 'config-1',
            patient_id: 'patient-1',
            parameter_name: 'blood_glucose',
            display_name: 'Blood Glucose',
            loinc_codes: ['2339-0'],
            unit: 'mg/dL',
            frequency_days: 1,
            user_id: 'user-1',
            patient_name: 'Ramesh',
          }],
        })
        // last session query - logged recently
        .mockResolvedValueOnce({ rows: [{ ended_at: oneHourAgo }] });

      const result = await handler({ source: 'aws.events' });
      expect(result.alerts_sent).toBe(0);
      expect(mockSqsSend).not.toHaveBeenCalled();
    });

    test('does not send duplicate alert within 24 hours', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

      mockQuery
        // config query
        .mockResolvedValueOnce({
          rows: [{
            config_id: 'config-1',
            patient_id: 'patient-1',
            parameter_name: 'body_weight',
            display_name: 'Weight',
            loinc_codes: ['29463-7'],
            unit: 'kg',
            frequency_days: 1,
            user_id: 'user-1',
            patient_name: 'Ramesh',
          }],
        })
        // last session - overdue
        .mockResolvedValueOnce({ rows: [{ ended_at: threeDaysAgo }] })
        // recent alert - already sent
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const result = await handler({ source: 'aws.events' });
      expect(result.alerts_sent).toBe(0);
      expect(mockSqsSend).not.toHaveBeenCalled();
    });

    test('sends alert when never logged (no session found)', async () => {
      mockQuery
        // config query
        .mockResolvedValueOnce({
          rows: [{
            config_id: 'config-1',
            patient_id: 'patient-1',
            parameter_name: 'blood_pressure_systolic',
            display_name: 'Blood Pressure (Systolic)',
            loinc_codes: ['8480-6'],
            unit: 'mmHg',
            frequency_days: 1,
            user_id: 'user-1',
            patient_name: 'Ramesh',
          }],
        })
        // last session - never logged
        .mockResolvedValueOnce({ rows: [] })
        // recent alert check - none
        .mockResolvedValueOnce({ rows: [] })
        // find caregiver
        .mockResolvedValueOnce({
          rows: [{ linked_user_id: 'cg-1', cognito_sub: 'cg-sub-1', caregiver_name: 'Caregiver' }],
        })
        // create alert
        .mockResolvedValueOnce({ rows: [] });

      const result = await handler({ source: 'aws.events' });
      expect(result.alerts_sent).toBe(1);
    });

    test('handles multiple parameters for different patients', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      mockQuery
        // config query
        .mockResolvedValueOnce({
          rows: [
            {
              config_id: 'config-1',
              patient_id: 'patient-1',
              parameter_name: 'body_weight',
              display_name: 'Weight',
              loinc_codes: ['29463-7'],
              unit: 'kg',
              frequency_days: 1,
              user_id: 'user-1',
              patient_name: 'Ramesh',
            },
            {
              config_id: 'config-2',
              patient_id: 'patient-2',
              parameter_name: 'blood_glucose',
              display_name: 'Blood Glucose',
              loinc_codes: ['2339-0'],
              unit: 'mg/dL',
              frequency_days: 1,
              user_id: 'user-2',
              patient_name: 'Sunita',
            },
          ],
        })
        // patient-1 weight: overdue
        .mockResolvedValueOnce({ rows: [{ ended_at: threeDaysAgo }] })
        // patient-1: no recent alert
        .mockResolvedValueOnce({ rows: [] })
        // patient-1: find caregiver
        .mockResolvedValueOnce({
          rows: [{ linked_user_id: 'cg-1', cognito_sub: 'cg-sub-1', caregiver_name: 'CG1' }],
        })
        // patient-1: create alert
        .mockResolvedValueOnce({ rows: [] })
        // patient-2 glucose: recent
        .mockResolvedValueOnce({ rows: [{ ended_at: oneHourAgo }] });

      const result = await handler({ source: 'aws.events' });
      expect(result.alerts_sent).toBe(1);
      expect(mockSqsSend).toHaveBeenCalledTimes(1);
    });
  });
});

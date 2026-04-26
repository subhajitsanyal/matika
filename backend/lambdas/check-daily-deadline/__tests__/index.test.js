/**
 * Tests for check-daily-deadline Lambda
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
const { handler, _getTodayInTimezone, _getCurrentTimeInTimezone, _hasDeadlinePassed } = require('../index');

const mockDbCredentials = {
  host: 'localhost',
  port: 5432,
  dbname: 'testdb',
  username: 'user',
  password: 'pass',
};

describe('check-daily-deadline Lambda', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    Client.mockImplementation(() => ({
      connect: mockConnect,
      query: mockQuery,
      end: mockEnd,
    }));
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(mockDbCredentials) });
    mockSqsSend.mockResolvedValue({});
    // Fix time to 19:00 IST (13:30 UTC) so deadline checks (10:00) are always past
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-25T13:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('hasDeadlinePassed', () => {
    test('returns true when current time is after deadline', () => {
      expect(_hasDeadlinePassed('19:30', '18:00')).toBe(true);
    });

    test('returns false when current time is before deadline', () => {
      expect(_hasDeadlinePassed('15:30', '18:00')).toBe(false);
    });

    test('returns true when current time equals deadline', () => {
      expect(_hasDeadlinePassed('18:00', '18:00')).toBe(true);
    });

    test('handles midnight boundary', () => {
      expect(_hasDeadlinePassed('23:59', '00:00')).toBe(true);
    });

    test('handles early morning deadline', () => {
      expect(_hasDeadlinePassed('06:00', '08:00')).toBe(false);
    });
  });

  describe('getTodayInTimezone', () => {
    test('returns a valid date string for Asia/Kolkata', () => {
      const today = _getTodayInTimezone('Asia/Kolkata');
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('returns a valid date string for UTC', () => {
      const today = _getTodayInTimezone('UTC');
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('getCurrentTimeInTimezone', () => {
    test('returns a valid time string for Asia/Kolkata', () => {
      const time = _getCurrentTimeInTimezone('Asia/Kolkata');
      expect(time).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  describe('handler', () => {
    test('returns 0 reminders when no parameter configs exist', async () => {
      mockQuery
        // config query
        .mockResolvedValueOnce({ rows: [] });

      const result = await handler({ source: 'aws.events' });
      expect(result.reminders_sent).toBe(0);
    });

    test('does not send reminder when session is complete for today', async () => {
      mockQuery
        // config query - patient with deadline that has passed
        .mockResolvedValueOnce({
          rows: [{
            patient_id: 'patient-1',
            earliest_deadline: '10:00:00',
            timezone: 'Asia/Kolkata',
            user_id: 'user-1',
            patient_name: 'Ramesh',
          }],
        })
        // session check - complete session exists
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const result = await handler({ source: 'aws.events' });
      expect(result.reminders_sent).toBe(0);
      expect(mockSqsSend).not.toHaveBeenCalled();
    });

    test('does not send duplicate reminder within 1 hour', async () => {
      mockQuery
        // config query
        .mockResolvedValueOnce({
          rows: [{
            patient_id: 'patient-1',
            earliest_deadline: '10:00:00',
            timezone: 'Asia/Kolkata',
            user_id: 'user-1',
            patient_name: 'Ramesh',
          }],
        })
        // session check - no complete session
        .mockResolvedValueOnce({ rows: [] })
        // recent reminder check - already sent
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const result = await handler({ source: 'aws.events' });
      expect(result.reminders_sent).toBe(0);
      expect(mockSqsSend).not.toHaveBeenCalled();
    });

    test('sends reminder when deadline passed, no session, and no recent reminder', async () => {
      mockQuery
        // config query
        .mockResolvedValueOnce({
          rows: [{
            patient_id: 'patient-1',
            earliest_deadline: '10:00:00',
            timezone: 'Asia/Kolkata',
            user_id: 'user-1',
            patient_name: 'Ramesh',
          }],
        })
        // session check - no complete session
        .mockResolvedValueOnce({ rows: [] })
        // recent reminder check - none
        .mockResolvedValueOnce({ rows: [] })
        // create alert record
        .mockResolvedValueOnce({ rows: [] });

      const result = await handler({ source: 'aws.events' });
      expect(result.reminders_sent).toBe(1);
      expect(mockSqsSend).toHaveBeenCalledTimes(1);
    });

    test('handles multiple patients correctly', async () => {
      mockQuery
        // config query - two patients
        .mockResolvedValueOnce({
          rows: [
            {
              patient_id: 'patient-1',
              earliest_deadline: '10:00:00',
              timezone: 'Asia/Kolkata',
              user_id: 'user-1',
              patient_name: 'Ramesh',
            },
            {
              patient_id: 'patient-2',
              earliest_deadline: '10:00:00',
              timezone: 'Asia/Kolkata',
              user_id: 'user-2',
              patient_name: 'Sunita',
            },
          ],
        })
        // patient-1: no session
        .mockResolvedValueOnce({ rows: [] })
        // patient-1: no recent reminder
        .mockResolvedValueOnce({ rows: [] })
        // patient-1: create alert
        .mockResolvedValueOnce({ rows: [] })
        // patient-2: has complete session
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const result = await handler({ source: 'aws.events' });
      // patient-1 gets reminder, patient-2 already done
      expect(result.reminders_sent).toBe(1);
      expect(mockSqsSend).toHaveBeenCalledTimes(1);
    });

    test('uses default timezone when none specified', async () => {
      mockQuery
        // config query with null timezone
        .mockResolvedValueOnce({
          rows: [{
            patient_id: 'patient-1',
            earliest_deadline: '10:00:00',
            timezone: null,
            user_id: 'user-1',
            patient_name: 'Ramesh',
          }],
        })
        // session check
        .mockResolvedValueOnce({ rows: [] })
        // recent reminder check
        .mockResolvedValueOnce({ rows: [] })
        // create alert
        .mockResolvedValueOnce({ rows: [] });

      const result = await handler({ source: 'aws.events' });
      expect(result.reminders_sent).toBe(1);
    });
  });
});

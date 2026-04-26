/**
 * Tests for notification-sender Lambda
 */

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockEnd = jest.fn();
const mockSnsSend = jest.fn();
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

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({
    send: mockSnsSend,
  })),
  PublishCommand: jest.fn().mockImplementation((params) => params),
}));

process.env.DB_SECRET_NAME = 'test-secret';
process.env.AWS_REGION = 'ap-south-1';

const { Client } = require('pg');
const { handler } = require('../index');

const mockDbCredentials = {
  host: 'localhost',
  port: 5432,
  dbname: 'testdb',
  username: 'user',
  password: 'pass',
};

describe('notification-sender Lambda', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    Client.mockImplementation(() => ({
      connect: mockConnect,
      query: mockQuery,
      end: mockEnd,
    }));
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(mockDbCredentials) });
    mockSnsSend.mockResolvedValue({});
  });

  describe('threshold_breach SQS message', () => {
    test('sends push notification for threshold breach', async () => {
      // getCaregiverDeviceEndpoints query
      mockQuery.mockResolvedValueOnce({
        rows: [{
          endpoint_arn: 'arn:aws:sns:ap-south-1:123:endpoint/GCM/app/device-1',
          platform: 'android',
          user_name: 'Caregiver',
          user_id: 'cg-1',
        }],
      });

      const event = {
        Records: [{
          body: JSON.stringify({
            type: 'threshold_breach',
            patient_id: 'patient-1',
            caregiver_id: 'cg-1',
            parameter: 'blood_pressure_systolic',
            display_name: 'Blood Pressure (Systolic)',
            value: 165,
            unit: 'mmHg',
            threshold_max: 140,
            threshold_min: null,
            patient_name: 'Ramesh',
            alert_id: 'alert-1',
          }),
        }],
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(mockSnsSend).toHaveBeenCalledTimes(1);
    });

    test('handles threshold breach with no caregiver devices', async () => {
      // getCaregiverDeviceEndpoints - no devices
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const event = {
        Records: [{
          body: JSON.stringify({
            type: 'threshold_breach',
            patient_id: 'patient-1',
            caregiver_id: null,
            parameter: 'blood_glucose',
            value: 300,
            unit: 'mg/dL',
            threshold_max: 200,
            patient_name: 'Ramesh',
            alert_id: 'alert-2',
          }),
        }],
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(mockSnsSend).not.toHaveBeenCalled();
    });
  });

  describe('missed_measurement SQS message', () => {
    test('sends push notification for missed measurement', async () => {
      // getCaregiverDeviceEndpoints query
      mockQuery.mockResolvedValueOnce({
        rows: [{
          endpoint_arn: 'arn:aws:sns:ap-south-1:123:endpoint/GCM/app/device-1',
          platform: 'android',
          user_name: 'Caregiver',
          user_id: 'cg-1',
        }],
      });

      const event = {
        Records: [{
          body: JSON.stringify({
            type: 'missed_measurement',
            patient_id: 'patient-1',
            caregiver_id: 'cg-1',
            parameter: 'body_weight',
            display_name: 'Weight',
            patient_name: 'Ramesh',
            days_overdue: 2,
            configured_frequency_days: 1,
          }),
        }],
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(mockSnsSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('reminder SQS message', () => {
    test('sends push notification for reminder', async () => {
      // getPatientDeviceEndpoints query
      mockQuery.mockResolvedValueOnce({
        rows: [{
          endpoint_arn: 'arn:aws:sns:ap-south-1:123:endpoint/GCM/app/patient-device',
          platform: 'android',
          cognito_sub: 'patient-sub-1',
        }],
      });

      const event = {
        Records: [{
          body: JSON.stringify({
            type: 'reminder',
            patient_id: 'patient-1',
            title: 'Health Check Reminder',
            body: "It's time to log your health readings. Tap to start.",
            action: 'open_conversation',
          }),
        }],
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(mockSnsSend).toHaveBeenCalledTimes(1);
    });

    test('handles reminder with no patient devices', async () => {
      // getPatientDeviceEndpoints - no devices
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const event = {
        Records: [{
          body: JSON.stringify({
            type: 'reminder',
            patient_id: 'patient-1',
          }),
        }],
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(mockSnsSend).not.toHaveBeenCalled();
    });
  });

  describe('malformed SQS records', () => {
    test('handles malformed JSON gracefully', async () => {
      const event = {
        Records: [{
          body: 'not valid json{{{',
        }],
      };

      await expect(handler(event)).rejects.toThrow();
    });

    test('handles unknown message type gracefully', async () => {
      const event = {
        Records: [{
          body: JSON.stringify({
            type: 'unknown_type',
            patient_id: 'patient-1',
          }),
        }],
      };

      // Should not throw, just log a warning
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(mockSnsSend).not.toHaveBeenCalled();
    });

    test('processes multiple SQS records', async () => {
      // First record: reminder -> getPatientDeviceEndpoints
      mockQuery.mockResolvedValueOnce({
        rows: [{
          endpoint_arn: 'arn:aws:sns:ap-south-1:123:endpoint/GCM/app/patient-device',
          platform: 'android',
          cognito_sub: 'patient-sub-1',
        }],
      });
      // Second record: missed_measurement -> getCaregiverDeviceEndpoints
      mockQuery.mockResolvedValueOnce({
        rows: [{
          endpoint_arn: 'arn:aws:sns:ap-south-1:123:endpoint/GCM/app/cg-device',
          platform: 'android',
          user_name: 'Caregiver',
          user_id: 'cg-1',
        }],
      });

      const event = {
        Records: [
          {
            body: JSON.stringify({
              type: 'reminder',
              patient_id: 'patient-1',
              title: 'Reminder',
              body: 'Log your readings',
            }),
          },
          {
            body: JSON.stringify({
              type: 'missed_measurement',
              patient_id: 'patient-1',
              caregiver_id: 'cg-1',
              parameter: 'blood_glucose',
              display_name: 'Blood Glucose',
              patient_name: 'Ramesh',
              days_overdue: 1,
              configured_frequency_days: 1,
            }),
          },
        ],
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(mockSnsSend).toHaveBeenCalledTimes(2);
    });
  });
});

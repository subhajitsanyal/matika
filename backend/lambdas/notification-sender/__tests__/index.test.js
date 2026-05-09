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
  PublishCommand: jest.fn().mockImplementation((params) => ({ ...params, __cmd: 'Publish' })),
  CreatePlatformEndpointCommand: jest
    .fn()
    .mockImplementation((params) => ({ ...params, __cmd: 'CreatePlatformEndpoint' })),
}));

process.env.DB_SECRET_NAME = 'test-secret';
process.env.AWS_REGION = 'ap-south-1';
// Push transport configured in tests so the SNS publish path is exercised.
// In real dev these env vars are unset and sendPushNotification short-circuits;
// see F15 follow-up.
process.env.IOS_PLATFORM_ARN = 'arn:aws:sns:ap-south-1:123:app/APNS/test';
process.env.ANDROID_PLATFORM_ARN = 'arn:aws:sns:ap-south-1:123:app/GCM/test';

// Each successful push results in 2 SNS calls: CreatePlatformEndpoint (returns
// { EndpointArn }) followed by Publish. Test-helper routes that through one
// mockSnsSend.mock that returns the endpoint ARN on the first call and
// {MessageId} on subsequent calls.
function mockPushDelivery() {
  mockSnsSend.mockResolvedValueOnce({ EndpointArn: 'arn:aws:sns:ap-south-1:123:endpoint/X/test/abc' });
  mockSnsSend.mockResolvedValueOnce({ MessageId: 'mid-1' });
}

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
      // getCaregiverDeviceEndpoints query — F15 schema: device_token, NOT endpoint_arn
      mockQuery.mockResolvedValueOnce({
        rows: [{
          device_token: 'fcm-test-token-1',
          platform: 'android',
          user_name: 'Caregiver',
          user_id: 'cg-1',
        }],
      });
      mockPushDelivery();
      // markAlertSent UPDATE
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

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
      // 1× CreatePlatformEndpoint + 1× Publish = 2 SNS calls
      expect(mockSnsSend).toHaveBeenCalledTimes(2);

      // F15 regression guard: the row-fetching query must NOT reference
      // the dropped endpoint_arn column or the wrong-type cognito_sub join.
      const endpointCall = mockQuery.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('FROM device_tokens')
      );
      expect(endpointCall).toBeDefined();
      expect(endpointCall[0]).toMatch(/dt\.device_token/);
      expect(endpointCall[0]).toMatch(/dt\.user_id = u\.id/);
      expect(endpointCall[0]).not.toMatch(/dt\.endpoint_arn/);
      expect(endpointCall[0]).not.toMatch(/dt\.user_id\s*=\s*u\.cognito_sub/);

      // markAlertSent flips is_sent + sent_at on success
      const markCall = mockQuery.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE alerts SET is_sent')
      );
      expect(markCall).toBeDefined();
      expect(markCall[1]).toEqual(['alert-1']);
    });

    test('handles threshold breach with no caregiver devices', async () => {
      // getCaregiverDeviceEndpoints - no devices
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // markAlertSent (failure path: send_error captured)
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

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

      // markAlertSent UPDATE captures the no-transport reason in send_error
      const errCall = mockQuery.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('SET send_error')
      );
      expect(errCall).toBeDefined();
      expect(errCall[1]).toEqual(['alert-2', 'no_transport_or_no_device_token']);
    });
  });

  describe('missed_measurement SQS message', () => {
    test('sends push notification for missed measurement', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          device_token: 'fcm-test-token-1',
          platform: 'android',
          user_name: 'Caregiver',
          user_id: 'cg-1',
        }],
      });
      mockPushDelivery();
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

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
            alert_id: 'alert-mm-1',
          }),
        }],
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(mockSnsSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('reminder SQS message', () => {
    test('sends push notification for reminder', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          device_token: 'fcm-patient-token',
          platform: 'android',
          user_id: 'patient-uuid-1',
        }],
      });
      mockPushDelivery();
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const event = {
        Records: [{
          body: JSON.stringify({
            type: 'reminder',
            patient_id: 'patient-1',
            title: 'Health Check Reminder',
            body: "It's time to log your health readings. Tap to start.",
            action: 'open_conversation',
            alert_id: 'alert-rem-1',
          }),
        }],
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(mockSnsSend).toHaveBeenCalledTimes(2);
    });

    test('handles reminder with no patient devices', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

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
        rows: [{ device_token: 'fcm-patient-token', platform: 'android', user_id: 'patient-uuid-1' }],
      });
      mockPushDelivery();                                  // CreateEndpoint + Publish
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });    // markAlertSent
      // Second record: missed_measurement -> getCaregiverDeviceEndpoints
      mockQuery.mockResolvedValueOnce({
        rows: [{ device_token: 'fcm-cg-token', platform: 'android', user_name: 'Caregiver', user_id: 'cg-1' }],
      });
      mockPushDelivery();
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const event = {
        Records: [
          {
            body: JSON.stringify({
              type: 'reminder',
              patient_id: 'patient-1',
              title: 'Reminder',
              body: 'Log your readings',
              alert_id: 'alert-rem-2',
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
              alert_id: 'alert-mm-2',
            }),
          },
        ],
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      // 2 records × (CreatePlatformEndpoint + Publish) = 4 SNS calls
      expect(mockSnsSend).toHaveBeenCalledTimes(4);
    });
  });
});

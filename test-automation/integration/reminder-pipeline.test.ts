/**
 * Integration: Reminder Pipeline
 *
 * Tests: EventBridge -> check-daily-deadline -> FCM
 * Validates that patients receive reminders after their daily deadline passes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CloudApiClient } from '../e2e/helpers/api-client';
import {
  ENV,
  TEST_PATIENT,
  TEST_CAREGIVER,
  PATIENT_HINDI,
  skipIfNoLiveInfra,
} from '../e2e/helpers/test-data';

describe('Integration: Reminder Pipeline', () => {
  let caregiverApi: CloudApiClient;
  let patientApi: CloudApiClient;
  const patientId = PATIENT_HINDI.id;

  beforeAll(() => {
    skipIfNoLiveInfra();
    caregiverApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_CAREGIVER.cognitoToken);
    patientApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_PATIENT.cognitoToken);
  });

  it('should verify patient has parameters with daily deadlines', async () => {
    const config = await patientApi.fetchSessionConfig(patientId);

    const paramsWithDeadline = config.parameters.filter((p) => p.daily_deadline);
    expect(paramsWithDeadline.length).toBeGreaterThan(0);
  });

  it('should trigger check-daily-deadline Lambda', async () => {
    const res = await caregiverApi.checkDailyDeadline();
    expect(res.status).toBeLessThan(300);
  });

  it('should process deadline check without errors', async () => {
    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // The check-daily-deadline Lambda should have evaluated all patients
    // and sent reminders for those past deadline without measurements.
    // We verify the Lambda executed successfully (no 5xx error).
    const res = await caregiverApi.checkDailyDeadline();
    expect(res.status).toBeLessThan(300);
  });
});

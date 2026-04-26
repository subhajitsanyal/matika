/**
 * E2E-03: Threshold Breach Alert
 *
 * Scenario: Patient logs BP 165/100 with threshold max 140/90 ->
 * FHIR batch -> threshold evaluation triggers -> Alert created ->
 * Caregiver notification enqueued
 *
 * Expected: Caregiver receives detailed push notification within 60s
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CloudApiClient } from '../helpers/api-client';
import {
  ENV,
  TEST_PATIENT,
  TEST_CAREGIVER,
  PATIENT_HINDI,
  FHIR_VALUES,
  skipIfNoLiveInfra,
  testSessionId,
} from '../helpers/test-data';

describe('E2E-03: Threshold Breach Alert', () => {
  let cloudApi: CloudApiClient;
  const patientId = PATIENT_HINDI.id;
  const sessionId = testSessionId();

  beforeAll(() => {
    skipIfNoLiveInfra();
    cloudApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_PATIENT.cognitoToken);
  });

  it('should submit BP values that breach the threshold (165/100 vs max 140/90)', async () => {
    const batchRes = await cloudApi.constructFhirBatch({
      patient_id: patientId,
      session_id: sessionId,
      recorded_by: TEST_PATIENT.userId,
      recorded_at: new Date().toISOString(),
      values: FHIR_VALUES.bp_high,
    });

    expect(batchRes.observations_created).toBe(2);
    expect(batchRes.s3_keys.length).toBe(2);

    // Threshold evaluation should be triggered
    expect(batchRes.threshold_evaluation).toBeDefined();
    expect(batchRes.threshold_evaluation.status).toBe('triggered');
    expect(batchRes.threshold_evaluation.alerts.length).toBeGreaterThan(0);

    const bpAlert = batchRes.threshold_evaluation.alerts.find(
      (a) => a.parameter === 'blood_pressure_systolic' || a.parameter.includes('blood_pressure'),
    );
    expect(bpAlert).toBeDefined();
    expect(bpAlert!.alert_type).toBe('threshold_breach');
  });

  it('should create an alert record in the database', async () => {
    // Wait briefly for async alert creation
    await new Promise((resolve) => setTimeout(resolve, 3000));

    cloudApi.setToken(TEST_CAREGIVER.cognitoToken);
    const alertsRes = await cloudApi.getAlerts(patientId);

    expect(alertsRes.alerts.length).toBeGreaterThan(0);

    const recentAlert = alertsRes.alerts.find(
      (a) => a.alert_type === 'threshold_breach' && a.parameter_name.includes('blood_pressure'),
    );
    expect(recentAlert).toBeDefined();
    expect(recentAlert!.patient_id).toBe(patientId);
  });

  it('should verify the alert was created within 60 seconds', async () => {
    cloudApi.setToken(TEST_CAREGIVER.cognitoToken);
    const alertsRes = await cloudApi.getAlerts(patientId);

    const recentAlert = alertsRes.alerts.find(
      (a) => a.alert_type === 'threshold_breach',
    );
    expect(recentAlert).toBeDefined();

    const alertTime = new Date(recentAlert!.created_at).getTime();
    const now = Date.now();
    const ageSeconds = (now - alertTime) / 1000;
    expect(ageSeconds).toBeLessThan(60);
  });
});

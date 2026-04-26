/**
 * Integration: Threshold Evaluation
 *
 * Tests: construct-fhir-batch -> evaluate-thresholds-batch -> SQS -> notification-sender
 * Validates that breaching values create alert records and enqueue notifications.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CloudApiClient } from '../e2e/helpers/api-client';
import {
  ENV,
  TEST_PATIENT,
  TEST_CAREGIVER,
  PATIENT_HINDI,
  FHIR_VALUES,
  skipIfNoLiveInfra,
  testSessionId,
} from '../e2e/helpers/test-data';

describe('Integration: Threshold Evaluation', () => {
  let patientApi: CloudApiClient;
  let caregiverApi: CloudApiClient;
  const patientId = PATIENT_HINDI.id;

  beforeAll(() => {
    skipIfNoLiveInfra();
    patientApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_PATIENT.cognitoToken);
    caregiverApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_CAREGIVER.cognitoToken);
  });

  it('should not trigger alert for normal BP values', async () => {
    const batchRes = await patientApi.constructFhirBatch({
      patient_id: patientId,
      session_id: testSessionId(),
      recorded_by: TEST_PATIENT.userId,
      recorded_at: new Date().toISOString(),
      values: FHIR_VALUES.bp_normal,
    });

    expect(batchRes.observations_created).toBe(2);

    // Normal values should not trigger threshold alerts
    const bpAlerts = batchRes.threshold_evaluation.alerts.filter(
      (a) => a.parameter.includes('blood_pressure'),
    );
    expect(bpAlerts.length).toBe(0);
  });

  it('should trigger alert for high BP values', async () => {
    const batchRes = await patientApi.constructFhirBatch({
      patient_id: patientId,
      session_id: testSessionId(),
      recorded_by: TEST_PATIENT.userId,
      recorded_at: new Date().toISOString(),
      values: FHIR_VALUES.bp_high,
    });

    expect(batchRes.threshold_evaluation.status).toBe('triggered');
    expect(batchRes.threshold_evaluation.alerts.length).toBeGreaterThan(0);
  });

  it('should trigger alert for high glucose values', async () => {
    const batchRes = await patientApi.constructFhirBatch({
      patient_id: patientId,
      session_id: testSessionId(),
      recorded_by: TEST_PATIENT.userId,
      recorded_at: new Date().toISOString(),
      values: FHIR_VALUES.glucose_high,
    });

    const glucoseAlert = batchRes.threshold_evaluation.alerts.find(
      (a) => a.parameter === 'blood_glucose',
    );
    expect(glucoseAlert).toBeDefined();
    expect(glucoseAlert!.value).toBe(300);
    expect(glucoseAlert!.alert_type).toBe('threshold_breach');
  });

  it('should trigger alert for low SpO2', async () => {
    const batchRes = await patientApi.constructFhirBatch({
      patient_id: patientId,
      session_id: testSessionId(),
      recorded_by: TEST_PATIENT.userId,
      recorded_at: new Date().toISOString(),
      values: FHIR_VALUES.spo2_low,
    });

    const spo2Alert = batchRes.threshold_evaluation.alerts.find(
      (a) => a.parameter === 'spo2',
    );
    expect(spo2Alert).toBeDefined();
    expect(spo2Alert!.value).toBe(88);
  });

  it('should create alert records accessible by caregiver', async () => {
    // Wait for async alert creation
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const alertsRes = await caregiverApi.getAlerts(patientId);
    expect(alertsRes.alerts.length).toBeGreaterThan(0);

    // Verify alert record structure
    const alert = alertsRes.alerts[0];
    expect(alert.id).toBeDefined();
    expect(alert.patient_id).toBe(patientId);
    expect(alert.alert_type).toBeDefined();
    expect(alert.created_at).toBeDefined();
  });
});

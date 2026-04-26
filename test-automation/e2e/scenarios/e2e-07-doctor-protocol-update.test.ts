/**
 * E2E-07: Doctor Protocol Update
 *
 * Scenario: Doctor updates BP threshold via web portal API ->
 * Fetch session config for patient -> Thresholds reflect doctor's update ->
 * Patient logs value: verify correct threshold evaluation
 *
 * Expected: Session uses doctor's thresholds; alert only if new threshold breached
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CloudApiClient } from '../helpers/api-client';
import {
  ENV,
  TEST_DOCTOR,
  TEST_PATIENT,
  TEST_CAREGIVER,
  PATIENT_HINDI,
  skipIfNoLiveInfra,
  testSessionId,
} from '../helpers/test-data';

describe('E2E-07: Doctor Protocol Update', () => {
  let doctorApi: CloudApiClient;
  let patientApi: CloudApiClient;
  let caregiverApi: CloudApiClient;
  const patientId = PATIENT_HINDI.id;

  beforeAll(() => {
    skipIfNoLiveInfra();
    doctorApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_DOCTOR.cognitoToken);
    patientApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_PATIENT.cognitoToken);
    caregiverApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_CAREGIVER.cognitoToken);
  });

  it('should update BP threshold as doctor (raise max to 160/95)', async () => {
    const res = await doctorApi.updateThreshold({
      patient_id: patientId,
      parameter_name: 'blood_pressure',
      threshold_max: [160, 95],
    });

    expect(res.status).toBeLessThan(300);
  });

  it('should verify session config reflects the new threshold', async () => {
    const config = await patientApi.fetchSessionConfig(patientId);

    const bpParam = config.parameters.find((p) => p.name === 'blood_pressure');
    expect(bpParam).toBeDefined();
    expect(bpParam!.threshold_max).toEqual([160, 95]);
    expect(bpParam!.threshold_set_by).toBe('doctor');
  });

  it('should NOT trigger alert for value above old threshold but below new (150/92)', async () => {
    const sessionId = testSessionId();
    const batchRes = await patientApi.constructFhirBatch({
      patient_id: patientId,
      session_id: sessionId,
      recorded_by: TEST_PATIENT.userId,
      recorded_at: new Date().toISOString(),
      values: [
        { parameter: 'blood_pressure_systolic', loinc_code: '8480-6', value: 150, unit: 'mmHg' },
        { parameter: 'blood_pressure_diastolic', loinc_code: '8462-4', value: 92, unit: 'mmHg' },
      ],
    });

    expect(batchRes.observations_created).toBe(2);

    // With new threshold max [160, 95], value 150/92 should NOT trigger
    if (batchRes.threshold_evaluation.alerts.length > 0) {
      const bpAlert = batchRes.threshold_evaluation.alerts.find(
        (a) => a.parameter.includes('blood_pressure'),
      );
      expect(bpAlert).toBeUndefined();
    }
  });

  it('should trigger alert for value above new threshold (165/100)', async () => {
    const sessionId = testSessionId();
    const batchRes = await patientApi.constructFhirBatch({
      patient_id: patientId,
      session_id: sessionId,
      recorded_by: TEST_PATIENT.userId,
      recorded_at: new Date().toISOString(),
      values: [
        { parameter: 'blood_pressure_systolic', loinc_code: '8480-6', value: 165, unit: 'mmHg' },
        { parameter: 'blood_pressure_diastolic', loinc_code: '8462-4', value: 100, unit: 'mmHg' },
      ],
    });

    expect(batchRes.threshold_evaluation.status).toBe('triggered');
    expect(batchRes.threshold_evaluation.alerts.length).toBeGreaterThan(0);
  });

  it('should restore original threshold after test', async () => {
    const res = await doctorApi.updateThreshold({
      patient_id: patientId,
      parameter_name: 'blood_pressure',
      threshold_max: [140, 90],
    });
    expect(res.status).toBeLessThan(300);
  });
});

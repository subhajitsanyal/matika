/**
 * Integration: Doctor Protocol Update
 *
 * Tests: Web portal -> API -> RDS -> fetch-session-config
 * Validates that a doctor's threshold change appears in the next session config.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CloudApiClient } from '../e2e/helpers/api-client';
import {
  ENV,
  TEST_DOCTOR,
  TEST_PATIENT,
  PATIENT_HINDI,
  skipIfNoLiveInfra,
} from '../e2e/helpers/test-data';

describe('Integration: Doctor Protocol Update', () => {
  let doctorApi: CloudApiClient;
  let patientApi: CloudApiClient;
  const patientId = PATIENT_HINDI.id;

  let originalThresholdMax: number[] | null = null;

  beforeAll(async () => {
    skipIfNoLiveInfra();
    doctorApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_DOCTOR.cognitoToken);
    patientApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_PATIENT.cognitoToken);

    // Save original threshold for restoration
    const config = await patientApi.fetchSessionConfig(patientId);
    const bpParam = config.parameters.find((p) => p.name === 'blood_pressure');
    originalThresholdMax = bpParam?.threshold_max ?? null;
  });

  afterAll(async () => {
    // Restore original threshold
    if (originalThresholdMax) {
      try {
        await doctorApi.updateThreshold({
          patient_id: patientId,
          parameter_name: 'blood_pressure',
          threshold_max: originalThresholdMax,
        });
      } catch { /* best effort */ }
    }
  });

  it('should read current threshold before doctor update', async () => {
    const config = await patientApi.fetchSessionConfig(patientId);
    const bpParam = config.parameters.find((p) => p.name === 'blood_pressure');

    expect(bpParam).toBeDefined();
    expect(bpParam!.threshold_max).toBeDefined();
  });

  it('should allow doctor to update threshold', async () => {
    const res = await doctorApi.updateThreshold({
      patient_id: patientId,
      parameter_name: 'blood_pressure',
      threshold_max: [150, 95],
    });

    expect(res.status).toBeLessThan(300);
  });

  it('should reflect updated threshold in session config', async () => {
    const config = await patientApi.fetchSessionConfig(patientId);
    const bpParam = config.parameters.find((p) => p.name === 'blood_pressure');

    expect(bpParam).toBeDefined();
    expect(bpParam!.threshold_max).toEqual([150, 95]);
    expect(bpParam!.threshold_set_by).toBe('doctor');
  });

  it('should allow doctor to also update threshold_min', async () => {
    const res = await doctorApi.updateThreshold({
      patient_id: patientId,
      parameter_name: 'blood_pressure',
      threshold_min: [85, 55],
      threshold_max: [150, 95],
    });

    expect(res.status).toBeLessThan(300);

    const config = await patientApi.fetchSessionConfig(patientId);
    const bpParam = config.parameters.find((p) => p.name === 'blood_pressure');

    expect(bpParam!.threshold_min).toEqual([85, 55]);
  });

  it('should create a recommendation alongside threshold update', async () => {
    const recRes = await doctorApi.createRecommendation({
      patient_id: patientId,
      parameter_name: 'blood_glucose_fasting',
      loinc_code: '1558-6',
      rationale: 'Patient is diabetic — recommend tracking fasting glucose separately',
      suggested_frequency_days: 1,
    });

    expect(recRes.status).toBeLessThan(300);

    // Verify recommendation appears in session config
    const config = await patientApi.fetchSessionConfig(patientId);
    const rec = config.recommendations?.find(
      (r) => r.parameter_name === 'blood_glucose_fasting',
    );
    expect(rec).toBeDefined();
    expect(rec!.source).toBe('doctor');
    expect(rec!.status).toBe('pending');
  });
});

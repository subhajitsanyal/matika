/**
 * E2E-02: Photo-Based Device Reading
 *
 * Scenario: Patient starts session -> Mentions BP but doesn't know value ->
 * Takes photo -> Vision extracts readings -> Patient confirms -> Session ends
 *
 * Expected: FHIR Observation with value from vision extraction
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CloudApiClient } from '../helpers/api-client';
import { MacMiniClient, LlmSessionCreateRequest } from '../helpers/mac-mini-client';
import {
  ENV,
  TEST_PATIENT,
  PATIENT_HINDI,
  PARAM_BLOOD_PRESSURE,
  ALL_TOPICS,
  SYSTEM_PROMPTS,
  placeholderJpeg,
  skipIfNoLiveInfra,
} from '../helpers/test-data';

describe('E2E-02: Photo-Based Device Reading', () => {
  let cloudApi: CloudApiClient;
  let macMini: MacMiniClient;
  let sessionId: string;
  const patientId = PATIENT_HINDI.id;

  beforeAll(() => {
    skipIfNoLiveInfra();
    cloudApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_PATIENT.cognitoToken);
    macMini = new MacMiniClient(ENV.MAC_MINI_HOST);
  });

  afterAll(async () => {
    if (sessionId) {
      try { await macMini.endSession(sessionId, 'user_stopped'); } catch { /* already ended */ }
    }
  });

  it('should create a patient logging session', async () => {
    const request: LlmSessionCreateRequest = {
      session_type: 'patient_logging',
      patient_id: patientId,
      language: 'hi',
      config: {
        parameters: [PARAM_BLOOD_PRESSURE],
        topics: ALL_TOPICS,
        system_prompt: SYSTEM_PROMPTS.patient_logging,
        patient_name: PATIENT_HINDI.name,
      },
    };

    const res = await macMini.createSession(request);
    sessionId = res.session_id;
    expect(res.state).toBe('active');
  });

  it('should handle patient mentioning BP without a value', async () => {
    const res = await macMini.sendUtterance(sessionId, {
      text: 'maine blood pressure check kiya lekin mujhe number yaad nahi',
      turn_number: 2,
    });

    // LLM should suggest taking a photo of the device
    expect(['suggest_photo', 'ask_parameter']).toContain(res.action);
  });

  it('should extract readings from a device photo via Vision service', async () => {
    const image = placeholderJpeg();
    const visionRes = await macMini.extractVision(image, 'blood_pressure_monitor');

    expect(visionRes.device_type).toBeDefined();
    expect(visionRes.confidence).toBeGreaterThan(0);
    expect(visionRes.readings.length).toBeGreaterThan(0);

    // Verify reading structure
    for (const reading of visionRes.readings) {
      expect(reading.label).toBeDefined();
      expect(typeof reading.value).toBe('number');
      expect(reading.unit).toBeDefined();
    }
  });

  it('should feed vision-extracted values back to LLM for confirmation', async () => {
    // Simulate the app sending vision-extracted values as text to LLM
    const res = await macMini.sendUtterance(sessionId, {
      text: 'photo mein 130 over 85 dikh raha hai',
      turn_number: 3,
    });

    expect(res.action).toBe('confirm_value');
    expect(res.extracted_values.length).toBeGreaterThanOrEqual(2);

    const systolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_systolic');
    expect(systolic).toBeDefined();
    expect(systolic!.value).toBe(130);
  });

  it('should confirm vision-extracted values', async () => {
    const res = await macMini.sendUtterance(sessionId, {
      text: 'haan sahi hai',
      turn_number: 4,
    });

    expect(res.session_state.confirmed_values.length).toBeGreaterThanOrEqual(2);
    const confirmedParams = res.session_state.confirmed_values.map((v) => v.parameter);
    expect(confirmedParams).toContain('blood_pressure_systolic');
    expect(confirmedParams).toContain('blood_pressure_diastolic');
  });

  it('should end session and create FHIR observation with vision-extracted value', async () => {
    const endRes = await macMini.endSession(sessionId, 'all_captured');
    expect(endRes.state).toBe('ended');

    // Create FHIR observation from confirmed values
    const batchRes = await cloudApi.constructFhirBatch({
      patient_id: patientId,
      session_id: sessionId,
      recorded_by: TEST_PATIENT.userId,
      recorded_at: new Date().toISOString(),
      values: [
        { parameter: 'blood_pressure_systolic', loinc_code: '8480-6', value: 130, unit: 'mmHg' },
        { parameter: 'blood_pressure_diastolic', loinc_code: '8462-4', value: 85, unit: 'mmHg' },
      ],
    });

    expect(batchRes.observations_created).toBe(2);
    expect(batchRes.s3_keys.length).toBe(2);
  });
});

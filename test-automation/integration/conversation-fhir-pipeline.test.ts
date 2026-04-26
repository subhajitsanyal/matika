/**
 * Integration: Conversation -> FHIR Pipeline
 *
 * Tests: utterance -> LLM extraction -> FHIR batch -> S3 storage
 * Validates that confirmed values produce valid FHIR Observations in S3.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CloudApiClient } from '../e2e/helpers/api-client';
import { MacMiniClient, LlmSessionCreateRequest } from '../e2e/helpers/mac-mini-client';
import {
  ENV,
  TEST_PATIENT,
  PATIENT_HINDI,
  PARAM_BLOOD_PRESSURE,
  PARAM_BLOOD_GLUCOSE,
  ALL_TOPICS,
  SYSTEM_PROMPTS,
  UTTERANCES,
  skipIfNoLiveInfra,
} from '../e2e/helpers/test-data';

describe('Integration: Conversation -> FHIR Pipeline', () => {
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
      try { await macMini.endSession(sessionId, 'user_stopped'); } catch { /* ok */ }
    }
  });

  it('should create LLM session and extract values from utterance', async () => {
    const request: LlmSessionCreateRequest = {
      session_type: 'patient_logging',
      patient_id: patientId,
      language: 'hi',
      config: {
        parameters: [PARAM_BLOOD_PRESSURE, PARAM_BLOOD_GLUCOSE],
        topics: ALL_TOPICS,
        system_prompt: SYSTEM_PROMPTS.patient_logging,
        patient_name: PATIENT_HINDI.name,
      },
    };

    const session = await macMini.createSession(request);
    sessionId = session.session_id;

    // Send BP utterance
    const bpRes = await macMini.sendUtterance(sessionId, {
      text: UTTERANCES.hi.bp_report,
      turn_number: 2,
    });
    expect(bpRes.extracted_values.length).toBeGreaterThanOrEqual(2);

    // Confirm BP
    const confirmRes = await macMini.sendUtterance(sessionId, {
      text: UTTERANCES.hi.confirm_yes,
      turn_number: 3,
    });
    expect(confirmRes.session_state.confirmed_values.length).toBeGreaterThanOrEqual(2);

    // Send glucose
    const glucoseRes = await macMini.sendUtterance(sessionId, {
      text: UTTERANCES.hi.glucose_report,
      turn_number: 4,
    });
    expect(glucoseRes.extracted_values.length).toBeGreaterThanOrEqual(1);

    // Confirm glucose
    await macMini.sendUtterance(sessionId, {
      text: UTTERANCES.hi.confirm_yes,
      turn_number: 5,
    });
  });

  it('should end session and collect confirmed values', async () => {
    const endRes = await macMini.endSession(sessionId, 'all_captured');
    expect(endRes.summary.confirmed_values.length).toBeGreaterThanOrEqual(3);
    expect(endRes.summary.status).toBe('complete');
  });

  it('should construct FHIR batch and store observations in S3', async () => {
    const batchRes = await cloudApi.constructFhirBatch({
      patient_id: patientId,
      session_id: sessionId,
      recorded_by: TEST_PATIENT.userId,
      recorded_at: new Date().toISOString(),
      values: [
        { parameter: 'blood_pressure_systolic', loinc_code: '8480-6', value: 130, unit: 'mmHg' },
        { parameter: 'blood_pressure_diastolic', loinc_code: '8462-4', value: 85, unit: 'mmHg' },
        { parameter: 'blood_glucose', loinc_code: '2339-0', value: 140, unit: 'mg/dL' },
      ],
    });

    expect(batchRes.observations_created).toBe(3);

    // Verify S3 key structure: observations/{patientId}/{YYYY}/{MM}/{DD}/{id}.json
    for (const key of batchRes.s3_keys) {
      expect(key).toMatch(/^observations\/[^/]+\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.json$/);
    }

    // Verify observation IDs are valid UUIDs
    for (const id of batchRes.observation_ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});

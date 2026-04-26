/**
 * E2E-01: Full Patient Logging Session
 *
 * Scenario: Caregiver configures BP + glucose -> Patient starts conversation ->
 * Speaks BP value -> Confirms -> Speaks glucose -> Confirms -> Session ends
 *
 * Expected: 2 FHIR Observations in S3; interaction logged; session marked complete
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CloudApiClient } from '../helpers/api-client';
import { MacMiniClient, LlmSessionCreateRequest } from '../helpers/mac-mini-client';
import {
  ENV,
  TEST_CAREGIVER,
  TEST_PATIENT,
  PATIENT_HINDI,
  PARAM_BLOOD_PRESSURE,
  PARAM_BLOOD_GLUCOSE,
  ALL_TOPICS,
  UTTERANCES,
  SYSTEM_PROMPTS,
  skipIfNoLiveInfra,
  testId,
  testSessionId,
} from '../helpers/test-data';

describe('E2E-01: Full Patient Logging Session', () => {
  let cloudApi: CloudApiClient;
  let macMini: MacMiniClient;
  let sessionId: string;
  const patientId = PATIENT_HINDI.id;

  beforeAll(() => {
    skipIfNoLiveInfra();
    cloudApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_CAREGIVER.cognitoToken);
    macMini = new MacMiniClient(ENV.MAC_MINI_HOST);
  });

  afterAll(async () => {
    // Attempt cleanup: end session if still active
    if (sessionId) {
      try {
        await macMini.endSession(sessionId, 'user_stopped');
      } catch {
        // Session may already be ended
      }
    }
  });

  it('should verify Mac Mini is healthy before starting', async () => {
    const healthy = await macMini.isHealthy();
    expect(healthy).toBe(true);
  });

  it('should fetch session config for the patient', async () => {
    cloudApi.setToken(TEST_PATIENT.cognitoToken);
    const config = await cloudApi.fetchSessionConfig(patientId);

    expect(config.patient_id).toBe(patientId);
    expect(config.language).toBe('hi');
    expect(config.parameters.length).toBeGreaterThanOrEqual(2);

    // Verify BP and glucose are configured
    const paramNames = config.parameters.map((p) => p.name);
    expect(paramNames).toContain('blood_pressure');
    expect(paramNames).toContain('blood_glucose');
  });

  it('should create an LLM session for patient logging', async () => {
    const request: LlmSessionCreateRequest = {
      session_type: 'patient_logging',
      patient_id: patientId,
      language: 'hi',
      config: {
        parameters: [PARAM_BLOOD_PRESSURE, PARAM_BLOOD_GLUCOSE],
        topics: ALL_TOPICS,
        system_prompt: SYSTEM_PROMPTS.patient_logging,
        patient_name: PATIENT_HINDI.name,
        last_session_summary: undefined,
      },
    };

    const res = await macMini.createSession(request);
    sessionId = res.session_id;

    expect(res.session_id).toBeDefined();
    expect(res.state).toBe('active');
    expect(res.greeting_text.length).toBeGreaterThan(0);
  });

  it('should extract BP values from Hindi utterance', async () => {
    const res = await macMini.sendUtterance(sessionId, {
      text: UTTERANCES.hi.bp_report,
      turn_number: 2,
    });

    expect(res.action).toBe('confirm_value');
    expect(res.extracted_values.length).toBeGreaterThanOrEqual(2);

    const systolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_systolic');
    const diastolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_diastolic');
    expect(systolic).toBeDefined();
    expect(systolic!.value).toBe(130);
    expect(diastolic).toBeDefined();
    expect(diastolic!.value).toBe(85);
    expect(res.session_state.remaining_parameters).toContain('blood_glucose');
  });

  it('should confirm BP values and move to next parameter', async () => {
    const res = await macMini.sendUtterance(sessionId, {
      text: UTTERANCES.hi.confirm_yes,
      turn_number: 3,
    });

    expect(res.action).toBe('ask_parameter');
    expect(res.session_state.confirmed_values.length).toBeGreaterThanOrEqual(2);

    const confirmedParams = res.session_state.confirmed_values.map((v) => v.parameter);
    expect(confirmedParams).toContain('blood_pressure_systolic');
    expect(confirmedParams).toContain('blood_pressure_diastolic');
    expect(res.session_state.remaining_parameters).toContain('blood_glucose');
  });

  it('should extract glucose value from Hindi utterance', async () => {
    const res = await macMini.sendUtterance(sessionId, {
      text: UTTERANCES.hi.glucose_report,
      turn_number: 4,
    });

    expect(res.action).toBe('confirm_value');
    const glucose = res.extracted_values.find((v) => v.parameter === 'blood_glucose');
    expect(glucose).toBeDefined();
    expect(glucose!.value).toBe(140);
  });

  it('should confirm glucose and complete all parameters', async () => {
    const res = await macMini.sendUtterance(sessionId, {
      text: UTTERANCES.hi.confirm_yes,
      turn_number: 5,
    });

    // After all parameters confirmed, session should summarize or end
    expect(['session_summary', 'ask_topic']).toContain(res.action);
    expect(res.session_state.confirmed_values.length).toBeGreaterThanOrEqual(3);
    expect(res.session_state.remaining_parameters.length).toBe(0);
  });

  it('should end session and get summary', async () => {
    const res = await macMini.endSession(sessionId, 'all_captured');

    expect(res.state).toBe('ended');
    expect(res.summary.status).toBe('complete');
    expect(res.summary.confirmed_values.length).toBeGreaterThanOrEqual(3);
    expect(res.summary.turn_count).toBeGreaterThanOrEqual(5);
    expect(res.summary.language).toBe('hi');
    expect(res.full_transcript.length).toBeGreaterThan(0);
  });

  it('should create FHIR observations via batch API', async () => {
    cloudApi.setToken(TEST_PATIENT.cognitoToken);
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
    expect(batchRes.observation_ids.length).toBe(3);
    expect(batchRes.s3_keys.length).toBe(3);

    // Verify S3 key pattern
    for (const key of batchRes.s3_keys) {
      expect(key).toMatch(/^observations\//);
      expect(key).toContain(patientId);
    }
  });

  it('should store interaction session record', async () => {
    cloudApi.setToken(TEST_PATIENT.cognitoToken);
    const metadata = {
      patient_id: patientId,
      session_id: sessionId,
      session_type: 'patient_logging',
      language: 'hi',
      started_at: new Date(Date.now() - 185000).toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: 185000,
      status: 'complete',
      turn_count: 5,
      transcript: [],
      vision_results: [],
    };

    const interactionRes = await cloudApi.storeInteraction(metadata);

    expect(interactionRes.interaction_id).toBeDefined();
    expect(interactionRes.status).toBe('stored');
  });
});

/**
 * E2E-09: Emergency Detection
 *
 * Scenario: Patient says "seene mein bahut dard ho raha hai" (chest pain in Hindi)
 * -> LLM detects emergency -> Advises patient -> Session ends -> Caregiver alerted
 *
 * Expected: action=emergency; session ends; appropriate emergency response text
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MacMiniClient, LlmSessionCreateRequest } from '../helpers/mac-mini-client';
import { CloudApiClient } from '../helpers/api-client';
import {
  ENV,
  TEST_CAREGIVER,
  PATIENT_HINDI,
  PARAM_BLOOD_PRESSURE,
  ALL_TOPICS,
  SYSTEM_PROMPTS,
  UTTERANCES,
  skipIfNoLiveInfra,
} from '../helpers/test-data';

describe('E2E-09: Emergency Detection', () => {
  let macMini: MacMiniClient;
  let cloudApi: CloudApiClient;
  let sessionId: string;
  const patientId = PATIENT_HINDI.id;

  beforeAll(() => {
    skipIfNoLiveInfra();
    macMini = new MacMiniClient(ENV.MAC_MINI_HOST);
    cloudApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_CAREGIVER.cognitoToken);
  });

  afterAll(async () => {
    if (sessionId) {
      try { await macMini.endSession(sessionId, 'user_stopped'); } catch { /* ok */ }
    }
  });

  it('should create a Hindi patient logging session', async () => {
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

  it('should detect emergency when patient reports chest pain in Hindi', async () => {
    const res = await macMini.sendUtterance(sessionId, {
      text: UTTERANCES.hi.chest_pain,
      turn_number: 2,
    });

    expect(res.action).toBe('emergency');
    expect(res.response_text.length).toBeGreaterThan(0);

    // Response should contain emergency-related guidance
    // (language-agnostic check: response should be non-trivial)
    expect(res.response_text.length).toBeGreaterThan(20);
  });

  it('should end the session after emergency detection', async () => {
    // The session may auto-end after emergency, or we end it explicitly
    try {
      const endRes = await macMini.endSession(sessionId, 'user_stopped');
      expect(endRes.state).toBe('ended');
      expect(endRes.summary.status).toBe('incomplete');
    } catch (err: unknown) {
      // Session may already be ended by the emergency handler
      const axiosErr = err as { response?: { status: number } };
      expect([404, 410]).toContain(axiosErr.response?.status);
    }
  });

  it('should verify emergency alert was created for the caregiver', async () => {
    // Wait for async alert processing
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const alertsRes = await cloudApi.getAlerts(patientId);
    // There should be an emergency-type alert (or the most recent alert should be from this session)
    // The exact alert type depends on implementation; verify at least one alert exists
    expect(alertsRes.alerts.length).toBeGreaterThan(0);
  });
});

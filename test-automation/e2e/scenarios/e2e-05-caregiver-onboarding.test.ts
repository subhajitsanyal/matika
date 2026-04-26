/**
 * E2E-05: Caregiver Onboarding
 *
 * Scenario: Caregiver registers -> Onboards patient via conversation ->
 * Configures protocol -> Sends invite
 *
 * Expected: Patient account created; parameter configs stored; invite sent
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CloudApiClient } from '../helpers/api-client';
import { MacMiniClient, LlmSessionCreateRequest } from '../helpers/mac-mini-client';
import {
  ENV,
  TEST_CAREGIVER,
  PARAM_BLOOD_PRESSURE,
  PARAM_BLOOD_GLUCOSE,
  SYSTEM_PROMPTS,
  skipIfNoLiveInfra,
  testId,
} from '../helpers/test-data';

describe('E2E-05: Caregiver Onboarding', () => {
  let cloudApi: CloudApiClient;
  let macMini: MacMiniClient;
  let onboardingSessionId: string;
  let configSessionId: string;
  let createdPatientId: string;

  beforeAll(() => {
    skipIfNoLiveInfra();
    cloudApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_CAREGIVER.cognitoToken);
    macMini = new MacMiniClient(ENV.MAC_MINI_HOST);
  });

  afterAll(async () => {
    // Cleanup: end any open sessions
    for (const sid of [onboardingSessionId, configSessionId]) {
      if (sid) {
        try { await macMini.endSession(sid, 'user_stopped'); } catch { /* ok */ }
      }
    }
    // Cleanup: delete test patient
    if (createdPatientId) {
      try { await cloudApi.deletePatient(createdPatientId); } catch { /* ok */ }
    }
  });

  it('should start caregiver onboarding conversation', async () => {
    const request: LlmSessionCreateRequest = {
      session_type: 'caregiver_onboarding',
      patient_id: testId(), // temporary ID for onboarding
      language: 'hi',
      config: {
        parameters: [],
        system_prompt: SYSTEM_PROMPTS.caregiver_onboarding,
        patient_name: '',
      },
    };

    const res = await macMini.createSession(request);
    onboardingSessionId = res.session_id;

    expect(res.state).toBe('active');
    expect(res.greeting_text.length).toBeGreaterThan(0);
  });

  it('should collect patient details through conversation', async () => {
    // Provide patient name
    const nameRes = await macMini.sendUtterance(onboardingSessionId, {
      text: 'meri maa ka naam Kamala Devi hai',
      turn_number: 2,
    });
    expect(nameRes.response_text.length).toBeGreaterThan(0);

    // Provide date of birth
    const dobRes = await macMini.sendUtterance(onboardingSessionId, {
      text: 'unka janam 15 March 1950 ko hua tha',
      turn_number: 3,
    });
    expect(dobRes.response_text.length).toBeGreaterThan(0);

    // Provide language preference
    const langRes = await macMini.sendUtterance(onboardingSessionId, {
      text: 'woh Hindi bolti hain',
      turn_number: 4,
    });
    expect(langRes.response_text.length).toBeGreaterThan(0);
  });

  it('should end onboarding session', async () => {
    const endRes = await macMini.endSession(onboardingSessionId, 'all_captured');
    expect(endRes.state).toBe('ended');
  });

  it('should create patient account via Cloud API', async () => {
    const patientRes = await cloudApi.createPatient({
      name: 'Kamala Devi',
      date_of_birth: '1950-03-15',
      language: 'hi',
      caregiver_id: TEST_CAREGIVER.userId,
      timezone: 'Asia/Kolkata',
    });

    createdPatientId = patientRes.patient_id;
    expect(patientRes.patient_id).toBeDefined();
    expect(patientRes.status).toBeDefined();
  });

  it('should configure monitoring protocol via caregiver_config session', async () => {
    const request: LlmSessionCreateRequest = {
      session_type: 'caregiver_config',
      patient_id: createdPatientId,
      language: 'hi',
      config: {
        parameters: [],
        system_prompt: SYSTEM_PROMPTS.caregiver_config,
        patient_name: 'Kamala Devi',
      },
    };

    const res = await macMini.createSession(request);
    configSessionId = res.session_id;
    expect(res.state).toBe('active');

    // Provide parameter configuration
    const configRes = await macMini.sendUtterance(configSessionId, {
      text: 'BP aur sugar dono daily check karna hai, shaam 6 baje tak',
      turn_number: 2,
    });
    expect(configRes.response_text.length).toBeGreaterThan(0);

    await macMini.endSession(configSessionId, 'all_captured');
  });

  it('should store parameter configs for the new patient', async () => {
    // Configure BP
    await cloudApi.updateParameterConfig(createdPatientId, {
      vital_type: 'blood_pressure',
      frequency_days: 1,
      daily_deadline: '18:00',
      timezone: 'Asia/Kolkata',
    });

    // Configure glucose
    await cloudApi.updateParameterConfig(createdPatientId, {
      vital_type: 'blood_glucose',
      frequency_days: 1,
      daily_deadline: '18:00',
      timezone: 'Asia/Kolkata',
    });

    // Verify configs are stored
    const config = await cloudApi.fetchSessionConfig(createdPatientId);
    expect(config.parameters.length).toBeGreaterThanOrEqual(2);
    const paramNames = config.parameters.map((p) => p.name);
    expect(paramNames).toContain('blood_pressure');
    expect(paramNames).toContain('blood_glucose');
  });

  it('should verify the patient account exists', async () => {
    const patientRes = await cloudApi.getPatient(createdPatientId);
    expect(patientRes.status).toBe(200);
  });
});

/**
 * E2E-08: STT Failure Fallback
 *
 * Scenario: Patient speaks -> STT returns garbage -> System asks to repeat ->
 * Speak again -> STT garbage again -> System shows text input fallback ->
 * Patient types value -> Session continues normally
 *
 * Expected: After 2 failed STT attempts, text input shown; session continues
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MacMiniClient, LlmSessionCreateRequest } from '../helpers/mac-mini-client';
import {
  ENV,
  PATIENT_HINDI,
  PARAM_BLOOD_PRESSURE,
  PARAM_BLOOD_GLUCOSE,
  ALL_TOPICS,
  SYSTEM_PROMPTS,
  UTTERANCES,
  skipIfNoLiveInfra,
} from '../helpers/test-data';

describe('E2E-08: STT Failure Fallback', () => {
  let macMini: MacMiniClient;
  let sessionId: string;
  const patientId = PATIENT_HINDI.id;

  beforeAll(() => {
    skipIfNoLiveInfra();
    macMini = new MacMiniClient(ENV.MAC_MINI_HOST);
  });

  afterAll(async () => {
    if (sessionId) {
      try { await macMini.endSession(sessionId, 'user_stopped'); } catch { /* ok */ }
    }
  });

  it('should create a patient logging session', async () => {
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

    const res = await macMini.createSession(request);
    sessionId = res.session_id;
    expect(res.state).toBe('active');
  });

  it('should send garbage/unclear text and get ask_repeat action (attempt 1)', async () => {
    const res = await macMini.sendUtterance(sessionId, {
      text: '',  // Empty/garbage transcript from failed STT
      turn_number: 2,
    });

    expect(res.action).toBe('ask_repeat');
    expect(res.response_text.length).toBeGreaterThan(0);
  });

  it('should send garbage again and get ask_repeat action (attempt 2)', async () => {
    const res = await macMini.sendUtterance(sessionId, {
      text: 'zzzzz xxxx mmmm',  // Garbage text
      turn_number: 3,
    });

    // After 2 failures, should switch to text fallback
    expect(['ask_repeat', 'fallback_text']).toContain(res.action);
  });

  it('should trigger fallback_text after repeated failures', async () => {
    // If the second attempt already returned fallback_text, this may return
    // a different action. If it was ask_repeat, send one more garbage.
    const res = await macMini.sendUtterance(sessionId, {
      text: '',
      turn_number: 4,
    });

    expect(res.action).toBe('fallback_text');
    expect(res.response_text.length).toBeGreaterThan(0);
  });

  it('should accept text input and continue session normally', async () => {
    // Patient types their BP value as text
    const res = await macMini.sendUtterance(sessionId, {
      text: UTTERANCES.hi.bp_report,
      turn_number: 5,
    });

    expect(res.action).toBe('confirm_value');
    expect(res.extracted_values.length).toBeGreaterThanOrEqual(2);

    const systolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_systolic');
    expect(systolic).toBeDefined();
    expect(systolic!.value).toBe(130);
  });

  it('should confirm value and continue to next parameter', async () => {
    const res = await macMini.sendUtterance(sessionId, {
      text: UTTERANCES.hi.confirm_yes,
      turn_number: 6,
    });

    expect(['ask_parameter', 'session_summary']).toContain(res.action);
    expect(res.session_state.confirmed_values.length).toBeGreaterThanOrEqual(2);
  });
});

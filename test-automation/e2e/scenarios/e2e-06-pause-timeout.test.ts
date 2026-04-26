/**
 * E2E-06: Pause Timeout
 *
 * Scenario: Patient starts session -> Pauses -> Waits 5 minutes ->
 * Session auto-ends -> Mac Mini state cleaned up -> Incomplete session logged
 *
 * Expected: Session auto-ends; Mac Mini cleaned up; session status=incomplete
 *
 * NOTE: This test either waits the full 5 minutes or uses a shorter wait
 * with verification that the session becomes expired. For CI, the long wait
 * can be controlled via CARELOG_PAUSE_TIMEOUT_WAIT_MS env var.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MacMiniClient, LlmSessionCreateRequest } from '../helpers/mac-mini-client';
import {
  ENV,
  PATIENT_HINDI,
  PARAM_BLOOD_PRESSURE,
  ALL_TOPICS,
  SYSTEM_PROMPTS,
  UTTERANCES,
  skipIfNoLiveInfra,
} from '../helpers/test-data';

// Default: wait 310 seconds (5 min + 10s buffer). Override via env for faster CI.
const PAUSE_TIMEOUT_WAIT_MS = parseInt(
  process.env.CARELOG_PAUSE_TIMEOUT_WAIT_MS ?? '310000',
  10,
);

describe('E2E-06: Pause Timeout', { timeout: PAUSE_TIMEOUT_WAIT_MS + 60_000 }, () => {
  let macMini: MacMiniClient;
  let sessionId: string;
  const patientId = PATIENT_HINDI.id;

  beforeAll(() => {
    skipIfNoLiveInfra();
    macMini = new MacMiniClient(ENV.MAC_MINI_HOST);
  });

  it('should create a patient session', async () => {
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

  it('should send an utterance and then pause the session', async () => {
    await macMini.sendUtterance(sessionId, {
      text: UTTERANCES.hi.bp_report,
      turn_number: 2,
    });

    const pauseRes = await macMini.pauseSession(sessionId);
    expect(pauseRes.state).toBe('paused');
    expect(pauseRes.timeout_seconds).toBe(300);
  });

  it('should auto-end after pause timeout expires', async () => {
    // Wait for the timeout
    await new Promise((resolve) => setTimeout(resolve, PAUSE_TIMEOUT_WAIT_MS));

    // Attempting to resume should fail with 410 Gone
    try {
      await macMini.resumeSession(sessionId);
      // If we get here, the session hasn't timed out yet — unexpected
      expect.fail('Expected session to be expired after pause timeout');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status: number; data?: { error?: string } } };
      expect(axiosErr.response?.status).toBe(410);
      expect(axiosErr.response?.data?.error).toBe('session_expired');
    }
  });

  it('should have cleaned up Mac Mini state', async () => {
    // Attempting to send an utterance to the expired session should fail
    try {
      await macMini.sendUtterance(sessionId, {
        text: 'test',
        turn_number: 99,
      });
      expect.fail('Expected session to be cleaned up');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status: number } };
      expect([404, 410]).toContain(axiosErr.response?.status);
    }
  });
});

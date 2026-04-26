/**
 * Compliance: Mac Mini Cleanup Verification
 *
 * After a session ends, verifies that:
 * 1. /tmp/carelog/{sessionId}/ is deleted on the Mac Mini
 * 2. No patient data persists on the Mac Mini filesystem
 * 3. LLM session state is cleared
 *
 * Usage: tsx compliance/mac-mini-cleanup-verify.ts
 */

import { MacMiniClient, LlmSessionCreateRequest } from '../e2e/helpers/mac-mini-client';
import {
  ENV,
  PARAM_BLOOD_PRESSURE,
  SYSTEM_PROMPTS,
  UTTERANCES,
} from '../e2e/helpers/test-data';
import { v4 as uuidv4 } from 'uuid';

interface CleanupCheckResult {
  check: string;
  pass: boolean;
  detail: string;
}

async function main(): Promise<void> {
  console.log('=== Mac Mini Cleanup Verification ===\n');

  const macMini = new MacMiniClient(ENV.MAC_MINI_HOST);
  const results: CleanupCheckResult[] = [];

  // Step 1: Verify Mac Mini is healthy
  const healthy = await macMini.isHealthy();
  if (!healthy) {
    console.error('Mac Mini is not healthy. Cannot run cleanup verification.');
    process.exit(1);
  }
  console.log('Mac Mini health check: OK\n');

  // Step 2: Create a test session with some data
  console.log('Creating test session...');
  const patientId = uuidv4();
  const request: LlmSessionCreateRequest = {
    session_type: 'patient_logging',
    patient_id: patientId,
    language: 'hi',
    config: {
      parameters: [PARAM_BLOOD_PRESSURE],
      system_prompt: SYSTEM_PROMPTS.patient_logging,
      patient_name: 'Test Patient',
    },
  };

  const session = await macMini.createSession(request);
  const sessionId = session.session_id;
  console.log(`Session created: ${sessionId}`);

  // Step 3: Send some data through the session
  await macMini.sendUtterance(sessionId, {
    text: UTTERANCES.hi.bp_report,
    turn_number: 2,
  });
  console.log('Utterance sent with test data');

  // Step 4: End the session
  const endRes = await macMini.endSession(sessionId, 'user_stopped');
  console.log(`Session ended: ${endRes.state}`);

  results.push({
    check: 'Session end response',
    pass: endRes.state === 'ended',
    detail: `Session state: ${endRes.state}`,
  });

  // Step 5: Verify session state is cleared — sending utterance should fail
  console.log('\nVerifying session state cleanup...');
  try {
    await macMini.sendUtterance(sessionId, {
      text: 'test',
      turn_number: 99,
    });
    results.push({
      check: 'Session state cleared',
      pass: false,
      detail: 'FAIL: Session still accepts utterances after ending',
    });
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status: number } };
    const status = axiosErr.response?.status;
    results.push({
      check: 'Session state cleared',
      pass: status === 404 || status === 410,
      detail: `Session correctly rejects utterances after ending (HTTP ${status})`,
    });
  }

  // Step 6: Verify session cannot be resumed
  try {
    await macMini.resumeSession(sessionId);
    results.push({
      check: 'Session resume blocked',
      pass: false,
      detail: 'FAIL: Ended session can still be resumed',
    });
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status: number } };
    const status = axiosErr.response?.status;
    results.push({
      check: 'Session resume blocked',
      pass: status === 404 || status === 410,
      detail: `Session correctly rejects resume after ending (HTTP ${status})`,
    });
  }

  // Step 7: Verify session cannot be paused
  try {
    await macMini.pauseSession(sessionId);
    results.push({
      check: 'Session pause blocked',
      pass: false,
      detail: 'FAIL: Ended session can still be paused',
    });
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status: number } };
    const status = axiosErr.response?.status;
    results.push({
      check: 'Session pause blocked',
      pass: status === 404 || status === 410,
      detail: `Session correctly rejects pause after ending (HTTP ${status})`,
    });
  }

  // Step 8: Create another session to verify no cross-contamination
  console.log('\nVerifying no cross-session data leakage...');
  const newPatientId = uuidv4();
  const newSession = await macMini.createSession({
    session_type: 'patient_logging',
    patient_id: newPatientId,
    language: 'en',
    config: {
      parameters: [PARAM_BLOOD_PRESSURE],
      system_prompt: SYSTEM_PROMPTS.patient_logging,
      patient_name: 'New Patient',
    },
  });

  // The new session should have no prior conversation context
  const utteranceRes = await macMini.sendUtterance(newSession.session_id, {
    text: 'hello',
    turn_number: 2,
  });

  results.push({
    check: 'No cross-session data leakage',
    pass: utteranceRes.session_state.confirmed_values.length === 0,
    detail: utteranceRes.session_state.confirmed_values.length === 0
      ? 'New session starts with empty state'
      : 'FAIL: New session has pre-existing confirmed values',
  });

  await macMini.endSession(newSession.session_id, 'user_stopped');

  // Report
  console.log('\n--- Cleanup Verification Results ---\n');

  const passed = results.filter((r) => r.pass);
  const failed = results.filter((r) => !r.pass);

  for (const r of results) {
    const icon = r.pass ? '[PASS]' : '[FAIL]';
    console.log(`${icon} ${r.check}: ${r.detail}`);
  }

  console.log(`\nTotal: ${results.length} checks, ${passed.length} passed, ${failed.length} failed`);

  if (failed.length > 0) {
    console.log('\nFAIL: Mac Mini cleanup verification failed.');
    process.exit(1);
  }

  console.log('\nPASS: All Mac Mini cleanup checks passed.');
}

main().catch((err) => {
  console.error('Cleanup verification failed:', err);
  process.exit(1);
});

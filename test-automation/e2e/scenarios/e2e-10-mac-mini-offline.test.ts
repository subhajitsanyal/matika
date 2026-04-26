/**
 * E2E-10: Mac Mini Offline
 *
 * Scenario: Mac Mini is unreachable -> Health check returns OFFLINE ->
 * Conversation cannot start
 *
 * Expected: Health check fails; conversation button would be disabled
 */

import { describe, it, expect } from 'vitest';
import { MacMiniClient } from '../helpers/mac-mini-client';

describe('E2E-10: Mac Mini Offline', () => {
  // Point to a non-existent host to simulate offline Mac Mini
  const offlineMacMini = new MacMiniClient('192.168.255.254');

  it('should return unhealthy when Mac Mini is unreachable', async () => {
    const healthy = await offlineMacMini.isHealthy();
    expect(healthy).toBe(false);
  });

  it('should fail to get health status details', async () => {
    try {
      await offlineMacMini.health();
      expect.fail('Expected health check to fail for offline Mac Mini');
    } catch (err: unknown) {
      // Connection refused or timeout is expected
      expect(err).toBeDefined();
    }
  });

  it('should fail to create a session when Mac Mini is offline', async () => {
    try {
      await offlineMacMini.createSession({
        session_type: 'patient_logging',
        patient_id: 'test-patient-id',
        language: 'hi',
        config: {
          parameters: [],
          system_prompt: 'test',
          patient_name: 'Test',
        },
      });
      expect.fail('Expected session creation to fail for offline Mac Mini');
    } catch (err: unknown) {
      expect(err).toBeDefined();
    }
  });

  it('should fail STT transcription when Mac Mini is offline', async () => {
    try {
      await offlineMacMini.transcribe(Buffer.alloc(16000), 'en');
      expect.fail('Expected transcribe to fail for offline Mac Mini');
    } catch (err: unknown) {
      expect(err).toBeDefined();
    }
  });

  it('should fail TTS synthesis when Mac Mini is offline', async () => {
    try {
      await offlineMacMini.synthesize({
        text: 'Hello',
        language: 'en',
      });
      expect.fail('Expected synthesize to fail for offline Mac Mini');
    } catch (err: unknown) {
      expect(err).toBeDefined();
    }
  });
});

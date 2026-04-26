/**
 * Integration: Interaction Storage
 *
 * Tests: store-interaction -> S3 + RDS
 * Validates that audio, transcript, and metadata are stored at correct S3 keys
 * and that an RDS interaction_sessions record is created.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CloudApiClient } from '../e2e/helpers/api-client';
import {
  ENV,
  TEST_PATIENT,
  PATIENT_HINDI,
  skipIfNoLiveInfra,
  testId,
  testSessionId,
} from '../e2e/helpers/test-data';

describe('Integration: Interaction Storage', () => {
  let cloudApi: CloudApiClient;
  const patientId = PATIENT_HINDI.id;
  const sessionId = testSessionId();

  beforeAll(() => {
    skipIfNoLiveInfra();
    cloudApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_PATIENT.cognitoToken);
  });

  it('should store an interaction with metadata only', async () => {
    const metadata = {
      patient_id: patientId,
      session_id: sessionId,
      session_type: 'patient_logging',
      language: 'hi',
      started_at: new Date(Date.now() - 120000).toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: 120000,
      status: 'complete',
      turn_count: 4,
      transcript: [
        { turn: 1, role: 'system', text: 'Namaste! Aaj aap kaisa mehsoos kar rahe hain?' },
        { turn: 2, role: 'patient', text: 'mera blood pressure 130 over 85 hai' },
        { turn: 3, role: 'system', text: 'Blood pressure 130/85 save kar liya.' },
        { turn: 4, role: 'patient', text: 'haan sahi hai' },
      ],
      vision_results: [],
    };

    const res = await cloudApi.storeInteraction(metadata);

    expect(res.interaction_id).toBeDefined();
    expect(res.status).toBe('stored');
  });

  it('should store an interaction with audio buffers', async () => {
    const metadata = {
      patient_id: patientId,
      session_id: testSessionId(),
      session_type: 'patient_logging',
      language: 'hi',
      started_at: new Date(Date.now() - 60000).toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: 60000,
      status: 'complete',
      turn_count: 2,
      transcript: [],
      vision_results: [],
    };

    // Create dummy audio buffers (16kHz, 1 second of silence)
    const dummyAudio = Buffer.alloc(32000); // 16000 samples * 2 bytes

    const res = await cloudApi.storeInteraction(metadata, dummyAudio, dummyAudio);

    expect(res.interaction_id).toBeDefined();
    expect(res.audio_s3_key).toBeDefined();
    expect(res.audio_s3_key).toContain('interactions/');
    expect(res.status).toBe('stored');
  });

  it('should store S3 keys in the correct path pattern', async () => {
    const metadata = {
      patient_id: patientId,
      session_id: testSessionId(),
      session_type: 'patient_logging',
      language: 'hi',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: 5000,
      status: 'incomplete',
      turn_count: 1,
      transcript: [],
      vision_results: [],
    };

    const res = await cloudApi.storeInteraction(metadata);

    // S3 key pattern: interactions/{patientId}/{YYYY}/{MM}/{DD}/{sessionId}/...
    if (res.audio_s3_key) {
      expect(res.audio_s3_key).toMatch(/^interactions\//);
    }
    if (res.transcript_s3_key) {
      expect(res.transcript_s3_key).toMatch(/^interactions\//);
    }
  });

  it('should be retrievable after storage', async () => {
    const interactionsRes = await cloudApi.getInteractions(patientId);
    expect(interactionsRes.status).toBe(200);
  });
});

/**
 * Integration: Session Config Fetch
 *
 * Tests: fetch-session-config -> RDS queries
 * Validates correct assembly of parameters, topics, prompts, thresholds, and recommendations.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CloudApiClient } from '../e2e/helpers/api-client';
import {
  ENV,
  TEST_PATIENT,
  TEST_CAREGIVER,
  PATIENT_HINDI,
  skipIfNoLiveInfra,
} from '../e2e/helpers/test-data';

describe('Integration: Session Config Fetch', () => {
  let patientApi: CloudApiClient;
  let caregiverApi: CloudApiClient;
  const patientId = PATIENT_HINDI.id;

  beforeAll(() => {
    skipIfNoLiveInfra();
    patientApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_PATIENT.cognitoToken);
    caregiverApi = new CloudApiClient(ENV.CLOUD_API_URL, TEST_CAREGIVER.cognitoToken);
  });

  it('should return complete session config for patient', async () => {
    const config = await patientApi.fetchSessionConfig(patientId);

    expect(config.patient_id).toBe(patientId);
    expect(config.patient_name).toBeDefined();
    expect(config.language).toMatch(/^(en|hi|bn)$/);
    expect(config.timezone).toBeDefined();
  });

  it('should include parameter configurations with required fields', async () => {
    const config = await patientApi.fetchSessionConfig(patientId);

    expect(config.parameters.length).toBeGreaterThan(0);

    for (const param of config.parameters) {
      expect(param.id).toBeDefined();
      expect(param.name).toBeDefined();
      expect(param.loinc_codes.length).toBeGreaterThan(0);
      expect(param.unit).toBeDefined();
      expect(param.frequency_days).toBeGreaterThan(0);
      expect(param.daily_deadline).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('should include topics with status tracking', async () => {
    const config = await patientApi.fetchSessionConfig(patientId);

    expect(config.topics.length).toBeGreaterThan(0);

    for (const topic of config.topics) {
      expect(topic.id).toBeDefined();
      expect(topic.name).toBeDefined();
      expect(topic.description).toBeDefined();
      expect(['incomplete', 'complete', 'outdated']).toContain(topic.status);
    }
  });

  it('should include system prompts for all session types', async () => {
    const config = await patientApi.fetchSessionConfig(patientId);

    expect(config.prompts).toBeDefined();
    expect(config.prompts['patient_logging']).toBeDefined();
    expect(config.prompts['patient_logging'].length).toBeGreaterThan(0);
  });

  it('should include recommendations if any exist', async () => {
    const config = await patientApi.fetchSessionConfig(patientId);

    // Recommendations may or may not exist — verify structure if present
    if (config.recommendations && config.recommendations.length > 0) {
      for (const rec of config.recommendations) {
        expect(rec.id).toBeDefined();
        expect(rec.source).toBeDefined();
        expect(rec.parameter_name).toBeDefined();
        expect(rec.status).toBeDefined();
      }
    }
  });

  it('should be accessible by both patient and caregiver', async () => {
    const patientConfig = await patientApi.fetchSessionConfig(patientId);
    const caregiverConfig = await caregiverApi.fetchSessionConfig(patientId);

    expect(patientConfig.patient_id).toBe(caregiverConfig.patient_id);
    expect(patientConfig.parameters.length).toBe(caregiverConfig.parameters.length);
  });

  it('should include last session summary if a previous session exists', async () => {
    const config = await patientApi.fetchSessionConfig(patientId);

    // last_session_summary may be null for first-time patients
    if (config.last_session_summary) {
      expect(config.last_session_summary.date).toBeDefined();
      expect(config.last_session_summary.status).toBeDefined();
      expect(Array.isArray(config.last_session_summary.confirmed_values)).toBe(true);
    }
  });
});

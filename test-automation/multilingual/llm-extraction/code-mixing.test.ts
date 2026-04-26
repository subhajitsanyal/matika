/**
 * Multilingual: Code-Mixing Extraction
 *
 * Tests extraction of values from code-mixed speech where English medical
 * terms appear in Hindi or Bengali sentences.
 *
 * Examples:
 *   "mera BP one thirty over eighty five hai" -> extract 130/85
 *   "amar sugar level one forty" -> extract 140
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { MacMiniClient, LlmSessionCreateRequest } from '../../e2e/helpers/mac-mini-client';
import {
  ENV,
  PATIENT_HINDI,
  PATIENT_BENGALI,
  PARAM_BLOOD_PRESSURE,
  PARAM_BLOOD_GLUCOSE,
  SYSTEM_PROMPTS,
  skipIfNoLiveInfra,
} from '../../e2e/helpers/test-data';

describe('Multilingual: Code-Mixing Extraction', () => {
  let macMini: MacMiniClient;
  const sessionIds: string[] = [];

  beforeAll(() => {
    skipIfNoLiveInfra();
    macMini = new MacMiniClient(ENV.MAC_MINI_HOST);
  });

  afterEach(async () => {
    for (const sid of sessionIds) {
      try { await macMini.endSession(sid, 'user_stopped'); } catch { /* ok */ }
    }
    sessionIds.length = 0;
  });

  async function createSession(language: 'hi' | 'bn', patientId: string, name: string): Promise<string> {
    const res = await macMini.createSession({
      session_type: 'patient_logging',
      patient_id: patientId,
      language,
      config: {
        parameters: [PARAM_BLOOD_PRESSURE, PARAM_BLOOD_GLUCOSE],
        system_prompt: SYSTEM_PROMPTS.patient_logging,
        patient_name: name,
      },
    });
    sessionIds.push(res.session_id);
    return res.session_id;
  }

  it('should extract BP from Hindi with English numbers: "mera BP one thirty over eighty five hai"', async () => {
    const sid = await createSession('hi', PATIENT_HINDI.id, PATIENT_HINDI.name);

    const res = await macMini.sendUtterance(sid, {
      text: 'mera BP one thirty over eighty five hai',
      turn_number: 2,
    });

    expect(res.extracted_values.length).toBeGreaterThanOrEqual(2);
    const systolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_systolic');
    const diastolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_diastolic');
    expect(systolic?.value).toBe(130);
    expect(diastolic?.value).toBe(85);
  });

  it('should extract BP from Hindi with mixed numerals: "mera blood pressure 130 over 85 hai"', async () => {
    const sid = await createSession('hi', PATIENT_HINDI.id, PATIENT_HINDI.name);

    const res = await macMini.sendUtterance(sid, {
      text: 'mera blood pressure 130 over 85 hai',
      turn_number: 2,
    });

    const systolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_systolic');
    expect(systolic?.value).toBe(130);
  });

  it('should extract glucose from Hindi with English: "mera sugar level one forty hai"', async () => {
    const sid = await createSession('hi', PATIENT_HINDI.id, PATIENT_HINDI.name);

    // Skip BP first
    await macMini.sendUtterance(sid, { text: 'mera blood pressure 120 over 80 hai', turn_number: 2 });
    await macMini.sendUtterance(sid, { text: 'haan sahi hai', turn_number: 3 });

    const res = await macMini.sendUtterance(sid, {
      text: 'mera sugar level one forty hai',
      turn_number: 4,
    });

    const glucose = res.extracted_values.find((v) => v.parameter === 'blood_glucose');
    expect(glucose?.value).toBe(140);
  });

  it('should extract BP from Bengali with English terms: "amar blood pressure 130 over 85"', async () => {
    const sid = await createSession('bn', PATIENT_BENGALI.id, PATIENT_BENGALI.name);

    const res = await macMini.sendUtterance(sid, {
      text: 'amar blood pressure 130 over 85',
      turn_number: 2,
    });

    const systolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_systolic');
    expect(systolic?.value).toBe(130);
  });

  it('should extract glucose from Bengali code-mixed: "amar sugar level 140"', async () => {
    const sid = await createSession('bn', PATIENT_BENGALI.id, PATIENT_BENGALI.name);

    await macMini.sendUtterance(sid, { text: 'amar blood pressure 120 over 80', turn_number: 2 });
    await macMini.sendUtterance(sid, { text: 'hyan eita thik achhe', turn_number: 3 });

    const res = await macMini.sendUtterance(sid, {
      text: 'amar sugar level 140',
      turn_number: 4,
    });

    const glucose = res.extracted_values.find((v) => v.parameter === 'blood_glucose');
    expect(glucose?.value).toBe(140);
  });

  it('should handle fully Hindi numerals: "ek sau tees per pachaasi"', async () => {
    const sid = await createSession('hi', PATIENT_HINDI.id, PATIENT_HINDI.name);

    const res = await macMini.sendUtterance(sid, {
      text: 'mera blood pressure ek sau tees per pachaasi hai',
      turn_number: 2,
    });

    // The LLM should interpret Hindi numerals
    expect(res.extracted_values.length).toBeGreaterThanOrEqual(2);
    const systolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_systolic');
    expect(systolic?.value).toBe(130);
  });

  it('should handle informal abbreviations: "BP 130/85"', async () => {
    const sid = await createSession('hi', PATIENT_HINDI.id, PATIENT_HINDI.name);

    const res = await macMini.sendUtterance(sid, {
      text: 'BP 130/85',
      turn_number: 2,
    });

    const systolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_systolic');
    expect(systolic?.value).toBe(130);
    const diastolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_diastolic');
    expect(diastolic?.value).toBe(85);
  });
});

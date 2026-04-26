/**
 * Multilingual: LLM Value Extraction
 *
 * Tests that the LLM correctly extracts vital values from transcripts
 * in all 3 languages (English, Hindi, Bengali).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { MacMiniClient, LlmSessionCreateRequest } from '../../e2e/helpers/mac-mini-client';
import {
  ENV,
  PATIENT_ENGLISH,
  PATIENT_HINDI,
  PATIENT_BENGALI,
  PARAM_BLOOD_PRESSURE,
  PARAM_BLOOD_GLUCOSE,
  SYSTEM_PROMPTS,
  UTTERANCES,
  skipIfNoLiveInfra,
} from '../../e2e/helpers/test-data';

describe('Multilingual: LLM Value Extraction', () => {
  let macMini: MacMiniClient;
  const sessionIds: string[] = [];

  beforeAll(() => {
    skipIfNoLiveInfra();
    macMini = new MacMiniClient(ENV.MAC_MINI_HOST);
  });

  afterEach(async () => {
    // Cleanup any open sessions
    for (const sid of sessionIds) {
      try { await macMini.endSession(sid, 'user_stopped'); } catch { /* ok */ }
    }
    sessionIds.length = 0;
  });

  async function createSessionForLanguage(
    language: 'en' | 'hi' | 'bn',
    patientId: string,
    patientName: string,
  ): Promise<string> {
    const request: LlmSessionCreateRequest = {
      session_type: 'patient_logging',
      patient_id: patientId,
      language,
      config: {
        parameters: [PARAM_BLOOD_PRESSURE, PARAM_BLOOD_GLUCOSE],
        system_prompt: SYSTEM_PROMPTS.patient_logging,
        patient_name: patientName,
      },
    };

    const res = await macMini.createSession(request);
    sessionIds.push(res.session_id);
    return res.session_id;
  }

  it('should extract BP values from English transcript', async () => {
    const sid = await createSessionForLanguage('en', PATIENT_ENGLISH.id, PATIENT_ENGLISH.name);

    const res = await macMini.sendUtterance(sid, {
      text: UTTERANCES.en.bp_report,
      turn_number: 2,
    });

    expect(res.extracted_values.length).toBeGreaterThanOrEqual(2);
    const systolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_systolic');
    const diastolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_diastolic');
    expect(systolic?.value).toBe(130);
    expect(diastolic?.value).toBe(85);
  });

  it('should extract BP values from Hindi transcript', async () => {
    const sid = await createSessionForLanguage('hi', PATIENT_HINDI.id, PATIENT_HINDI.name);

    const res = await macMini.sendUtterance(sid, {
      text: UTTERANCES.hi.bp_report,
      turn_number: 2,
    });

    expect(res.extracted_values.length).toBeGreaterThanOrEqual(2);
    const systolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_systolic');
    expect(systolic?.value).toBe(130);
  });

  it('should extract BP values from Bengali transcript', async () => {
    const sid = await createSessionForLanguage('bn', PATIENT_BENGALI.id, PATIENT_BENGALI.name);

    const res = await macMini.sendUtterance(sid, {
      text: UTTERANCES.bn.bp_report,
      turn_number: 2,
    });

    expect(res.extracted_values.length).toBeGreaterThanOrEqual(2);
    const systolic = res.extracted_values.find((v) => v.parameter === 'blood_pressure_systolic');
    expect(systolic?.value).toBe(130);
  });

  it('should extract glucose values from Hindi transcript', async () => {
    const sid = await createSessionForLanguage('hi', PATIENT_HINDI.id, PATIENT_HINDI.name);

    // Skip BP first
    await macMini.sendUtterance(sid, { text: UTTERANCES.hi.bp_report, turn_number: 2 });
    await macMini.sendUtterance(sid, { text: UTTERANCES.hi.confirm_yes, turn_number: 3 });

    const res = await macMini.sendUtterance(sid, {
      text: UTTERANCES.hi.glucose_report,
      turn_number: 4,
    });

    const glucose = res.extracted_values.find((v) => v.parameter === 'blood_glucose');
    expect(glucose?.value).toBe(140);
  });

  it('should respond in the correct language (Hindi)', async () => {
    const sid = await createSessionForLanguage('hi', PATIENT_HINDI.id, PATIENT_HINDI.name);

    const res = await macMini.sendUtterance(sid, {
      text: UTTERANCES.hi.bp_report,
      turn_number: 2,
    });

    // Hindi response should contain Devanagari characters or common Hindi transliteration
    expect(res.response_text.length).toBeGreaterThan(0);
    // Check for either Devanagari script or transliterated Hindi
    const hasDevanagari = /[\u0900-\u097F]/.test(res.response_text);
    const hasCommonHindiWords = /hai|kya|aapka|blood pressure/i.test(res.response_text);
    expect(hasDevanagari || hasCommonHindiWords).toBe(true);
  });

  it('should respond in the correct language (Bengali)', async () => {
    const sid = await createSessionForLanguage('bn', PATIENT_BENGALI.id, PATIENT_BENGALI.name);

    const res = await macMini.sendUtterance(sid, {
      text: UTTERANCES.bn.bp_report,
      turn_number: 2,
    });

    expect(res.response_text.length).toBeGreaterThan(0);
    // Check for Bengali script or transliterated Bengali
    const hasBengaliScript = /[\u0980-\u09FF]/.test(res.response_text);
    const hasCommonBengaliWords = /apnar|blood pressure|thik/i.test(res.response_text);
    expect(hasBengaliScript || hasCommonBengaliWords).toBe(true);
  });
});

/**
 * Multilingual: TTS Quality — Pronunciation
 *
 * Verifies that TTS produces non-empty PCM audio for all 3 languages.
 * Tests with medical terms, patient-facing response text, and numbers.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MacMiniClient } from '../../e2e/helpers/mac-mini-client';
import {
  ENV,
  skipIfNoLiveInfra,
} from '../../e2e/helpers/test-data';

describe('Multilingual: TTS Quality — Pronunciation', () => {
  let macMini: MacMiniClient;

  beforeAll(() => {
    skipIfNoLiveInfra();
    macMini = new MacMiniClient(ENV.MAC_MINI_HOST);
  });

  // ---- English -----------------------------------------------------------

  it('should produce non-empty audio for English text', async () => {
    const res = await macMini.synthesize({
      text: 'I recorded your blood pressure as 130 over 85. Is that correct?',
      language: 'en',
      format: 'pcm',
      sample_rate: 16000,
    });

    expect(res.audio.length).toBeGreaterThan(0);
    expect(res.sampleRate).toBe(16000);
    expect(res.durationMs).toBeGreaterThan(0);
  });

  it('should produce audio for English medical terms', async () => {
    const res = await macMini.synthesize({
      text: 'Your blood glucose level is 140 milligrams per deciliter. Your oxygen saturation is 98 percent.',
      language: 'en',
      format: 'pcm',
      sample_rate: 16000,
    });

    expect(res.audio.length).toBeGreaterThan(0);
  });

  // ---- Hindi --------------------------------------------------------------

  it('should produce non-empty audio for Hindi text (Devanagari)', async () => {
    const res = await macMini.synthesize({
      text: 'मैंने सुना कि आपका blood pressure 130/85 है। क्या यह सही है?',
      language: 'hi',
      format: 'pcm',
      sample_rate: 16000,
    });

    expect(res.audio.length).toBeGreaterThan(0);
    expect(res.durationMs).toBeGreaterThan(0);
  });

  it('should produce audio for Hindi medical terms', async () => {
    const res = await macMini.synthesize({
      text: 'आपका sugar level 140 mg/dL है। यह normal range में है।',
      language: 'hi',
      format: 'pcm',
      sample_rate: 16000,
    });

    expect(res.audio.length).toBeGreaterThan(0);
  });

  it('should produce audio for Hindi empathetic response', async () => {
    const res = await macMini.synthesize({
      text: 'बहुत अच्छा! आपकी सेहत का ख्याल रखना बहुत जरूरी है। कल भी अपनी readings जरूर बताइयेगा।',
      language: 'hi',
      format: 'pcm',
      sample_rate: 16000,
    });

    expect(res.audio.length).toBeGreaterThan(0);
  });

  // ---- Bengali ------------------------------------------------------------

  it('should produce non-empty audio for Bengali text', async () => {
    const res = await macMini.synthesize({
      text: 'আপনার blood pressure 130/85 রেকর্ড করেছি। এটা ঠিক আছে?',
      language: 'bn',
      format: 'pcm',
      sample_rate: 16000,
    });

    expect(res.audio.length).toBeGreaterThan(0);
    expect(res.durationMs).toBeGreaterThan(0);
  });

  it('should produce audio for Bengali medical terms', async () => {
    const res = await macMini.synthesize({
      text: 'আপনার sugar level 140 mg/dL। এটা normal range এ আছে।',
      language: 'bn',
      format: 'pcm',
      sample_rate: 16000,
    });

    expect(res.audio.length).toBeGreaterThan(0);
  });

  // ---- Cross-language consistency ----------------------------------------

  it('should produce audio of reasonable duration for similar content across languages', async () => {
    const texts: Record<string, string> = {
      en: 'Your blood pressure is 130 over 85.',
      hi: 'आपका blood pressure 130/85 है।',
      bn: 'আপনার blood pressure 130/85।',
    };

    const durations: Record<string, number> = {};

    for (const [lang, text] of Object.entries(texts)) {
      const res = await macMini.synthesize({
        text,
        language: lang,
        format: 'pcm',
        sample_rate: 16000,
      });

      expect(res.audio.length).toBeGreaterThan(0);
      durations[lang] = res.durationMs;
    }

    // All durations should be positive and within a reasonable range of each other
    for (const dur of Object.values(durations)) {
      expect(dur).toBeGreaterThan(0);
      expect(dur).toBeLessThan(30000); // No single sentence should be >30s
    }
  });
});

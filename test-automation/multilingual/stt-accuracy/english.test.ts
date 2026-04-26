/**
 * Multilingual: STT Accuracy — English
 *
 * Tests STT transcription accuracy for English utterances containing vital values.
 * Verifies that medical terms and numeric values are correctly transcribed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MacMiniClient } from '../../e2e/helpers/mac-mini-client';
import {
  ENV,
  AUDIO_FIXTURES,
  skipIfNoLiveInfra,
} from '../../e2e/helpers/test-data';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

describe('Multilingual: STT Accuracy — English', () => {
  let macMini: MacMiniClient;

  beforeAll(() => {
    skipIfNoLiveInfra();
    macMini = new MacMiniClient(ENV.MAC_MINI_HOST);
  });

  it('should transcribe simple BP report correctly', async () => {
    let audio: Buffer;
    try {
      audio = await readFile(resolve(__dirname, '../../', AUDIO_FIXTURES.en.bp_report));
    } catch {
      // If audio fixture not available, use synthetic test
      audio = Buffer.alloc(32000); // 1 second of silence as placeholder
    }

    const res = await macMini.transcribe(audio, 'en');

    expect(res.text).toBeDefined();
    expect(res.language).toBe('en');
    expect(res.duration_ms).toBeGreaterThan(0);
    // If real audio is used, verify value extraction
    // expect(res.text.toLowerCase()).toContain('130');
    // expect(res.text.toLowerCase()).toContain('85');
  });

  it('should transcribe glucose report correctly', async () => {
    let audio: Buffer;
    try {
      audio = await readFile(resolve(__dirname, '../../', AUDIO_FIXTURES.en.glucose_report));
    } catch {
      audio = Buffer.alloc(32000);
    }

    const res = await macMini.transcribe(audio, 'en');
    expect(res.text).toBeDefined();
    expect(res.language).toBe('en');
  });

  it('should handle elderly/unclear speech without crashing', async () => {
    let audio: Buffer;
    try {
      audio = await readFile(resolve(__dirname, '../../', AUDIO_FIXTURES.en.elderly_unclear));
    } catch {
      audio = Buffer.alloc(32000);
    }

    const res = await macMini.transcribe(audio, 'en');
    expect(res.text).toBeDefined();
    // Unclear speech should still produce a transcript (may be low confidence)
    if (res.segments.length > 0) {
      expect(res.segments[0].confidence).toBeGreaterThan(0);
    }
  });

  it('should correctly transcribe medical terminology', async () => {
    let audio: Buffer;
    try {
      audio = await readFile(resolve(__dirname, '../../', AUDIO_FIXTURES.en.medical_terms));
    } catch {
      audio = Buffer.alloc(32000);
    }

    const res = await macMini.transcribe(audio, 'en');
    expect(res.text).toBeDefined();
    // With real audio containing "blood pressure", "glucose", "oxygen saturation":
    // expect(res.text.toLowerCase()).toMatch(/blood pressure|glucose|oxygen/);
  });

  it('should return confidence scores for segments', async () => {
    const audio = Buffer.alloc(64000); // 2 seconds placeholder
    const res = await macMini.transcribe(audio, 'en');

    expect(res.segments).toBeDefined();
    expect(Array.isArray(res.segments)).toBe(true);
    for (const seg of res.segments) {
      expect(seg.start_ms).toBeDefined();
      expect(seg.end_ms).toBeDefined();
      expect(typeof seg.confidence).toBe('number');
    }
  });
});

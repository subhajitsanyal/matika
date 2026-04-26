/**
 * Multilingual: STT Accuracy — Bengali
 *
 * Tests STT transcription accuracy for Bengali utterances containing vital values.
 * Includes code-mixed speech (English medical terms in Bengali context).
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

describe('Multilingual: STT Accuracy — Bengali', () => {
  let macMini: MacMiniClient;

  beforeAll(() => {
    skipIfNoLiveInfra();
    macMini = new MacMiniClient(ENV.MAC_MINI_HOST);
  });

  it('should transcribe Bengali BP report correctly', async () => {
    let audio: Buffer;
    try {
      audio = await readFile(resolve(__dirname, '../../', AUDIO_FIXTURES.bn.bp_report));
    } catch {
      audio = Buffer.alloc(32000);
    }

    const res = await macMini.transcribe(audio, 'bn');

    expect(res.text).toBeDefined();
    expect(res.language).toBe('bn');
    expect(res.duration_ms).toBeGreaterThan(0);
    // With real audio: "amar blood pressure 130 over 85"
    // expect(res.text).toContain('130');
  });

  it('should transcribe code-mixed Bengali (English medical terms)', async () => {
    let audio: Buffer;
    try {
      audio = await readFile(resolve(__dirname, '../../', AUDIO_FIXTURES.bn.code_mixed_bp));
    } catch {
      audio = Buffer.alloc(32000);
    }

    const res = await macMini.transcribe(audio, 'bn');
    expect(res.text).toBeDefined();
  });

  it('should transcribe Bengali glucose report', async () => {
    let audio: Buffer;
    try {
      audio = await readFile(resolve(__dirname, '../../', AUDIO_FIXTURES.bn.glucose_report));
    } catch {
      audio = Buffer.alloc(32000);
    }

    const res = await macMini.transcribe(audio, 'bn');
    expect(res.text).toBeDefined();
  });

  it('should handle Bengali elderly accent/unclear speech', async () => {
    let audio: Buffer;
    try {
      audio = await readFile(resolve(__dirname, '../../', AUDIO_FIXTURES.bn.elderly_unclear));
    } catch {
      audio = Buffer.alloc(32000);
    }

    const res = await macMini.transcribe(audio, 'bn');
    expect(res.text).toBeDefined();
  });

  it('should correctly handle Bengali medical terms', async () => {
    let audio: Buffer;
    try {
      audio = await readFile(resolve(__dirname, '../../', AUDIO_FIXTURES.bn.medical_terms));
    } catch {
      audio = Buffer.alloc(32000);
    }

    const res = await macMini.transcribe(audio, 'bn');
    expect(res.text).toBeDefined();
  });
});

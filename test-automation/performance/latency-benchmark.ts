/**
 * Latency Benchmark — Pipeline Timing (t0-t7)
 *
 * Runs N turns against Mac Mini services, measuring per-component and total
 * latency. Captures timestamps at each pipeline stage:
 *
 *   t0 = user finishes speaking (simulated)
 *   t1 = STT request sent
 *   t2 = STT response received
 *   t3 = LLM request sent
 *   t4 = LLM response received
 *   t5 = TTS request sent
 *   t6 = TTS first audio byte received
 *   t7 = audio playback begins (simulated as t6 + small buffer)
 *
 * Usage:
 *   CARELOG_MAC_MINI_HOST=192.168.1.100 tsx performance/latency-benchmark.ts
 *   CARELOG_BENCHMARK_TURNS=50 tsx performance/latency-benchmark.ts
 */

import { MacMiniClient, LlmSessionCreateRequest } from '../e2e/helpers/mac-mini-client';
import {
  ENV,
  PARAM_BLOOD_PRESSURE,
  PARAM_BLOOD_GLUCOSE,
  SYSTEM_PROMPTS,
  UTTERANCES,
} from '../e2e/helpers/test-data';
import { writeFile, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const NUM_TURNS = parseInt(process.env.CARELOG_BENCHMARK_TURNS ?? '100', 10);
const LANGUAGES: Array<'en' | 'hi' | 'bn'> = ['en', 'hi', 'bn'];
const OUTPUT_DIR = resolve(__dirname, '../results/performance');

// Varied utterances to simulate different lengths (3-15 seconds of speech)
const VARIED_UTTERANCES: Record<string, string[]> = {
  en: [
    'my blood pressure is 130 over 85',
    'yes that is correct',
    'my sugar level is 140',
    'I checked it this morning and the reading was 128 over 82',
    'the glucose meter showed 145 milligrams per deciliter after breakfast today',
    'no that is wrong it should be 125',
  ],
  hi: [
    'mera blood pressure 130 over 85 hai',
    'haan sahi hai',
    'mera sugar level 140 hai',
    'maine subah check kiya tha aur reading 128 over 82 aayi thi',
    'glucose meter mein breakfast ke baad 145 mg/dL aaya aaj',
    'nahi yeh galat hai 125 hona chahiye',
  ],
  bn: [
    'amar blood pressure 130 over 85',
    'hyan eita thik achhe',
    'amar sugar level 140',
    'ami sokal e check korechi ar reading 128 over 82 eshechhe',
    'glucose meter e breakfast er pore 145 mg/dL esheche aaj',
    'na eita bhul 125 howa uchit',
  ],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TurnTiming {
  turn_index: number;
  language: string;
  utterance_length: number;
  t0: number;
  t1: number;
  t2: number;
  t3: number;
  t4: number;
  t5: number;
  t6: number;
  t7: number;
  stt_latency_ms: number;
  llm_latency_ms: number;
  tts_latency_ms: number;
  total_latency_ms: number;
  error: string | null;
}

interface BenchmarkResult {
  timestamp: string;
  mac_mini_host: string;
  num_turns: number;
  languages: string[];
  timings: TurnTiming[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runBenchmark(): Promise<void> {
  console.log(`\n=== CareLog Latency Benchmark ===`);
  console.log(`Mac Mini host: ${ENV.MAC_MINI_HOST}`);
  console.log(`Turns per language: ${NUM_TURNS}`);
  console.log(`Languages: ${LANGUAGES.join(', ')}`);
  console.log('');

  const macMini = new MacMiniClient(ENV.MAC_MINI_HOST);

  // Verify health
  const healthy = await macMini.isHealthy();
  if (!healthy) {
    console.error('ERROR: Mac Mini is not healthy. Aborting benchmark.');
    process.exit(1);
  }
  console.log('Mac Mini health check: OK\n');

  const allTimings: TurnTiming[] = [];

  for (const language of LANGUAGES) {
    console.log(`--- Language: ${language} ---`);

    // Create a session for this language
    const patientId = uuidv4();
    const request: LlmSessionCreateRequest = {
      session_type: 'patient_logging',
      patient_id: patientId,
      language,
      config: {
        parameters: [PARAM_BLOOD_PRESSURE, PARAM_BLOOD_GLUCOSE],
        system_prompt: SYSTEM_PROMPTS.patient_logging,
        patient_name: language === 'en' ? 'John' : language === 'hi' ? 'Ramesh' : 'Sunil',
      },
    };

    const utterances = VARIED_UTTERANCES[language];
    let turnNumber = 1;

    // We'll create fresh sessions every 10 turns to avoid session state buildup
    const TURNS_PER_SESSION = 10;

    for (let i = 0; i < NUM_TURNS; i++) {
      if (i % TURNS_PER_SESSION === 0 && i > 0) {
        // End previous session, start new one
        try {
          await macMini.endSession(request.patient_id, 'user_stopped');
        } catch { /* ok */ }
        request.patient_id = uuidv4();
        turnNumber = 1;
      }

      let sessionId: string;
      if (i % TURNS_PER_SESSION === 0) {
        const sessionRes = await macMini.createSession(request);
        sessionId = sessionRes.session_id;
        turnNumber = 2;
        // Store session ID for subsequent turns
        (request as unknown as Record<string, unknown>)._currentSessionId = sessionRes.session_id;
      } else {
        sessionId = (request as unknown as Record<string, unknown>)._currentSessionId as string;
        turnNumber++;
      }

      const utterance = utterances[i % utterances.length];
      const timing: TurnTiming = {
        turn_index: i,
        language,
        utterance_length: utterance.length,
        t0: 0, t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, t6: 0, t7: 0,
        stt_latency_ms: 0,
        llm_latency_ms: 0,
        tts_latency_ms: 0,
        total_latency_ms: 0,
        error: null,
      };

      try {
        // Simulate t0: user finishes speaking
        timing.t0 = performance.now();

        // STT phase: simulate sending audio and getting transcript
        timing.t1 = performance.now();
        const sttAudio = Buffer.alloc(16000 * 2 * 3); // 3 seconds of silence
        await macMini.transcribe(sttAudio, language);
        timing.t2 = performance.now();

        // LLM phase: send transcript to LLM
        timing.t3 = performance.now();
        const llmRes = await macMini.sendUtterance(sessionId, {
          text: utterance,
          turn_number: turnNumber,
        });
        timing.t4 = performance.now();

        // TTS phase: synthesize response
        timing.t5 = performance.now();
        const ttsRes = await macMini.synthesize({
          text: llmRes.response_text,
          language,
          format: 'pcm',
          sample_rate: 16000,
        });
        timing.t6 = performance.now();

        // t7: audio playback begins (simulated as t6 + buffer processing)
        timing.t7 = timing.t6 + 10; // ~10ms for buffer setup

        timing.stt_latency_ms = Math.round(timing.t2 - timing.t1);
        timing.llm_latency_ms = Math.round(timing.t4 - timing.t3);
        timing.tts_latency_ms = Math.round(timing.t6 - timing.t5);
        timing.total_latency_ms = Math.round(timing.t7 - timing.t0);
      } catch (err: unknown) {
        timing.error = err instanceof Error ? err.message : String(err);
      }

      allTimings.push(timing);

      if ((i + 1) % 10 === 0) {
        const successCount = allTimings.filter(
          (t) => t.language === language && !t.error,
        ).length;
        console.log(`  Turn ${i + 1}/${NUM_TURNS} (${successCount} successful)`);
      }
    }

    // End final session
    try {
      const sid = (request as unknown as Record<string, unknown>)._currentSessionId as string;
      if (sid) await macMini.endSession(sid, 'user_stopped');
    } catch { /* ok */ }
  }

  // Write results
  const result: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    mac_mini_host: ENV.MAC_MINI_HOST,
    num_turns: NUM_TURNS,
    languages: LANGUAGES,
    timings: allTimings,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = resolve(OUTPUT_DIR, `benchmark-${Date.now()}.json`);
  await writeFile(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nResults written to: ${outputPath}`);

  // Quick summary
  for (const lang of LANGUAGES) {
    const langTimings = allTimings.filter((t) => t.language === lang && !t.error);
    if (langTimings.length === 0) {
      console.log(`\n${lang}: No successful turns`);
      continue;
    }

    const totals = langTimings.map((t) => t.total_latency_ms).sort((a, b) => a - b);
    const p50 = totals[Math.floor(totals.length * 0.5)];
    const p95 = totals[Math.floor(totals.length * 0.95)];
    const p99 = totals[Math.floor(totals.length * 0.99)];

    console.log(`\n${lang.toUpperCase()}: ${langTimings.length} turns`);
    console.log(`  Total latency — P50: ${p50}ms, P95: ${p95}ms, P99: ${p99}ms`);
    console.log(`  Target P95 < 2000ms: ${p95 < 2000 ? 'PASS' : 'FAIL'}`);
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

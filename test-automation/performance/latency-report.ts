/**
 * Latency Report Generator
 *
 * Reads raw benchmark timing data and computes P50, P95, P99 for each
 * component (STT, LLM, TTS) and total latency. Compares against targets
 * and flags components exceeding budget.
 *
 * Usage:
 *   tsx performance/latency-report.ts [path-to-benchmark.json]
 *
 * If no path is given, reads the most recent benchmark from results/performance/.
 */

import { readFile, readdir } from 'fs/promises';
import { resolve } from 'path';
import { writeFile } from 'fs/promises';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TurnTiming {
  turn_index: number;
  language: string;
  utterance_length: number;
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

interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  count: number;
}

interface ComponentReport {
  stt: Percentiles;
  llm: Percentiles;
  tts: Percentiles;
  total: Percentiles;
}

interface LanguageReport {
  language: string;
  turn_count: number;
  error_count: number;
  components: ComponentReport;
  budget_check: {
    total_p95_target_ms: number;
    total_p95_actual_ms: number;
    pass: boolean;
    bottleneck: string | null;
  };
}

interface FullReport {
  generated_at: string;
  benchmark_timestamp: string;
  mac_mini_host: string;
  total_turns: number;
  languages: LanguageReport[];
  overall_pass: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computePercentiles(values: number[]): Percentiles {
  if (values.length === 0) {
    return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0, count: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round(sum / sorted.length),
    count: sorted.length,
  };
}

const LATENCY_BUDGETS = {
  stt_p95_ms: 800,
  llm_p95_ms: 600,
  tts_p95_ms: 400,
  total_p95_ms: 2000,
};

function identifyBottleneck(components: ComponentReport): string | null {
  const overBudget: Array<{ name: string; overage: number }> = [];

  if (components.stt.p95 > LATENCY_BUDGETS.stt_p95_ms) {
    overBudget.push({ name: 'STT', overage: components.stt.p95 - LATENCY_BUDGETS.stt_p95_ms });
  }
  if (components.llm.p95 > LATENCY_BUDGETS.llm_p95_ms) {
    overBudget.push({ name: 'LLM', overage: components.llm.p95 - LATENCY_BUDGETS.llm_p95_ms });
  }
  if (components.tts.p95 > LATENCY_BUDGETS.tts_p95_ms) {
    overBudget.push({ name: 'TTS', overage: components.tts.p95 - LATENCY_BUDGETS.tts_p95_ms });
  }

  if (overBudget.length === 0) return null;

  overBudget.sort((a, b) => b.overage - a.overage);
  return overBudget[0].name;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function generateReport(): Promise<void> {
  // Find input file
  let inputPath = process.argv[2];
  if (!inputPath) {
    const resultsDir = resolve(__dirname, '../results/performance');
    const files = await readdir(resultsDir).catch(() => []);
    const benchmarkFiles = files
      .filter((f) => f.startsWith('benchmark-') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (benchmarkFiles.length === 0) {
      console.error('No benchmark results found. Run latency-benchmark.ts first.');
      process.exit(1);
    }
    inputPath = resolve(resultsDir, benchmarkFiles[0]);
  }

  console.log(`Reading benchmark data from: ${inputPath}\n`);
  const raw = await readFile(inputPath, 'utf-8');
  const benchmark: BenchmarkResult = JSON.parse(raw);

  const languageReports: LanguageReport[] = [];

  for (const lang of benchmark.languages) {
    const langTimings = benchmark.timings.filter((t) => t.language === lang);
    const successTimings = langTimings.filter((t) => !t.error);
    const errorCount = langTimings.length - successTimings.length;

    const components: ComponentReport = {
      stt: computePercentiles(successTimings.map((t) => t.stt_latency_ms)),
      llm: computePercentiles(successTimings.map((t) => t.llm_latency_ms)),
      tts: computePercentiles(successTimings.map((t) => t.tts_latency_ms)),
      total: computePercentiles(successTimings.map((t) => t.total_latency_ms)),
    };

    const totalP95Pass = components.total.p95 < LATENCY_BUDGETS.total_p95_ms;

    languageReports.push({
      language: lang,
      turn_count: langTimings.length,
      error_count: errorCount,
      components,
      budget_check: {
        total_p95_target_ms: LATENCY_BUDGETS.total_p95_ms,
        total_p95_actual_ms: components.total.p95,
        pass: totalP95Pass,
        bottleneck: totalP95Pass ? null : identifyBottleneck(components),
      },
    });
  }

  const overallPass = languageReports.every((r) => r.budget_check.pass);

  const fullReport: FullReport = {
    generated_at: new Date().toISOString(),
    benchmark_timestamp: benchmark.timestamp,
    mac_mini_host: benchmark.mac_mini_host,
    total_turns: benchmark.timings.length,
    languages: languageReports,
    overall_pass: overallPass,
  };

  // Print report
  console.log('=== CARELOG LATENCY BENCHMARK REPORT ===\n');
  console.log(`Benchmark run: ${benchmark.timestamp}`);
  console.log(`Mac Mini host: ${benchmark.mac_mini_host}`);
  console.log(`Total turns: ${benchmark.timings.length}\n`);

  console.log(`Latency budgets (P95):`);
  console.log(`  STT:   ${LATENCY_BUDGETS.stt_p95_ms}ms`);
  console.log(`  LLM:   ${LATENCY_BUDGETS.llm_p95_ms}ms`);
  console.log(`  TTS:   ${LATENCY_BUDGETS.tts_p95_ms}ms`);
  console.log(`  Total: ${LATENCY_BUDGETS.total_p95_ms}ms\n`);

  for (const lr of languageReports) {
    console.log(`--- ${lr.language.toUpperCase()} (${lr.turn_count} turns, ${lr.error_count} errors) ---`);
    console.log('');

    const cols = ['', 'P50', 'P95', 'P99', 'Min', 'Max', 'Mean'];
    const rows = [
      ['STT', lr.components.stt],
      ['LLM', lr.components.llm],
      ['TTS', lr.components.tts],
      ['TOTAL', lr.components.total],
    ] as [string, Percentiles][];

    console.log(`  ${'Component'.padEnd(8)} ${'P50'.padStart(7)} ${'P95'.padStart(7)} ${'P99'.padStart(7)} ${'Min'.padStart(7)} ${'Max'.padStart(7)} ${'Mean'.padStart(7)}`);
    console.log(`  ${'--------'.padEnd(8)} ${'---'.padStart(7)} ${'---'.padStart(7)} ${'---'.padStart(7)} ${'---'.padStart(7)} ${'---'.padStart(7)} ${'----'.padStart(7)}`);

    for (const [name, p] of rows) {
      console.log(
        `  ${name.padEnd(8)} ${String(p.p50).padStart(7)} ${String(p.p95).padStart(7)} ${String(p.p99).padStart(7)} ${String(p.min).padStart(7)} ${String(p.max).padStart(7)} ${String(p.mean).padStart(7)}`,
      );
    }

    console.log('');
    const status = lr.budget_check.pass ? 'PASS' : 'FAIL';
    console.log(`  P95 Total: ${lr.budget_check.total_p95_actual_ms}ms (target: ${lr.budget_check.total_p95_target_ms}ms) — ${status}`);
    if (lr.budget_check.bottleneck) {
      console.log(`  Bottleneck: ${lr.budget_check.bottleneck}`);
    }
    console.log('');
  }

  console.log(`\n=== OVERALL: ${overallPass ? 'PASS' : 'FAIL'} ===\n`);

  // Write JSON report
  const outputDir = resolve(__dirname, '../results/performance');
  const reportPath = resolve(outputDir, `report-${Date.now()}.json`);
  await writeFile(reportPath, JSON.stringify(fullReport, null, 2));
  console.log(`JSON report written to: ${reportPath}`);

  if (!overallPass) {
    process.exit(1);
  }
}

generateReport().catch((err) => {
  console.error('Report generation failed:', err);
  process.exit(1);
});

/**
 * Pilot: Feedback Collector & Analyzer
 *
 * Reads pilot feedback JSON files, aggregates scores, identifies common issues,
 * generates summary reports, and tracks day-over-day trends.
 *
 * Usage:
 *   npx tsx pilot/feedback-collector.ts --dir ./pilot/feedback-data/
 *   npx tsx pilot/feedback-collector.ts --dir ./pilot/feedback-data/ --output ./pilot/reports/
 */

import { readdir, readFile, mkdir, writeFile } from 'fs/promises';
import { resolve, join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedbackEntry {
  date: string;
  user_id: string;
  role: 'patient' | 'caregiver' | 'doctor';
  language: string;
  daily_usage: {
    used_today: boolean;
    session_count: number;
    total_minutes: number;
  };
  voice_quality: {
    understanding: number;
    response_quality: number;
    naturalness: number;
    pronunciation: number;
  };
  value_accuracy: {
    accuracy: string;
    corrections_needed: number;
    total_readings: number;
    problematic_values: string[];
  };
  language_quality: {
    understanding: string;
    struggled_words: string[];
    used_mixed_language: boolean;
    mixed_language_rating: number;
  };
  speed: {
    fast_enough: string;
    delay_frequency: string;
    delay_location: string;
  };
  overall: {
    ease_start_session: number;
    ease_report_vitals: number;
    ease_review_history: number;
    overall_satisfaction: number;
    would_recommend: string;
  };
  open_feedback: {
    what_worked: string;
    what_frustrated: string;
    feature_request: string;
  };
  bugs: Array<{
    description: string;
    steps: string;
    severity: string;
  }>;
}

interface AggregateStats {
  count: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeStats(values: number[]): AggregateStats {
  if (values.length === 0) {
    return { count: 0, mean: 0, min: 0, max: 0, p50: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    mean: Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: sorted[Math.floor(sorted.length / 2)],
  };
}

function countKeywords(texts: string[], minFrequency = 2): Array<{ word: string; count: number }> {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'was', 'it', 'to', 'and', 'of', 'in', 'for',
    'that', 'with', 'on', 'at', 'by', 'this', 'from', 'but', 'not', 'or',
    'i', 'my', 'me', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
    'did', 'does', 'do', 'had', 'has', 'have', 'been', 'be', 'are', 'were',
    'very', 'too', 'also', 'just', 'more', 'some', 'when', 'than', 'then',
  ]);

  const wordCounts = new Map<string, number>();

  for (const text of texts) {
    if (!text) continue;
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
  }

  return Array.from(wordCounts.entries())
    .filter(([_, count]) => count >= minFrequency)
    .sort((a, b) => b[1] - a[1])
    .map(([word, count]) => ({ word, count }));
}

// ---------------------------------------------------------------------------
// Data Loading
// ---------------------------------------------------------------------------

async function loadFeedback(dir: string): Promise<FeedbackEntry[]> {
  const entries: FeedbackEntry[] = [];

  try {
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    for (const file of jsonFiles) {
      try {
        const content = await readFile(join(dir, file), 'utf-8');
        const data = JSON.parse(content);

        // Support both single entries and arrays
        if (Array.isArray(data)) {
          entries.push(...data);
        } else {
          entries.push(data);
        }
      } catch (err) {
        console.warn(`Warning: Could not parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    console.error(`Error reading feedback directory: ${err instanceof Error ? err.message : String(err)}`);
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function analyzeVoiceQuality(entries: FeedbackEntry[]): Record<string, AggregateStats> {
  return {
    understanding: computeStats(entries.map((e) => e.voice_quality.understanding).filter(Boolean)),
    response_quality: computeStats(entries.map((e) => e.voice_quality.response_quality).filter(Boolean)),
    naturalness: computeStats(entries.map((e) => e.voice_quality.naturalness).filter(Boolean)),
    pronunciation: computeStats(entries.map((e) => e.voice_quality.pronunciation).filter(Boolean)),
  };
}

function analyzeOverall(entries: FeedbackEntry[]): Record<string, AggregateStats> {
  return {
    ease_start_session: computeStats(entries.map((e) => e.overall.ease_start_session).filter(Boolean)),
    ease_report_vitals: computeStats(entries.map((e) => e.overall.ease_report_vitals).filter(Boolean)),
    ease_review_history: computeStats(entries.map((e) => e.overall.ease_review_history).filter(Boolean)),
    overall_satisfaction: computeStats(entries.map((e) => e.overall.overall_satisfaction).filter(Boolean)),
  };
}

function analyzeValueAccuracy(entries: FeedbackEntry[]): {
  accuracyDistribution: Record<string, number>;
  correctionRate: number;
  problematicValues: Array<{ value: string; count: number }>;
} {
  const accuracyDist: Record<string, number> = {};
  let totalCorrections = 0;
  let totalReadings = 0;
  const valueCounts = new Map<string, number>();

  for (const entry of entries) {
    const acc = entry.value_accuracy.accuracy;
    accuracyDist[acc] = (accuracyDist[acc] ?? 0) + 1;
    totalCorrections += entry.value_accuracy.corrections_needed ?? 0;
    totalReadings += entry.value_accuracy.total_readings ?? 0;

    for (const v of entry.value_accuracy.problematic_values ?? []) {
      valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1);
    }
  }

  return {
    accuracyDistribution: accuracyDist,
    correctionRate: totalReadings > 0
      ? Math.round((totalCorrections / totalReadings) * 100 * 10) / 10
      : 0,
    problematicValues: Array.from(valueCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count })),
  };
}

function analyzeBugs(entries: FeedbackEntry[]): {
  totalBugs: number;
  bySeverity: Record<string, number>;
  commonKeywords: Array<{ word: string; count: number }>;
} {
  const allBugs = entries.flatMap((e) => e.bugs ?? []);
  const bySeverity: Record<string, number> = {};

  for (const bug of allBugs) {
    const sev = (bug.severity ?? 'unknown').toLowerCase();
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
  }

  const bugTexts = allBugs.map((b) => b.description);

  return {
    totalBugs: allBugs.length,
    bySeverity,
    commonKeywords: countKeywords(bugTexts),
  };
}

function analyzeTrends(entries: FeedbackEntry[]): Array<{
  date: string;
  responses: number;
  avgSatisfaction: number;
  avgVoiceQuality: number;
  bugCount: number;
}> {
  // Group by date
  const byDate = new Map<string, FeedbackEntry[]>();
  for (const entry of entries) {
    const date = entry.date;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(entry);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayEntries]) => {
      const satisfactionScores = dayEntries
        .map((e) => e.overall.overall_satisfaction)
        .filter(Boolean);
      const voiceScores = dayEntries
        .map((e) => {
          const vq = e.voice_quality;
          return (
            (vq.understanding + vq.response_quality + vq.naturalness + vq.pronunciation) / 4
          );
        })
        .filter(Boolean);
      const bugs = dayEntries.flatMap((e) => e.bugs ?? []);

      return {
        date,
        responses: dayEntries.length,
        avgSatisfaction:
          satisfactionScores.length > 0
            ? Math.round(
                (satisfactionScores.reduce((s, v) => s + v, 0) /
                  satisfactionScores.length) *
                  100,
              ) / 100
            : 0,
        avgVoiceQuality:
          voiceScores.length > 0
            ? Math.round(
                (voiceScores.reduce((s, v) => s + v, 0) / voiceScores.length) * 100,
              ) / 100
            : 0,
        bugCount: bugs.length,
      };
    });
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

function generateReport(entries: FeedbackEntry[]): string {
  const lines: string[] = [];

  lines.push('=== CareLog Pilot Feedback Report ===');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total responses: ${entries.length}`);
  lines.push('');

  // Breakdown by role
  const byRole: Record<string, number> = {};
  for (const e of entries) {
    byRole[e.role] = (byRole[e.role] ?? 0) + 1;
  }
  lines.push('--- Responses by Role ---');
  for (const [role, count] of Object.entries(byRole)) {
    lines.push(`  ${role}: ${count}`);
  }
  lines.push('');

  // Breakdown by language
  const byLang: Record<string, number> = {};
  for (const e of entries) {
    byLang[e.language] = (byLang[e.language] ?? 0) + 1;
  }
  lines.push('--- Responses by Language ---');
  for (const [lang, count] of Object.entries(byLang)) {
    lines.push(`  ${lang}: ${count}`);
  }
  lines.push('');

  // Voice quality
  lines.push('--- Voice Interaction Quality (1-5 scale) ---');
  const voiceStats = analyzeVoiceQuality(entries);
  for (const [metric, stats] of Object.entries(voiceStats)) {
    lines.push(`  ${metric}: mean=${stats.mean}, min=${stats.min}, max=${stats.max}, p50=${stats.p50} (n=${stats.count})`);
  }
  lines.push('');

  // Overall experience
  lines.push('--- Overall Experience (1-5 scale) ---');
  const overallStats = analyzeOverall(entries);
  for (const [metric, stats] of Object.entries(overallStats)) {
    lines.push(`  ${metric}: mean=${stats.mean}, min=${stats.min}, max=${stats.max}, p50=${stats.p50} (n=${stats.count})`);
  }
  lines.push('');

  // Value accuracy
  lines.push('--- Value Accuracy ---');
  const accuracy = analyzeValueAccuracy(entries);
  lines.push(`  Correction rate: ${accuracy.correctionRate}%`);
  lines.push('  Accuracy distribution:');
  for (const [level, count] of Object.entries(accuracy.accuracyDistribution)) {
    lines.push(`    ${level}: ${count}`);
  }
  if (accuracy.problematicValues.length > 0) {
    lines.push('  Most problematic values:');
    for (const v of accuracy.problematicValues.slice(0, 5)) {
      lines.push(`    ${v.value}: reported ${v.count} times`);
    }
  }
  lines.push('');

  // Speed perception
  lines.push('--- Speed Perception ---');
  const speedDist: Record<string, number> = {};
  const delayDist: Record<string, number> = {};
  for (const e of entries) {
    speedDist[e.speed.fast_enough] = (speedDist[e.speed.fast_enough] ?? 0) + 1;
    delayDist[e.speed.delay_frequency] = (delayDist[e.speed.delay_frequency] ?? 0) + 1;
  }
  lines.push('  Fast enough?');
  for (const [answer, count] of Object.entries(speedDist)) {
    lines.push(`    ${answer}: ${count}`);
  }
  lines.push('  Delay frequency:');
  for (const [freq, count] of Object.entries(delayDist)) {
    lines.push(`    ${freq}: ${count}`);
  }
  lines.push('');

  // Common issues from open feedback
  lines.push('--- Common Issues (keyword frequency in frustrations) ---');
  const frustrationTexts = entries.map((e) => e.open_feedback.what_frustrated).filter(Boolean);
  const keywords = countKeywords(frustrationTexts, 1);
  for (const kw of keywords.slice(0, 10)) {
    lines.push(`  "${kw.word}": mentioned ${kw.count} times`);
  }
  lines.push('');

  // Bug summary
  lines.push('--- Bug Summary ---');
  const bugAnalysis = analyzeBugs(entries);
  lines.push(`  Total bugs reported: ${bugAnalysis.totalBugs}`);
  lines.push('  By severity:');
  for (const [sev, count] of Object.entries(bugAnalysis.bySeverity)) {
    lines.push(`    ${sev}: ${count}`);
  }
  if (bugAnalysis.commonKeywords.length > 0) {
    lines.push('  Common bug keywords:');
    for (const kw of bugAnalysis.commonKeywords.slice(0, 5)) {
      lines.push(`    "${kw.word}": ${kw.count}`);
    }
  }
  lines.push('');

  // Day-over-day trends
  lines.push('--- Day-over-Day Trends ---');
  const trends = analyzeTrends(entries);
  lines.push('  Date       | Responses | Satisfaction | Voice Quality | Bugs');
  lines.push('  -----------|-----------|-------------|---------------|-----');
  for (const day of trends) {
    lines.push(
      `  ${day.date} | ${String(day.responses).padStart(9)} | ${String(day.avgSatisfaction).padStart(11)} | ${String(day.avgVoiceQuality).padStart(13)} | ${day.bugCount}`,
    );
  }
  lines.push('');

  // Recommendation rate
  const recDist: Record<string, number> = {};
  for (const e of entries) {
    recDist[e.overall.would_recommend] = (recDist[e.overall.would_recommend] ?? 0) + 1;
  }
  lines.push('--- Would Recommend ---');
  for (const [answer, count] of Object.entries(recDist)) {
    const pct = Math.round((count / entries.length) * 100);
    lines.push(`  ${answer}: ${count} (${pct}%)`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dirIdx = process.argv.indexOf('--dir');
  const feedbackDir = dirIdx !== -1 && process.argv[dirIdx + 1]
    ? resolve(process.argv[dirIdx + 1])
    : resolve(__dirname, 'feedback-data');

  const outputIdx = process.argv.indexOf('--output');
  const outputDir = outputIdx !== -1 && process.argv[outputIdx + 1]
    ? resolve(process.argv[outputIdx + 1])
    : null;

  console.log(`Loading feedback from: ${feedbackDir}\n`);

  const entries = await loadFeedback(feedbackDir);

  if (entries.length === 0) {
    console.log('No feedback entries found.');
    console.log(`Place JSON feedback files in: ${feedbackDir}`);
    console.log('See feedback-template.md for the expected JSON format.');
    return;
  }

  console.log(`Loaded ${entries.length} feedback entries.\n`);

  const report = generateReport(entries);
  console.log(report);

  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = join(outputDir, `feedback-report-${timestamp}.txt`);
    await writeFile(reportPath, report, 'utf-8');
    console.log(`\nReport saved to: ${reportPath}`);

    // Also save raw aggregated data as JSON
    const jsonPath = join(outputDir, `feedback-data-${timestamp}.json`);
    const jsonData = {
      generated: new Date().toISOString(),
      totalResponses: entries.length,
      voiceQuality: analyzeVoiceQuality(entries),
      overall: analyzeOverall(entries),
      valueAccuracy: analyzeValueAccuracy(entries),
      bugs: analyzeBugs(entries),
      trends: analyzeTrends(entries),
    };
    await writeFile(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
    console.log(`Data saved to: ${jsonPath}`);
  }
}

main().catch((err) => {
  console.error('Feedback collection failed:', err);
  process.exit(1);
});

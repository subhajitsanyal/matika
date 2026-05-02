// Per-patient context renderer.
// Spec §6.3: ~1K-token block, patient-keyed, separately cached from the
// system prompt. Owned by backend (rendering) per AGENTS.md §3.1.
// Content shape (what to include) was specified by inference-platform.

import type {
  PatientContext,
  ParameterConfig,
  PatientTopic,
  SessionSummary,
  Recommendation,
  PatientProfile,
} from './types';

const CACHE_BREAKPOINT = '<!-- CACHE_BREAKPOINT -->';

export function renderPatientContext(ctx: PatientContext): string {
  const sections = [
    renderPatient(ctx.patient),
    renderProtocol(ctx.protocol),
    renderTopics(ctx.topics),
    renderRecentSessions(ctx.recentSessions),
    renderRecommendations(ctx.pendingRecommendations),
  ];
  return `${sections.join('\n\n')}\n\n${CACHE_BREAKPOINT}`;
}

function renderPatient(p: PatientProfile): string {
  const lines = [
    '## Patient',
    '',
    `- Name: ${p.name}`,
    `- Age: ${p.age}`,
    `- Gender: ${p.gender}`,
    `- Primary language: ${p.primaryLanguage}`,
    `- Conditions: ${p.conditions.length > 0 ? p.conditions.join(', ') : '(none recorded)'}`,
  ];
  if (p.medicalHistorySummary) {
    lines.push(`- Medical history: ${p.medicalHistorySummary}`);
  }
  return lines.join('\n');
}

function renderProtocol(configs: ParameterConfig[]): string {
  const active = configs.filter((c) => c.active);
  if (active.length === 0) {
    return '## Active monitoring protocol\n\n_(none configured)_';
  }
  const header = ['## Active monitoring protocol', '', '| Parameter | LOINC | Unit | Frequency | Daily deadline | Thresholds | Set by |', '|---|---|---|---|---|---|---|'];
  const rows = active.map((c) => {
    const thresholds = formatThresholdRange(c.thresholdMin, c.thresholdMax, c.unit);
    const freq = formatFrequency(c.frequencyDays);
    const setBy = c.thresholdSetBy ?? '—';
    return `| ${c.parameterName} | ${c.loincCode} | ${c.unit} | ${freq} | ${c.dailyDeadline} ${c.timezone} | ${thresholds} | ${setBy} |`;
  });
  return [...header, ...rows].join('\n');
}

function formatFrequency(days: number): string {
  if (days <= 0) return 'invalid';
  if (days === 1) return 'every day';
  return `every ${days} days`;
}

function formatThresholdRange(min: number | null, max: number | null, unit: string): string {
  if (min === null && max === null) return '—';
  const lo = min === null ? '−∞' : String(min);
  const hi = max === null ? '+∞' : String(max);
  return `${lo}–${hi} ${unit}`.trim();
}

function renderTopics(topics: PatientTopic[]): string {
  if (topics.length === 0) {
    return '## Active topics\n\n_(none tracked)_';
  }
  const lines: string[] = ['## Active topics', ''];
  for (const t of topics) {
    const summary = t.summary ? ` — ${t.summary}` : '';
    lines.push(`- **${t.topicName}** (${t.status})${summary}`);
  }
  return lines.join('\n');
}

function renderRecentSessions(sessions: SessionSummary[]): string {
  if (sessions.length === 0) {
    return '## Recent sessions\n\n_(no prior sessions)_';
  }
  const lines: string[] = ['## Recent sessions', ''];
  for (const s of sessions) {
    const date = formatDate(s.startedAt);
    const captured = formatCaptured(s);
    lines.push(`- ${date} ${s.sessionType} (${s.language}): ${captured}`);
  }
  return lines.join('\n');
}

function formatDate(d: Date): string {
  // YYYY-MM-DD in UTC for stable rendering across timezones.
  return d.toISOString().slice(0, 10);
}

function formatCaptured(s: SessionSummary): string {
  if (s.status === 'incomplete') {
    const reason = s.incompleteReason ? `incomplete — ${s.incompleteReason}` : 'incomplete';
    return reason;
  }
  if (s.capturedValues.length === 0) return 'complete (no values captured)';
  const values = s.capturedValues
    .map((v) => `${v.parameter} ${v.value} ${v.unit}`)
    .join(', ');
  return `captured ${values}`;
}

function renderRecommendations(recs: Recommendation[]): string {
  if (recs.length === 0) {
    return '## Pending recommendations\n\n_(none)_';
  }
  const lines: string[] = ['## Pending recommendations', ''];
  for (const r of recs) {
    const intro = r.requiresGentleIntroduction ? ' (introduce gently to patient)' : '';
    const freq = r.suggestedFrequencyDays !== null ? ` Suggested frequency: ${formatFrequency(r.suggestedFrequencyDays)}.` : '';
    lines.push(`- **${r.source}** recommends **${r.parameterName}**.${intro} Rationale: ${r.rationale}.${freq}`);
  }
  return lines.join('\n');
}

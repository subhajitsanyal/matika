// Pre-model regex extractor for plausibility short-circuiting.
//
// Spec §6.5 — `implausible_value` escalation requires a (parameter, value)
// pair before the model call so we can route the turn to Sonnet. This module
// does a cheap English-only regex pass to find obvious patterns. Hindi/
// Bengali numeric extraction is deferred — the LLM-side reasoning catches
// what we miss (system prompt rejects hard-out-of-range values regardless).
//
// Owned by backend. Pure function, no IO.

import type { PreModelExtractionHint } from '../escalation/signal_detectors';

// Numeric patterns in English. Ordered: longer/more-specific patterns first.
//
// Each pattern produces zero or more (parameter, value) hints. The patterns
// are deliberately conservative — false positives are worse than false
// negatives because misclassified hints could trigger spurious Sonnet
// escalations and waste tokens.
const PATTERNS: Array<(text: string) => PreModelExtractionHint[]> = [
  // BP "X over Y" or "X / Y": e.g. "BP 130 over 85", "blood pressure 140/90"
  (text) => {
    const matches = text.matchAll(
      /(?:bp|blood\s*pressure|pressure)[^0-9]{0,20}([0-9]{2,3})\s*(?:over|\/|by)\s*([0-9]{2,3})/gi,
    );
    const hints: PreModelExtractionHint[] = [];
    for (const m of matches) {
      const sys = parseInt(m[1], 10);
      const dia = parseInt(m[2], 10);
      if (Number.isFinite(sys)) hints.push({ parameter: 'blood_pressure_systolic', value: sys });
      if (Number.isFinite(dia)) hints.push({ parameter: 'blood_pressure_diastolic', value: dia });
    }
    return hints;
  },

  // Glucose: "sugar 110", "glucose 110 mg/dL", "blood sugar one ten" (digits only here)
  (text) => {
    const matches = text.matchAll(
      /(?:sugar|glucose|blood\s*sugar)[^0-9]{0,20}([0-9]{2,3})(?:\s*(?:mg\/dl|mg|mmol))?/gi,
    );
    return Array.from(matches, (m) => ({
      parameter: 'blood_glucose',
      value: parseInt(m[1], 10),
    })).filter((h) => Number.isFinite(h.value));
  },

  // SpO2: "spo2 96", "oxygen 96%", "saturation 96"
  (text) => {
    const matches = text.matchAll(
      /(?:spo2|sp\s*o2|oxygen|saturation|sat)[^0-9]{0,15}([0-9]{2,3})\s*%?/gi,
    );
    return Array.from(matches, (m) => ({
      parameter: 'spo2',
      value: parseInt(m[1], 10),
    })).filter((h) => Number.isFinite(h.value));
  },

  // Heart rate / pulse: "pulse 78", "heart rate 80 bpm"
  (text) => {
    const matches = text.matchAll(
      /(?:pulse|heart\s*rate|heart\s*beat)[^0-9]{0,15}([0-9]{2,3})\s*(?:bpm|\/min)?/gi,
    );
    return Array.from(matches, (m) => ({
      parameter: 'heart_rate',
      value: parseInt(m[1], 10),
    })).filter((h) => Number.isFinite(h.value));
  },

  // Body temperature: "temperature 99 F", "temp 37 C", "fever 101"
  (text) => {
    const fMatches = text.matchAll(
      /(?:temperature|temp|fever|body\s*temp)[^0-9]{0,15}([0-9]{2,3}(?:\.[0-9])?)\s*(?:°?\s*f|fahrenheit)/gi,
    );
    const cMatches = text.matchAll(
      /(?:temperature|temp|fever|body\s*temp)[^0-9]{0,15}([0-9]{2,3}(?:\.[0-9])?)\s*(?:°?\s*c|celsius)/gi,
    );
    const fHints = Array.from(fMatches, (m) => ({
      parameter: 'body_temperature_f',
      value: parseFloat(m[1]),
    }));
    const cHints = Array.from(cMatches, (m) => ({
      parameter: 'body_temperature_c',
      value: parseFloat(m[1]),
    }));
    return [...fHints, ...cHints].filter((h) => Number.isFinite(h.value));
  },

  // Body weight: "weight 68 kg", "weighed 70 kilograms"
  (text) => {
    const matches = text.matchAll(
      /(?:weight|weigh|weighed)[^0-9]{0,15}([0-9]{2,3}(?:\.[0-9])?)\s*(?:kg|kilo|kilograms?|kilo\s*grams?)/gi,
    );
    return Array.from(matches, (m) => ({
      parameter: 'body_weight',
      value: parseFloat(m[1]),
    })).filter((h) => Number.isFinite(h.value));
  },
];

export function extractPreModelHints(transcript: string): PreModelExtractionHint[] {
  const hints: PreModelExtractionHint[] = [];
  for (const pattern of PATTERNS) {
    hints.push(...pattern(transcript));
  }
  // Deduplicate identical (parameter, value) pairs.
  const seen = new Set<string>();
  return hints.filter((h) => {
    const key = `${h.parameter}:${h.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Escalation signal detectors — owned by inference-platform agent.
//
// Spec: docs/matika_spec_v2.md §6.5 — pure functions over transcript + session
// state. Returns a routing decision used by bedrock-router/handler.ts to choose
// Haiku (T2) or Sonnet (T3).

export type Tier = 'T2' | 'T3';

export type EscalationSignal =
  | 'implausible_value'
  | 'emergency_keyword'
  | 'caregiver_protocol_design'
  | 'cross_session_continuity'
  | 'low_confidence_extraction'
  | 'code_switch_density_high'
  | 'long_response_expected';

export interface RoutingDecision {
  tier: Tier;
  reason: EscalationSignal | null;
}

export type SessionType = 'patient_logging' | 'caregiver_config' | 'caregiver_onboarding';
export type SupportedLanguage = 'en-IN' | 'hi-IN' | 'bn-IN';

export interface SessionContext {
  sessionType: SessionType;
  language: SupportedLanguage;
  hasPendingRecommendationsRequiringIntroduction: boolean;
  previousTurnLowestConfidence: number | null;
  protocolDesignTurn: boolean;
  longResponseExpected: boolean;
}

// Plausibility ranges — mirrors prompts/system_v2.md and v1's PLAUSIBILITY_RANGES.
// Used by the implausible_value signal: any *extracted* value outside hard bounds.
const HARD_RANGES: Record<string, { min: number; max: number }> = {
  blood_pressure_systolic: { min: 40, max: 300 },
  blood_pressure_diastolic: { min: 20, max: 200 },
  blood_glucose: { min: 10, max: 800 },
  blood_glucose_fasting: { min: 10, max: 500 },
  blood_glucose_postprandial: { min: 10, max: 600 },
  body_temperature_c: { min: 29, max: 46 },
  body_temperature_f: { min: 85, max: 115 },
  spo2: { min: 30, max: 100 },
  heart_rate: { min: 20, max: 300 },
  body_weight: { min: 5, max: 400 },
};

// Emergency keywords — en/hi/bn dictionary ported from the v1 patient-logging engine.
const EMERGENCY_KEYWORDS: Record<SupportedLanguage, string[]> = {
  'en-IN': [
    'chest pain', "can't breathe", 'cannot breathe', 'cant breathe', 'falling',
    'fell down', 'unconscious', 'fainted', 'heart attack', 'stroke', 'seizure',
    'choking', 'severe pain', 'bleeding heavily',
  ],
  'hi-IN': [
    'seene mein dard', 'saans nahi aa rahi', 'gir gaya', 'gir gayi', 'behosh',
    'behosh ho gaya', 'dil ka daura', 'bahut dard', 'tez dard', 'khoon bah raha hai',
    'saans nahi le pa raha', 'saans nahi le pa rahi', 'chakkar aa raha hai',
  ],
  'bn-IN': [
    'bukey byatha', 'swas nite parchhi na', 'pore gechi', 'pore gechhe',
    'gyan hariye felechhe', 'gyan nei', 'hridroghe', 'khub byatha',
    'rokto porchhe', 'swas bondho', 'matha ghurchhe', 'jnan hariye phelchhi',
    'pore gechhi',
  ],
};

const CONFIDENCE_LOW_THRESHOLD = 0.7;
const CODE_SWITCH_DENSITY_THRESHOLD = 0.3;

export interface PreModelExtractionHint {
  parameter: string;
  value: number;
}

export interface EscalationInput {
  transcript: string;
  preModelHints: PreModelExtractionHint[];
  context: SessionContext;
}

export function detectEscalation(input: EscalationInput): RoutingDecision {
  const { transcript, preModelHints, context } = input;

  // 1. Emergency keywords — highest priority. Patient safety outranks every
  // other signal. Checked across all languages, primary first, because
  // patients in distress often revert to whatever phrase comes first.
  const lowered = transcript.toLowerCase();
  const langsToCheck: SupportedLanguage[] = [
    context.language,
    ...(['en-IN', 'hi-IN', 'bn-IN'] as SupportedLanguage[]).filter((l) => l !== context.language),
  ];
  for (const lang of langsToCheck) {
    if (EMERGENCY_KEYWORDS[lang].some((kw) => lowered.includes(kw))) {
      return { tier: 'T3', reason: 'emergency_keyword' };
    }
  }

  // 2. Hard plausibility violation — pre-model check on any explicit number-parameter pair.
  for (const hint of preModelHints) {
    const range = HARD_RANGES[hint.parameter];
    if (range && (hint.value < range.min || hint.value > range.max)) {
      return { tier: 'T3', reason: 'implausible_value' };
    }
  }

  // 3. Caregiver session — always default to Sonnet (T-V2-300). Caregiver
  // turns are higher-stakes, longer, and more nuanced than patient-logging
  // turns; the latency cost is acceptable because caregivers tolerate it
  // and these conversations are infrequent. The protocolDesignTurn flag
  // is preserved for telemetry — when set, we know the turn specifically
  // involves protocol-design content (vs general caregiver chat) and a
  // future increment may load a different sub-prompt for that case.
  if (
    context.sessionType === 'caregiver_config' ||
    context.sessionType === 'caregiver_onboarding'
  ) {
    return { tier: 'T3', reason: 'caregiver_protocol_design' };
  }

  // 4. Cross-session continuity — gentle introduction of new parameters needs care.
  if (context.hasPendingRecommendationsRequiringIntroduction) {
    return { tier: 'T3', reason: 'cross_session_continuity' };
  }

  // 5. Low confidence on previous extraction — retry with Sonnet.
  if (
    context.previousTurnLowestConfidence !== null &&
    context.previousTurnLowestConfidence < CONFIDENCE_LOW_THRESHOLD
  ) {
    return { tier: 'T3', reason: 'low_confidence_extraction' };
  }

  // 6. Dense code-switching — Sonnet handles better than Haiku.
  if (codeSwitchDensity(transcript, context.language) > CODE_SWITCH_DENSITY_THRESHOLD) {
    return { tier: 'T3', reason: 'code_switch_density_high' };
  }

  // 7. Long response expected — caller signals upstream (e.g., onboarding monologue).
  if (context.longResponseExpected) {
    return { tier: 'T3', reason: 'long_response_expected' };
  }

  return { tier: 'T2', reason: null };
}

// Code-switch density: fraction of word tokens whose script does NOT match the
// session's primary language script. Approximate but cheap.
//   - en-IN primary: count Devanagari (Hindi) and Bengali script tokens as "switched"
//   - hi-IN primary: count Latin and Bengali tokens as "switched"
//   - bn-IN primary: count Latin and Devanagari tokens as "switched"
//
// Tokens of length 1 (punctuation, single digits) are ignored.
export function codeSwitchDensity(transcript: string, primary: SupportedLanguage): number {
  const tokens = transcript.split(/\s+/).filter((t) => t.length > 1);
  if (tokens.length === 0) return 0;

  const isDevanagari = (s: string) => /[ऀ-ॿ]/.test(s);
  const isBengali = (s: string) => /[ঀ-৿]/.test(s);
  const isLatin = (s: string) => /[A-Za-z]/.test(s);

  let switched = 0;
  for (const tok of tokens) {
    const inDev = isDevanagari(tok);
    const inBen = isBengali(tok);
    const inLat = isLatin(tok);

    if (primary === 'en-IN' && (inDev || inBen)) switched++;
    else if (primary === 'hi-IN' && (inLat || inBen)) switched++;
    else if (primary === 'bn-IN' && (inLat || inDev)) switched++;
  }
  return switched / tokens.length;
}

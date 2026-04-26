/**
 * Test data fixtures for CareLog E2E and integration tests.
 *
 * Placeholder credentials — replace with real Cognito test user tokens
 * before running against live infrastructure.
 */

import { v4 as uuidv4 } from 'uuid';
import type { LlmParameterConfig, LlmTopicConfig } from './mac-mini-client';

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------

export const ENV = {
  /** Cloud API Gateway base URL */
  CLOUD_API_URL: process.env.CARELOG_CLOUD_API_URL ?? 'https://PLACEHOLDER.execute-api.ap-south-1.amazonaws.com/dev',

  /** Mac Mini host (IP or mDNS hostname) */
  MAC_MINI_HOST: process.env.CARELOG_MAC_MINI_HOST ?? 'localhost',

  /** AWS region — all resources must be here for DPDP compliance */
  AWS_REGION: process.env.AWS_REGION ?? 'ap-south-1',

  /** Skip tests that require live infrastructure */
  SKIP_LIVE: process.env.CARELOG_SKIP_LIVE === 'true',
};

// ---------------------------------------------------------------------------
// Cognito test user credentials (placeholders)
// ---------------------------------------------------------------------------

export interface TestCredentials {
  email: string;
  password: string;
  cognitoToken: string;
  userId: string;
  persona: 'patient' | 'caregiver' | 'doctor';
}

export const TEST_CAREGIVER: TestCredentials = {
  email: process.env.TEST_CAREGIVER_EMAIL ?? 'caregiver.test@carelog.test',
  password: process.env.TEST_CAREGIVER_PASSWORD ?? 'Carelog2026@x',
  cognitoToken: process.env.TEST_CAREGIVER_TOKEN ?? 'PLACEHOLDER_CAREGIVER_JWT',
  userId: process.env.TEST_CAREGIVER_USER_ID ?? '00000000-0000-0000-0000-000000000001',
  persona: 'caregiver',
};

export const TEST_PATIENT: TestCredentials = {
  email: process.env.TEST_PATIENT_EMAIL ?? 'patient.test@carelog.test',
  password: process.env.TEST_PATIENT_PASSWORD ?? 'Carelog2026@x',
  cognitoToken: process.env.TEST_PATIENT_TOKEN ?? 'PLACEHOLDER_PATIENT_JWT',
  userId: process.env.TEST_PATIENT_USER_ID ?? '00000000-0000-0000-0000-000000000002',
  persona: 'patient',
};

export const TEST_DOCTOR: TestCredentials = {
  email: process.env.TEST_DOCTOR_EMAIL ?? 'doctor.test@carelog.test',
  password: process.env.TEST_DOCTOR_PASSWORD ?? 'Carelog2026@x',
  cognitoToken: process.env.TEST_DOCTOR_TOKEN ?? 'PLACEHOLDER_DOCTOR_JWT',
  userId: process.env.TEST_DOCTOR_USER_ID ?? '00000000-0000-0000-0000-000000000003',
  persona: 'doctor',
};

// ---------------------------------------------------------------------------
// Patient profiles (used for session creation)
// ---------------------------------------------------------------------------

export interface TestPatientProfile {
  id: string;
  name: string;
  language: 'en' | 'hi' | 'bn';
  timezone: string;
  dateOfBirth: string;
}

export const PATIENT_ENGLISH: TestPatientProfile = {
  id: process.env.TEST_PATIENT_EN_ID ?? uuidv4(),
  name: 'John Smith',
  language: 'en',
  timezone: 'Asia/Kolkata',
  dateOfBirth: '1950-03-15',
};

export const PATIENT_HINDI: TestPatientProfile = {
  id: process.env.TEST_PATIENT_HI_ID ?? uuidv4(),
  name: 'Ramesh Kumar',
  language: 'hi',
  timezone: 'Asia/Kolkata',
  dateOfBirth: '1948-07-22',
};

export const PATIENT_BENGALI: TestPatientProfile = {
  id: process.env.TEST_PATIENT_BN_ID ?? uuidv4(),
  name: 'Sunil Das',
  language: 'bn',
  timezone: 'Asia/Kolkata',
  dateOfBirth: '1952-11-08',
};

// ---------------------------------------------------------------------------
// Parameter configurations
// ---------------------------------------------------------------------------

export const PARAM_BLOOD_PRESSURE: LlmParameterConfig = {
  name: 'blood_pressure',
  loinc_codes: ['8480-6', '8462-4'],
  unit: 'mmHg',
  frequency_days: 1,
  threshold_min: [90, 60],
  threshold_max: [140, 90],
};

export const PARAM_BLOOD_GLUCOSE: LlmParameterConfig = {
  name: 'blood_glucose',
  loinc_codes: ['2339-0'],
  unit: 'mg/dL',
  frequency_days: 1,
  threshold_min: [70],
  threshold_max: [200],
};

export const PARAM_SPO2: LlmParameterConfig = {
  name: 'spo2',
  loinc_codes: ['2708-6'],
  unit: '%',
  frequency_days: 1,
  threshold_min: [92],
  threshold_max: [100],
};

export const PARAM_TEMPERATURE: LlmParameterConfig = {
  name: 'body_temperature',
  loinc_codes: ['8310-5'],
  unit: '°F',
  frequency_days: 1,
  threshold_min: [95],
  threshold_max: [100.4],
};

export const PARAM_WEIGHT: LlmParameterConfig = {
  name: 'body_weight',
  loinc_codes: ['29463-7'],
  unit: 'kg',
  frequency_days: 3,
  threshold_min: undefined,
  threshold_max: undefined,
};

export const ALL_PARAMS: LlmParameterConfig[] = [
  PARAM_BLOOD_PRESSURE,
  PARAM_BLOOD_GLUCOSE,
  PARAM_SPO2,
  PARAM_TEMPERATURE,
  PARAM_WEIGHT,
];

// ---------------------------------------------------------------------------
// Topic configurations
// ---------------------------------------------------------------------------

export const TOPIC_MEDICATIONS: LlmTopicConfig = {
  id: uuidv4(),
  name: 'medications',
  description: 'Current medications and recent changes',
  status: 'incomplete',
  last_collected: null,
};

export const TOPIC_CONDITIONS: LlmTopicConfig = {
  id: uuidv4(),
  name: 'conditions',
  description: 'Active medical conditions and diagnoses',
  status: 'incomplete',
  last_collected: null,
};

export const ALL_TOPICS: LlmTopicConfig[] = [TOPIC_MEDICATIONS, TOPIC_CONDITIONS];

// ---------------------------------------------------------------------------
// Sample utterances (for conversation-flow tests)
// ---------------------------------------------------------------------------

export const UTTERANCES = {
  en: {
    bp_report: 'my blood pressure is 130 over 85',
    bp_high: 'my blood pressure is 165 over 100',
    glucose_report: 'my sugar level is 140',
    confirm_yes: 'yes that is correct',
    confirm_no: 'no that is wrong',
    chest_pain: 'I have severe chest pain',
    unclear: 'mmhmm uhh yeah',
  },
  hi: {
    bp_report: 'mera blood pressure 130 over 85 hai',
    bp_high: 'mera blood pressure 165 over 100 hai',
    glucose_report: 'mera sugar level 140 hai',
    confirm_yes: 'haan sahi hai',
    confirm_no: 'nahi yeh galat hai',
    chest_pain: 'seene mein bahut dard ho raha hai',
    unclear: 'hmm uhh haan',
  },
  bn: {
    bp_report: 'amar blood pressure 130 over 85',
    bp_high: 'amar blood pressure 165 over 100',
    glucose_report: 'amar sugar level 140',
    confirm_yes: 'hyan eita thik achhe',
    confirm_no: 'na eita bhul',
    chest_pain: 'amar buke khub byatha hochhe',
    unclear: 'hmm uhh hyan',
  },
} as const;

// ---------------------------------------------------------------------------
// Sample vital values for FHIR batch construction
// ---------------------------------------------------------------------------

export const FHIR_VALUES = {
  bp_normal: [
    { parameter: 'blood_pressure_systolic', loinc_code: '8480-6', value: 130, unit: 'mmHg' },
    { parameter: 'blood_pressure_diastolic', loinc_code: '8462-4', value: 85, unit: 'mmHg' },
  ],
  bp_high: [
    { parameter: 'blood_pressure_systolic', loinc_code: '8480-6', value: 165, unit: 'mmHg' },
    { parameter: 'blood_pressure_diastolic', loinc_code: '8462-4', value: 100, unit: 'mmHg' },
  ],
  glucose_normal: [
    { parameter: 'blood_glucose', loinc_code: '2339-0', value: 140, unit: 'mg/dL' },
  ],
  glucose_high: [
    { parameter: 'blood_glucose', loinc_code: '2339-0', value: 300, unit: 'mg/dL' },
  ],
  spo2_low: [
    { parameter: 'spo2', loinc_code: '2708-6', value: 88, unit: '%' },
  ],
};

// ---------------------------------------------------------------------------
// Audio fixture paths (placeholder — actual .pcm files to be provided)
// ---------------------------------------------------------------------------

export const AUDIO_FIXTURES = {
  en: {
    bp_report: 'multilingual/test-audio/en/bp_report.pcm',
    glucose_report: 'multilingual/test-audio/en/glucose_report.pcm',
    confirm_yes: 'multilingual/test-audio/en/confirm_yes.pcm',
    elderly_unclear: 'multilingual/test-audio/en/elderly_unclear.pcm',
    garbage: 'multilingual/test-audio/en/garbage.pcm',
    medical_terms: 'multilingual/test-audio/en/medical_terms.pcm',
  },
  hi: {
    bp_report: 'multilingual/test-audio/hi/bp_report.pcm',
    glucose_report: 'multilingual/test-audio/hi/glucose_report.pcm',
    confirm_yes: 'multilingual/test-audio/hi/confirm_yes.pcm',
    elderly_unclear: 'multilingual/test-audio/hi/elderly_unclear.pcm',
    code_mixed_bp: 'multilingual/test-audio/hi/code_mixed_bp.pcm',
    chest_pain: 'multilingual/test-audio/hi/chest_pain.pcm',
    medical_terms: 'multilingual/test-audio/hi/medical_terms.pcm',
  },
  bn: {
    bp_report: 'multilingual/test-audio/bn/bp_report.pcm',
    glucose_report: 'multilingual/test-audio/bn/glucose_report.pcm',
    confirm_yes: 'multilingual/test-audio/bn/confirm_yes.pcm',
    elderly_unclear: 'multilingual/test-audio/bn/elderly_unclear.pcm',
    code_mixed_bp: 'multilingual/test-audio/bn/code_mixed_bp.pcm',
    medical_terms: 'multilingual/test-audio/bn/medical_terms.pcm',
  },
};

// ---------------------------------------------------------------------------
// Sample JPEG for vision tests (1x1 white pixel placeholder)
// ---------------------------------------------------------------------------

/** Minimal valid JPEG buffer for tests that don't need real image content. */
export function placeholderJpeg(): Buffer {
  // Smallest valid JPEG: SOI + APP0 + minimal frame
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

// ---------------------------------------------------------------------------
// System prompts (for LLM session creation)
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPTS = {
  patient_logging:
    'You are CareLog, a compassionate health companion for elderly patients. ' +
    'Guide the patient through reporting their vital signs one parameter at a time. ' +
    'Extract numeric values, confirm each with the patient, then move to the next parameter. ' +
    'Speak in the patient\'s preferred language. Use empathetic, simple language.',
  caregiver_config:
    'You are CareLog, helping a caregiver configure monitoring parameters for their patient. ' +
    'Ask about each vital sign, frequency, and any thresholds. Confirm settings.',
  caregiver_onboarding:
    'You are CareLog, helping a caregiver register a new patient. ' +
    'Collect the patient\'s name, date of birth, language preference, and medical background.',
};

// ---------------------------------------------------------------------------
// Helper: generate unique test IDs
// ---------------------------------------------------------------------------

export function testId(): string {
  return uuidv4();
}

export function testSessionId(): string {
  return uuidv4();
}

// ---------------------------------------------------------------------------
// Helper: skip if live infra not available
// ---------------------------------------------------------------------------

export function skipIfNoLiveInfra(): void {
  if (ENV.SKIP_LIVE) {
    throw new Error('CARELOG_SKIP_LIVE is set — skipping live infrastructure test');
  }
}

/**
 * Create a "recorded_at" ISO timestamp N days ago from now.
 */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

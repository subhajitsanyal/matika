/**
 * Application constants.
 */

export const VITAL_TYPES = {
  BLOOD_PRESSURE: 'bloodPressure',
  GLUCOSE: 'glucose',
  TEMPERATURE: 'temperature',
  WEIGHT: 'weight',
  PULSE: 'pulse',
  SPO2: 'spo2',
} as const;

export const VITAL_CONFIG = {
  [VITAL_TYPES.BLOOD_PRESSURE]: {
    label: 'Blood Pressure',
    unit: 'mmHg',
    color: '#ef4444',
    loincCode: '85354-9',
  },
  [VITAL_TYPES.GLUCOSE]: {
    label: 'Blood Glucose',
    unit: 'mg/dL',
    color: '#8b5cf6',
    loincCode: '2339-0',
  },
  [VITAL_TYPES.TEMPERATURE]: {
    label: 'Temperature',
    unit: '°F',
    color: '#f97316',
    loincCode: '8310-5',
  },
  [VITAL_TYPES.WEIGHT]: {
    label: 'Weight',
    unit: 'kg',
    color: '#06b6d4',
    loincCode: '29463-7',
  },
  [VITAL_TYPES.PULSE]: {
    label: 'Pulse',
    unit: 'bpm',
    color: '#ec4899',
    loincCode: '8867-4',
  },
  [VITAL_TYPES.SPO2]: {
    label: 'SpO2',
    unit: '%',
    color: '#3b82f6',
    loincCode: '2708-6',
  },
} as const;

export const FILE_TYPES = {
  PRESCRIPTION: 'prescription',
  WOUND_PHOTO: 'wound_photo',
  LAB_REPORT: 'lab_report',
  VOICE_NOTE: 'voice_note',
  VIDEO_NOTE: 'video_note',
  OTHER: 'other',
} as const;

export const FILE_TYPE_LABELS = {
  [FILE_TYPES.PRESCRIPTION]: 'Prescription',
  [FILE_TYPES.WOUND_PHOTO]: 'Medical Photo',
  [FILE_TYPES.LAB_REPORT]: 'Lab Report',
  [FILE_TYPES.VOICE_NOTE]: 'Voice Note',
  [FILE_TYPES.VIDEO_NOTE]: 'Video Note',
  [FILE_TYPES.OTHER]: 'Other',
} as const;

export const DATE_RANGES = {
  WEEK: '7d',
  MONTH: '30d',
  QUARTER: '90d',
  YEAR: '365d',
} as const;

export const DATE_RANGE_LABELS = {
  [DATE_RANGES.WEEK]: 'Last 7 Days',
  [DATE_RANGES.MONTH]: 'Last 30 Days',
  [DATE_RANGES.QUARTER]: 'Last 90 Days',
  [DATE_RANGES.YEAR]: 'Last Year',
} as const;

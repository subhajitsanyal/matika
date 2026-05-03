import { renderPatientContext } from '../src/context/per_patient';
import type {
  PatientContext,
  PatientProfile,
  ParameterConfig,
} from '../src/context/types';

function basePatient(overrides: Partial<PatientProfile> = {}): PatientProfile {
  return {
    id: 'patient-1',
    name: 'Ramesh Sharma',
    age: 72,
    gender: 'male',
    primaryLanguage: 'hi-IN',
    conditions: ['hypertension', 'type 2 diabetes'],
    medicalHistorySummary: 'CABG 2018; stable since.',
    ...overrides,
  };
}

function activeBp(): ParameterConfig {
  return {
    parameterName: 'blood_pressure_systolic',
    loincCode: '8480-6',
    unit: 'mmHg',
    frequencyDays: 1,
    dailyDeadline: '18:00',
    timezone: 'Asia/Kolkata',
    thresholdMin: 90,
    thresholdMax: 140,
    thresholdSetBy: 'doctor',
    active: true,
  };
}

function fullContext(overrides: Partial<PatientContext> = {}): PatientContext {
  return {
    patient: basePatient(),
    userId: 'user-1',
    protocol: [activeBp()],
    topics: [
      { topicName: 'medications', status: 'complete', lastUpdated: new Date('2026-04-30'), summary: 'Metformin 500mg BD; Amlodipine 5mg OD' },
      { topicName: 'recent_hospitalizations', status: 'incomplete', lastUpdated: null, summary: null },
    ],
    recentSessions: [
      {
        sessionId: 's1',
        sessionType: 'patient_logging',
        language: 'hi-IN',
        startedAt: new Date('2026-04-30T12:00:00Z'),
        endedAt: new Date('2026-04-30T12:05:00Z'),
        status: 'complete',
        capturedValues: [
          { parameter: 'blood_pressure_systolic', value: 132, unit: 'mmHg' },
          { parameter: 'blood_pressure_diastolic', value: 84, unit: 'mmHg' },
        ],
        incompleteReason: null,
      },
    ],
    pendingRecommendations: [
      {
        parameterName: 'blood_glucose_fasting',
        source: 'doctor',
        rationale: 'Better diabetic monitoring than single daily reading',
        suggestedFrequencyDays: 1,
        requiresGentleIntroduction: true,
      },
    ],
    ...overrides,
  };
}

describe('renderPatientContext', () => {
  it('renders all five sections in order, ending with cache breakpoint', () => {
    const out = renderPatientContext(fullContext());
    expect(out).toMatch(/## Patient[\s\S]*## Active monitoring protocol[\s\S]*## Active topics[\s\S]*## Recent sessions[\s\S]*## Pending recommendations[\s\S]*<!-- CACHE_BREAKPOINT -->\s*$/);
  });

  it('includes patient core fields', () => {
    const out = renderPatientContext(fullContext());
    expect(out).toContain('Name: Ramesh Sharma');
    expect(out).toContain('Age: 72');
    expect(out).toContain('Gender: male');
    expect(out).toContain('Primary language: hi-IN');
    expect(out).toContain('hypertension, type 2 diabetes');
    expect(out).toContain('Medical history: CABG 2018');
  });

  it('handles patient with no conditions', () => {
    const ctx = fullContext({ patient: basePatient({ conditions: [] }) });
    expect(renderPatientContext(ctx)).toContain('Conditions: (none recorded)');
  });

  it('omits medical history line when null', () => {
    const ctx = fullContext({ patient: basePatient({ medicalHistorySummary: null }) });
    expect(renderPatientContext(ctx)).not.toContain('Medical history:');
  });

  it('renders protocol as a Markdown table with thresholds', () => {
    const out = renderPatientContext(fullContext());
    expect(out).toContain('| Parameter | LOINC | Unit | Frequency | Daily deadline | Thresholds | Set by |');
    expect(out).toContain('blood_pressure_systolic');
    expect(out).toContain('8480-6');
    expect(out).toContain('every day');
    expect(out).toContain('90–140 mmHg');
    expect(out).toContain('doctor');
  });

  it('formats frequency correctly for various intervals', () => {
    const ctx = fullContext({
      protocol: [
        { ...activeBp(), parameterName: 'p_daily', frequencyDays: 1 },
        { ...activeBp(), parameterName: 'p_3day', frequencyDays: 3 },
      ],
    });
    const out = renderPatientContext(ctx);
    expect(out).toContain('every day');
    expect(out).toContain('every 3 days');
  });

  it('formats thresholds when only min set', () => {
    const ctx = fullContext({
      protocol: [{ ...activeBp(), thresholdMin: 95, thresholdMax: null }],
    });
    expect(renderPatientContext(ctx)).toContain('95–+∞ mmHg');
  });

  it('formats thresholds when only max set', () => {
    const ctx = fullContext({
      protocol: [{ ...activeBp(), thresholdMin: null, thresholdMax: 140 }],
    });
    expect(renderPatientContext(ctx)).toContain('−∞–140 mmHg');
  });

  it('shows em-dash when no thresholds set', () => {
    const ctx = fullContext({
      protocol: [{ ...activeBp(), thresholdMin: null, thresholdMax: null }],
    });
    expect(renderPatientContext(ctx)).toContain('| — |');
  });

  it('excludes inactive protocol entries', () => {
    const ctx = fullContext({
      protocol: [
        activeBp(),
        { ...activeBp(), parameterName: 'inactive_param', active: false },
      ],
    });
    const out = renderPatientContext(ctx);
    expect(out).toContain('blood_pressure_systolic');
    expect(out).not.toContain('inactive_param');
  });

  it('renders empty protocol gracefully', () => {
    const ctx = fullContext({ protocol: [] });
    expect(renderPatientContext(ctx)).toContain('## Active monitoring protocol\n\n_(none configured)_');
  });

  it('renders topics with status and summary', () => {
    const out = renderPatientContext(fullContext());
    expect(out).toContain('**medications** (complete) — Metformin 500mg BD');
    expect(out).toContain('**recent_hospitalizations** (incomplete)');
  });

  it('renders empty topics gracefully', () => {
    const ctx = fullContext({ topics: [] });
    expect(renderPatientContext(ctx)).toContain('## Active topics\n\n_(none tracked)_');
  });

  it('renders recent sessions with captured values', () => {
    const out = renderPatientContext(fullContext());
    expect(out).toContain('2026-04-30 patient_logging (hi-IN): captured blood_pressure_systolic 132 mmHg, blood_pressure_diastolic 84 mmHg');
  });

  it('renders incomplete sessions with reason', () => {
    const ctx = fullContext({
      recentSessions: [
        {
          sessionId: 's2',
          sessionType: 'patient_logging',
          language: 'hi-IN',
          startedAt: new Date('2026-04-29T12:00:00Z'),
          endedAt: null,
          status: 'incomplete',
          capturedValues: [],
          incompleteReason: 'patient confused',
        },
      ],
    });
    expect(renderPatientContext(ctx)).toContain('incomplete — patient confused');
  });

  it('renders empty recent sessions gracefully', () => {
    const ctx = fullContext({ recentSessions: [] });
    expect(renderPatientContext(ctx)).toContain('## Recent sessions\n\n_(no prior sessions)_');
  });

  it('renders recommendations with gentle-introduction flag', () => {
    const out = renderPatientContext(fullContext());
    expect(out).toContain('**doctor** recommends **blood_glucose_fasting**');
    expect(out).toContain('(introduce gently to patient)');
    expect(out).toContain('Better diabetic monitoring');
    expect(out).toContain('Suggested frequency: every day');
  });

  it('renders analytics-source recommendation without gentle flag', () => {
    const ctx = fullContext({
      pendingRecommendations: [
        {
          parameterName: 'spo2',
          source: 'analytics',
          rationale: 'Patient has COPD risk markers',
          suggestedFrequencyDays: null,
          requiresGentleIntroduction: false,
        },
      ],
    });
    const out = renderPatientContext(ctx);
    expect(out).toContain('**analytics** recommends **spo2**');
    expect(out).not.toContain('(introduce gently to patient)');
    expect(out).not.toContain('Suggested frequency');
  });

  it('renders empty recommendations gracefully', () => {
    const ctx = fullContext({ pendingRecommendations: [] });
    expect(renderPatientContext(ctx)).toContain('## Pending recommendations\n\n_(none)_');
  });

  it('size is reasonable for a typical patient (rough budget check)', () => {
    // Spec §6.3 targets ~1K tokens (~4K chars) for the per-patient block.
    // This isn't a hard cap; just guards against runaway bloat.
    const out = renderPatientContext(fullContext());
    expect(out.length).toBeLessThan(8000);
  });
});

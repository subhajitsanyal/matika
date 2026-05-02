import { extractPreModelHints } from '../src/pre_model_hints';

describe('extractPreModelHints', () => {
  it('extracts BP from "BP 130 over 85"', () => {
    const hints = extractPreModelHints('BP 130 over 85');
    expect(hints).toEqual([
      { parameter: 'blood_pressure_systolic', value: 130 },
      { parameter: 'blood_pressure_diastolic', value: 85 },
    ]);
  });

  it('extracts BP from "blood pressure 140/90"', () => {
    const hints = extractPreModelHints('My blood pressure is 140/90 today.');
    expect(hints).toEqual(
      expect.arrayContaining([
        { parameter: 'blood_pressure_systolic', value: 140 },
        { parameter: 'blood_pressure_diastolic', value: 90 },
      ]),
    );
  });

  it('extracts BP from "pressure 120 by 80"', () => {
    const hints = extractPreModelHints('Pressure 120 by 80');
    expect(hints).toContainEqual({ parameter: 'blood_pressure_systolic', value: 120 });
    expect(hints).toContainEqual({ parameter: 'blood_pressure_diastolic', value: 80 });
  });

  it('extracts implausible BP for plausibility short-circuit', () => {
    const hints = extractPreModelHints('My BP is 350 over 200');
    expect(hints).toContainEqual({ parameter: 'blood_pressure_systolic', value: 350 });
  });

  it('extracts glucose from "sugar 110"', () => {
    expect(extractPreModelHints('My sugar is 110')).toContainEqual({
      parameter: 'blood_glucose',
      value: 110,
    });
  });

  it('extracts glucose with unit', () => {
    expect(extractPreModelHints('Blood sugar 105 mg/dL today')).toContainEqual({
      parameter: 'blood_glucose',
      value: 105,
    });
  });

  it('extracts spo2', () => {
    expect(extractPreModelHints('SpO2 96')).toContainEqual({ parameter: 'spo2', value: 96 });
    expect(extractPreModelHints('Oxygen 95%')).toContainEqual({ parameter: 'spo2', value: 95 });
    expect(extractPreModelHints('Saturation 92')).toContainEqual({ parameter: 'spo2', value: 92 });
  });

  it('extracts heart rate', () => {
    expect(extractPreModelHints('Pulse 78')).toContainEqual({ parameter: 'heart_rate', value: 78 });
    expect(extractPreModelHints('Heart rate 80 bpm')).toContainEqual({
      parameter: 'heart_rate',
      value: 80,
    });
  });

  it('extracts body temperature in Fahrenheit', () => {
    expect(extractPreModelHints('Temperature 99.5 F')).toContainEqual({
      parameter: 'body_temperature_f',
      value: 99.5,
    });
    expect(extractPreModelHints('Fever 101 fahrenheit')).toContainEqual({
      parameter: 'body_temperature_f',
      value: 101,
    });
  });

  it('extracts body temperature in Celsius', () => {
    expect(extractPreModelHints('Temp 37 C')).toContainEqual({
      parameter: 'body_temperature_c',
      value: 37,
    });
    expect(extractPreModelHints('Body temp 38.5 celsius')).toContainEqual({
      parameter: 'body_temperature_c',
      value: 38.5,
    });
  });

  it('extracts weight in kg', () => {
    expect(extractPreModelHints('Weight 68 kg')).toContainEqual({
      parameter: 'body_weight',
      value: 68,
    });
    expect(extractPreModelHints('Weighed 70.5 kilograms')).toContainEqual({
      parameter: 'body_weight',
      value: 70.5,
    });
  });

  it('returns empty for transcripts with no recognizable patterns', () => {
    expect(extractPreModelHints("I'm feeling fine today")).toEqual([]);
  });

  it('returns empty for Hindi numeric speech (deferred — relies on LLM)', () => {
    // Hindi number-word recognition is not implemented in this regex path.
    // The system prompt's hard-out-of-range rejection rule catches these
    // cases at the model layer.
    expect(extractPreModelHints('mera BP एक सौ तीस over अस्सी hai')).toEqual([]);
  });

  it('deduplicates identical (parameter, value) pairs', () => {
    const hints = extractPreModelHints('My BP 130 over 85, BP 130 over 85 again');
    const sysCount = hints.filter((h) => h.parameter === 'blood_pressure_systolic' && h.value === 130).length;
    expect(sysCount).toBe(1);
  });

  it('does NOT extract values from BP-shaped numbers without a label', () => {
    // "130 over 85" alone has no parameter label; we don't guess.
    expect(extractPreModelHints('It was 130 over 85')).toEqual([]);
  });

  it('handles multiple parameters in one transcript', () => {
    const hints = extractPreModelHints('BP 130 over 85, sugar 110, weight 68 kg, pulse 78');
    expect(hints.length).toBeGreaterThanOrEqual(5);
    expect(hints).toContainEqual({ parameter: 'blood_pressure_systolic', value: 130 });
    expect(hints).toContainEqual({ parameter: 'blood_glucose', value: 110 });
    expect(hints).toContainEqual({ parameter: 'body_weight', value: 68 });
    expect(hints).toContainEqual({ parameter: 'heart_rate', value: 78 });
  });
});

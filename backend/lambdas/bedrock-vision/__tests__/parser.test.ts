import { parseVisionOutput, VisionParseError } from '../src/parser';

const validBlock = `<output>
{ "value": 142, "unit": "mg/dL", "confidence": 0.96, "rationale": "Clear LCD digits, units match." }
</output>`;

describe('parseVisionOutput', () => {
  it('parses a valid vision response', () => {
    const result = parseVisionOutput(validBlock);
    expect(result).toEqual({
      value: 142,
      unit: 'mg/dL',
      confidence: 0.96,
      rationale: 'Clear LCD digits, units match.',
    });
  });

  it('parses surrounding chatter and ignores it', () => {
    const wrapped = `Here is my analysis...\n\n${validBlock}\n\nThank you.`;
    const result = parseVisionOutput(wrapped);
    expect(result.value).toBe(142);
  });

  it('parses a low-confidence response with value 0', () => {
    const block = `<output>
{ "value": 0, "unit": "mg/dL", "confidence": 0.3, "rationale": "Glare obscured middle digit." }
</output>`;
    const result = parseVisionOutput(block);
    expect(result.value).toBe(0);
    expect(result.confidence).toBe(0.3);
  });

  it('throws no_output_tags when block is missing', () => {
    try {
      parseVisionOutput('Just some prose about an image.');
    } catch (e) {
      expect(e).toBeInstanceOf(VisionParseError);
      expect((e as VisionParseError).kind).toBe('no_output_tags');
    }
  });

  it('throws multiple_output_tags when two blocks are present', () => {
    const doubled = `${validBlock}\n${validBlock}`;
    try {
      parseVisionOutput(doubled);
      fail('expected VisionParseError');
    } catch (e) {
      expect((e as VisionParseError).kind).toBe('multiple_output_tags');
    }
  });

  it('throws invalid_json on malformed body', () => {
    const broken = `<output>{ not json</output>`;
    try {
      parseVisionOutput(broken);
      fail('expected VisionParseError');
    } catch (e) {
      expect((e as VisionParseError).kind).toBe('invalid_json');
    }
  });

  it('throws schema_validation when required field missing', () => {
    const missingField = `<output>
{ "value": 142, "unit": "mg/dL", "confidence": 0.96 }
</output>`;
    try {
      parseVisionOutput(missingField);
      fail('expected VisionParseError');
    } catch (e) {
      expect((e as VisionParseError).kind).toBe('schema_validation');
    }
  });

  it('throws schema_validation on confidence > 1', () => {
    const bad = `<output>
{ "value": 142, "unit": "mg/dL", "confidence": 1.5, "rationale": "ok" }
</output>`;
    try {
      parseVisionOutput(bad);
      fail('expected VisionParseError');
    } catch (e) {
      expect((e as VisionParseError).kind).toBe('schema_validation');
    }
  });

  it('throws schema_validation on confidence < 0', () => {
    const bad = `<output>
{ "value": 142, "unit": "mg/dL", "confidence": -0.1, "rationale": "ok" }
</output>`;
    try {
      parseVisionOutput(bad);
      fail('expected VisionParseError');
    } catch (e) {
      expect((e as VisionParseError).kind).toBe('schema_validation');
    }
  });

  it('throws schema_validation on extra unknown field', () => {
    const bad = `<output>
{ "value": 142, "unit": "mg/dL", "confidence": 0.95, "rationale": "ok", "extra": "nope" }
</output>`;
    try {
      parseVisionOutput(bad);
      fail('expected VisionParseError');
    } catch (e) {
      expect((e as VisionParseError).kind).toBe('schema_validation');
    }
  });

  it('throws schema_validation on empty unit', () => {
    const bad = `<output>
{ "value": 142, "unit": "", "confidence": 0.95, "rationale": "ok" }
</output>`;
    try {
      parseVisionOutput(bad);
      fail('expected VisionParseError');
    } catch (e) {
      expect((e as VisionParseError).kind).toBe('schema_validation');
    }
  });

  it('accepts decimal values (temperature, mmol/L glucose)', () => {
    const block = `<output>
{ "value": 7.8, "unit": "mmol/L", "confidence": 0.92, "rationale": "Decimal display visible." }
</output>`;
    const result = parseVisionOutput(block);
    expect(result.value).toBe(7.8);
  });
});

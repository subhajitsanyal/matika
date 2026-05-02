import { parseStructuredOutput, StructuredOutputParseError } from '../src/parser';

const validBlock = `<output>
{
  "responseText": "I heard one thirty over eighty five. Is that correct?",
  "ttsHints": { "language": "en-IN", "spellOutNumbers": false },
  "extractedValues": [
    { "parameter": "blood_pressure_systolic", "value": 130, "unit": "mmHg", "loincCode": "8480-6", "status": "pending_confirmation", "confidence": 0.94 },
    { "parameter": "blood_pressure_diastolic", "value": 85, "unit": "mmHg", "loincCode": "8462-4", "status": "pending_confirmation", "confidence": 0.94 }
  ],
  "actions": [],
  "stateTransition": "EXTRACTING -> PENDING_CONFIRMATION",
  "escalationReason": null
}
</output>`;

describe('parseStructuredOutput', () => {
  it('parses a valid LLM output block', () => {
    const result = parseStructuredOutput(validBlock);
    expect(result.responseText).toContain('one thirty');
    expect(result.extractedValues).toHaveLength(2);
    expect(result.extractedValues[0].parameter).toBe('blood_pressure_systolic');
    expect(result.stateTransition).toBe('EXTRACTING -> PENDING_CONFIRMATION');
    expect(result.escalationReason).toBeNull();
  });

  it('parses surrounding chatter and ignores it', () => {
    const wrapped = `Here is my reasoning... blah blah\n\n${validBlock}\n\nEnd of response.`;
    const result = parseStructuredOutput(wrapped);
    expect(result.responseText).toContain('one thirty');
  });

  it('parses an emergency response with non-null escalationReason', () => {
    const block = `<output>
    {
      "responseText": "Please contact your caregiver right away.",
      "ttsHints": { "language": "en-IN", "spellOutNumbers": false },
      "extractedValues": [],
      "actions": [{ "type": "escalate_emergency", "reason": "chest_pain_keyword" }],
      "stateTransition": "EXTRACTING -> EMERGENCY",
      "escalationReason": "emergency"
    }
    </output>`;
    const result = parseStructuredOutput(block);
    expect(result.escalationReason).toBe('emergency');
    expect(result.actions[0].type).toBe('escalate_emergency');
  });

  it('throws no_output_tags when the block is missing', () => {
    expect(() => parseStructuredOutput('Just some prose, no tags.')).toThrow(StructuredOutputParseError);
    try {
      parseStructuredOutput('Just some prose, no tags.');
    } catch (e) {
      expect((e as StructuredOutputParseError).kind).toBe('no_output_tags');
    }
  });

  it('throws multiple_output_tags when two blocks are present', () => {
    const doubled = `${validBlock}\n${validBlock}`;
    try {
      parseStructuredOutput(doubled);
      fail('expected StructuredOutputParseError');
    } catch (e) {
      expect((e as StructuredOutputParseError).kind).toBe('multiple_output_tags');
    }
  });

  it('throws invalid_json when the body is not valid JSON', () => {
    const broken = `<output>
{ "responseText": "oops", not-json
</output>`;
    try {
      parseStructuredOutput(broken);
      fail('expected StructuredOutputParseError');
    } catch (e) {
      expect((e as StructuredOutputParseError).kind).toBe('invalid_json');
    }
  });

  it('throws schema_validation when a required field is missing', () => {
    const missingField = `<output>
{
  "responseText": "ok",
  "ttsHints": { "language": "en-IN", "spellOutNumbers": false },
  "extractedValues": [],
  "actions": [],
  "stateTransition": "GREETING -> EXTRACTING"
}
</output>`;
    try {
      parseStructuredOutput(missingField);
      fail('expected StructuredOutputParseError');
    } catch (e) {
      expect((e as StructuredOutputParseError).kind).toBe('schema_validation');
      expect((e as StructuredOutputParseError).validationErrors).toBeDefined();
    }
  });

  it('throws schema_validation when stateTransition has an unknown state', () => {
    const badTransition = validBlock.replace(
      '"stateTransition": "EXTRACTING -> PENDING_CONFIRMATION"',
      '"stateTransition": "EXTRACTING -> NONSENSE"',
    );
    try {
      parseStructuredOutput(badTransition);
      fail('expected StructuredOutputParseError');
    } catch (e) {
      expect((e as StructuredOutputParseError).kind).toBe('schema_validation');
    }
  });

  it('throws schema_validation when an extracted parameter is unknown', () => {
    const badParam = validBlock.replace('"blood_pressure_systolic"', '"blood_pressure_invalid"');
    try {
      parseStructuredOutput(badParam);
      fail('expected StructuredOutputParseError');
    } catch (e) {
      expect((e as StructuredOutputParseError).kind).toBe('schema_validation');
    }
  });
});

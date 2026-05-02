import {
  extractCompletedSentences,
  StreamingSentenceDetector,
} from '../src/sentence_detector';

describe('extractCompletedSentences', () => {
  it('returns nothing for an empty buffer', () => {
    expect(extractCompletedSentences('')).toEqual({ sentences: [], remaining: '' });
  });

  it('returns nothing when there is no sentence terminator', () => {
    expect(extractCompletedSentences('Hello, how are you')).toEqual({
      sentences: [],
      remaining: 'Hello, how are you',
    });
  });

  it('extracts a single complete sentence', () => {
    const result = extractCompletedSentences('I heard one thirty over eighty five. ');
    expect(result.sentences).toEqual(['I heard one thirty over eighty five.']);
    expect(result.remaining).toBe('');
  });

  it('extracts multiple complete sentences', () => {
    const result = extractCompletedSentences('That is great. Your BP is normal. Anything else?');
    expect(result.sentences).toEqual([
      'That is great.',
      'Your BP is normal.',
      'Anything else?',
    ]);
    expect(result.remaining).toBe('');
  });

  it('handles question and exclamation marks', () => {
    const result = extractCompletedSentences('Are you sure? That is a high reading!');
    expect(result.sentences).toEqual(['Are you sure?', 'That is a high reading!']);
  });

  it('preserves a partial trailing sentence as remaining', () => {
    const result = extractCompletedSentences('Got it. Now tell me');
    expect(result.sentences).toEqual(['Got it.']);
    expect(result.remaining).toBe('Now tell me');
  });

  it('does not split decimal numbers', () => {
    const result = extractCompletedSentences('Your temperature was 99.5 today. Let me know.');
    expect(result.sentences).toEqual([
      'Your temperature was 99.5 today.',
      'Let me know.',
    ]);
  });

  it('splits on the Bengali full-stop "।"', () => {
    const result = extractCompletedSentences('আপনি কেমন আছেন। আমি ভালো আছি। ');
    expect(result.sentences).toEqual(['আপনি কেমন আছেন।', 'আমি ভালো আছি।']);
    expect(result.remaining).toBe('');
  });

  it('handles mixed-script text', () => {
    const result = extractCompletedSentences('That is good. आपका BP normal hai। Anything else?');
    expect(result.sentences).toEqual([
      'That is good.',
      'आपका BP normal hai।',
      'Anything else?',
    ]);
  });

  it('splits at end-of-buffer terminator (no trailing whitespace)', () => {
    const result = extractCompletedSentences('Hello world.');
    expect(result.sentences).toEqual(['Hello world.']);
    expect(result.remaining).toBe('');
  });

  it('treats decimals followed by terminator correctly', () => {
    // "99.5." would be: 99.5 (decimal, no split) + . (terminator)
    const result = extractCompletedSentences('Reading was 99.5.');
    expect(result.sentences).toEqual(['Reading was 99.5.']);
  });
});

describe('StreamingSentenceDetector', () => {
  it('returns nothing on empty feed', () => {
    const d = new StreamingSentenceDetector();
    expect(d.feed('')).toEqual([]);
    expect(d.flush()).toEqual([]);
  });

  it('emits a sentence when a terminator is fed', () => {
    const d = new StreamingSentenceDetector();
    expect(d.feed('Hello world')).toEqual([]);
    expect(d.feed('. ')).toEqual(['Hello world.']);
  });

  it('buffers across multiple feeds until a sentence completes', () => {
    const d = new StreamingSentenceDetector();
    expect(d.feed('I heard ')).toEqual([]);
    expect(d.feed('one thirty')).toEqual([]);
    expect(d.feed(' over eighty five. ')).toEqual(['I heard one thirty over eighty five.']);
  });

  it('emits multiple sentences from one feed', () => {
    const d = new StreamingSentenceDetector();
    expect(d.feed('First. Second. Third.')).toEqual(['First.', 'Second.', 'Third.']);
  });

  it('flush() drains a trailing partial as a final sentence', () => {
    const d = new StreamingSentenceDetector();
    d.feed('First sentence. Trailing partial');
    expect(d.flush()).toEqual(['Trailing partial']);
  });

  it('flush() returns empty when buffer is clean', () => {
    const d = new StreamingSentenceDetector();
    d.feed('Complete sentence. ');
    expect(d.flush()).toEqual([]);
  });

  it('handles realistic chunked Bedrock-style stream', () => {
    const d = new StreamingSentenceDetector();
    const chunks = [
      'I',
      ' heard',
      ' one',
      ' thirty',
      ' over',
      ' eighty',
      ' five',
      '. ',
      'Is',
      ' that',
      ' correct',
      '? ',
    ];
    const allSentences: string[] = [];
    for (const c of chunks) {
      allSentences.push(...d.feed(c));
    }
    allSentences.push(...d.flush());
    expect(allSentences).toEqual(['I heard one thirty over eighty five.', 'Is that correct?']);
  });

  it('handles Bengali stream', () => {
    const d = new StreamingSentenceDetector();
    expect(d.feed('আপনি কেমন')).toEqual([]);
    expect(d.feed(' আছেন। ')).toEqual(['আপনি কেমন আছেন।']);
    expect(d.feed('আমি ঠিক আছি। ')).toEqual(['আমি ঠিক আছি।']);
  });
});

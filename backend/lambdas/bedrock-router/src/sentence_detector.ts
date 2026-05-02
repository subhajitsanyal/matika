// Sentence-boundary detector for streamed `responseText`.
//
// Used by sub-increment 4b's SSE emitter: as Bedrock streams tokens, the
// emitter buffers them and uses this detector to decide when a sentence is
// complete. Each completed sentence becomes one SSE `sentence` event,
// queued to Android TextToSpeech for sentence-buffered playback (spec §6.6,
// §8.5, AGENTS.md mobile-app role).
//
// Pure function. No IO. Deliberately conservative — we'd rather emit a
// sentence late than split mid-sentence and produce stilted TTS.

// Sentence-ending punctuation across en/hi/bn:
//   English/Hindi: . ! ?
//   Bengali:       । (devanagari/bengali full stop)
//
// We split when a terminator is followed by whitespace OR end-of-buffer.
// Decimal numbers are handled implicitly: "1.5" doesn't split because the
// `.` is followed by `5`, not whitespace/EOL.
//
// Caveat: abbreviations like "Mr.", "Dr." would falsely split. We don't
// currently guard against these because the LLM is told to write in
// conversational sentences, not abbreviated form. If pilot data shows false
// splits, add an abbreviation allow-list here.
const SENTENCE_TERMINATOR = /([.!?।])(\s|$)/g;

export interface DetectedSentences {
  sentences: string[]; // newly completed sentences, in order
  remaining: string; // partial-sentence buffer to carry forward
}

// Given a running buffer of text (accumulated tokens), return any newly
// completed sentences plus the remaining partial. Caller passes the
// remaining-partial back as input for the next call concatenated with new
// tokens.
export function extractCompletedSentences(buffer: string): DetectedSentences {
  if (!buffer) return { sentences: [], remaining: '' };

  const sentences: string[] = [];
  let cursor = 0;

  // Scan for terminator+whitespace pairs.
  SENTENCE_TERMINATOR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_TERMINATOR.exec(buffer)) !== null) {
    const terminatorIdx = match.index;
    const sentenceEndExclusive = terminatorIdx + 1; // include terminator
    const sentence = buffer.slice(cursor, sentenceEndExclusive).trim();
    if (sentence.length > 0) sentences.push(sentence);
    // Advance past any whitespace that followed the terminator.
    cursor = sentenceEndExclusive;
    while (cursor < buffer.length && /\s/.test(buffer[cursor])) cursor++;
    SENTENCE_TERMINATOR.lastIndex = cursor;
  }

  return {
    sentences,
    remaining: buffer.slice(cursor),
  };
}

// Stateful streaming-friendly variant. Pass an instance through the stream
// loop; call `feed(tokens)` to get newly completed sentences; call `flush()`
// at end-of-stream to drain any trailing partial as one final sentence.
export class StreamingSentenceDetector {
  private buffer = '';

  feed(tokens: string): string[] {
    this.buffer += tokens;
    const { sentences, remaining } = extractCompletedSentences(this.buffer);
    this.buffer = remaining;
    return sentences;
  }

  // Drain any trailing buffer at end-of-stream. Returns at most one final
  // sentence — whatever didn't end in punctuation.
  flush(): string[] {
    const trimmed = this.buffer.trim();
    this.buffer = '';
    return trimmed.length > 0 ? [trimmed] : [];
  }
}

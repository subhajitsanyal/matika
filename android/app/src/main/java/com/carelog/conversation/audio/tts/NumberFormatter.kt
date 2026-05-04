package com.carelog.conversation.audio.tts

/**
 * Pre-formats LLM response text for natural TTS readout when the
 * backend signals `ttsHints.spellOutNumbers = true`.
 *
 * Spec: docs/matika_spec_v2.md §4.1 (`ttsHints.spellOutNumbers`) +
 * §8.1 (`NumberFormatter` purpose).
 *
 * Behaviour:
 *  - When `spellOutNumbers` is `false` or the language is not English,
 *    the text is returned unchanged. The LLM is signalling either
 *    "I've already produced TTS-friendly text" or "the per-language
 *    TTS engine handles digits natively" (true for the Indic engines
 *    on Android for `hi-IN` and `bn-IN`).
 *  - When `spellOutNumbers` is `true` and language is English, BP-style
 *    spelling is applied: `130/85` → `one thirty over eighty five`,
 *    `36.5` → `thirty six point five`, `142` → `one forty two`.
 *
 * Range: 0..999 — covers the vital-signs space (BP, glucose, weight,
 * temperature, SpO2). Numbers outside this range pass through as-is;
 * the platform TTS reads them digit-by-digit, which is acceptable for
 * the rare edge case.
 */
object NumberFormatter {

    private val ONES = listOf(
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
        "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
        "sixteen", "seventeen", "eighteen", "nineteen",
    )

    private val TENS = listOf(
        "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    )

    // \b word boundaries keep us from eating digits embedded in tokens
    // like `V001` or `S3-key-2026`. Order of application (slash → decimal
    // → standalone) matters because earlier passes consume digits that
    // would otherwise be re-matched by later passes.
    private val NUMBER_SLASH_REGEX = Regex("""\b(\d+)/(\d+)\b""")
    private val NUMBER_DECIMAL_REGEX = Regex("""\b(\d+)\.(\d+)\b""")
    private val STANDALONE_INTEGER_REGEX = Regex("""\b\d+\b""")

    /**
     * Apply [spellOutNumbers] formatting to [text] for the given
     * [languageTag] (BCP-47, e.g. `en-IN`).
     */
    fun format(text: String, languageTag: String, spellOutNumbers: Boolean): String {
        if (!spellOutNumbers) return text
        if (!languageTag.startsWith("en", ignoreCase = true)) return text

        val withSlashes = NUMBER_SLASH_REGEX.replace(text) { match ->
            val a = match.groupValues[1].toIntOrNull()
            val b = match.groupValues[2].toIntOrNull()
            if (a != null && b != null && a in 0..999 && b in 0..999) {
                "${spellInteger(a)} over ${spellInteger(b)}"
            } else {
                match.value
            }
        }

        val withDecimals = NUMBER_DECIMAL_REGEX.replace(withSlashes) { match ->
            val whole = match.groupValues[1].toIntOrNull()
            val frac = match.groupValues[2]
            if (whole != null && whole in 0..999) {
                val fracSpelled = frac.map { ONES[it.digitToInt()] }.joinToString(" ")
                "${spellInteger(whole)} point $fracSpelled"
            } else {
                match.value
            }
        }

        return STANDALONE_INTEGER_REGEX.replace(withDecimals) { match ->
            val n = match.value.toIntOrNull()
            if (n != null && n in 0..999) spellInteger(n) else match.value
        }
    }

    /**
     * Spell a 0..999 integer in the BP-style register the spec example
     * calls for: `130` → `one thirty`, `105` → `one oh five`,
     * `200` → `two hundred`. Throws on out-of-range input — callers
     * should range-check before calling.
     */
    fun spellInteger(n: Int): String {
        require(n in 0..999) { "spellInteger only supports 0..999, got $n" }
        return when {
            n < 20 -> ONES[n]
            n < 100 -> spellTwoDigit(n)
            else -> spellThreeDigit(n)
        }
    }

    private fun spellTwoDigit(n: Int): String {
        val t = n / 10
        val o = n % 10
        return if (o == 0) TENS[t] else "${TENS[t]} ${ONES[o]}"
    }

    private fun spellThreeDigit(n: Int): String {
        val h = n / 100
        val rest = n % 100
        return when {
            rest == 0 -> "${ONES[h]} hundred"
            // 101..109 → "one oh five" (natural BP/glucose register).
            rest < 10 -> "${ONES[h]} oh ${ONES[rest]}"
            // 110..119 → "one fifteen". Not "one one fifteen".
            rest < 20 -> "${ONES[h]} ${ONES[rest]}"
            // 120..199 → "one thirty / one thirty five" (hundreds digit
            // + standard sub-100 readout, no "and").
            else -> "${ONES[h]} ${spellTwoDigit(rest)}"
        }
    }
}

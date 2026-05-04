package com.carelog.conversation.audio.tts

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Tests for [NumberFormatter] BP-style spelling and pass-through cases.
 *
 * The spec example to anchor on (matika_spec_v2.md §8.1):
 *   `130/85` with `spellOutNumbers=true` and `language=en-IN`
 *   → `one thirty over eighty five`
 */
class NumberFormatterTest {

    private val EN = "en-IN"

    // ── spellInteger 0..999 — register tests ──────────────────

    @Test
    fun `spellInteger covers single digits`() {
        assertEquals("zero", NumberFormatter.spellInteger(0))
        assertEquals("five", NumberFormatter.spellInteger(5))
        assertEquals("nine", NumberFormatter.spellInteger(9))
    }

    @Test
    fun `spellInteger covers teens`() {
        assertEquals("ten", NumberFormatter.spellInteger(10))
        assertEquals("thirteen", NumberFormatter.spellInteger(13))
        assertEquals("nineteen", NumberFormatter.spellInteger(19))
    }

    @Test
    fun `spellInteger covers tens-and-ones`() {
        assertEquals("twenty", NumberFormatter.spellInteger(20))
        assertEquals("twenty five", NumberFormatter.spellInteger(25))
        assertEquals("thirty six", NumberFormatter.spellInteger(36))
        assertEquals("eighty five", NumberFormatter.spellInteger(85))
        assertEquals("ninety nine", NumberFormatter.spellInteger(99))
    }

    @Test
    fun `spellInteger handles round hundreds`() {
        assertEquals("one hundred", NumberFormatter.spellInteger(100))
        assertEquals("two hundred", NumberFormatter.spellInteger(200))
        assertEquals("nine hundred", NumberFormatter.spellInteger(900))
    }

    @Test
    fun `spellInteger uses oh for x01 to x09 BP register`() {
        assertEquals("one oh five", NumberFormatter.spellInteger(105))
        assertEquals("two oh nine", NumberFormatter.spellInteger(209))
    }

    @Test
    fun `spellInteger handles x10 to x19 with no extra word`() {
        assertEquals("one ten", NumberFormatter.spellInteger(110))
        assertEquals("one fifteen", NumberFormatter.spellInteger(115))
        assertEquals("one nineteen", NumberFormatter.spellInteger(119))
    }

    @Test
    fun `spellInteger uses BP register for x20 to x99`() {
        assertEquals("one twenty", NumberFormatter.spellInteger(120))
        assertEquals("one thirty", NumberFormatter.spellInteger(130))
        assertEquals("one forty two", NumberFormatter.spellInteger(142))
        assertEquals("two fifty", NumberFormatter.spellInteger(250))
        assertEquals("nine ninety nine", NumberFormatter.spellInteger(999))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `spellInteger rejects negative`() {
        NumberFormatter.spellInteger(-1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `spellInteger rejects above 999`() {
        NumberFormatter.spellInteger(1000)
    }

    // ── format() — spec example ────────────────────────────────

    @Test
    fun `format BP slash example matches spec`() {
        assertEquals(
            "BP is one thirty over eighty five",
            NumberFormatter.format("BP is 130/85", EN, spellOutNumbers = true),
        )
    }

    @Test
    fun `format spells standalone integers`() {
        assertEquals(
            "Sugar is one forty two",
            NumberFormatter.format("Sugar is 142", EN, spellOutNumbers = true),
        )
    }

    @Test
    fun `format handles temperature decimals`() {
        assertEquals(
            "Temperature is thirty six point five",
            NumberFormatter.format("Temperature is 36.5", EN, spellOutNumbers = true),
        )
    }

    @Test
    fun `format spells multiple-digit fractional digits one by one`() {
        // 98.67 → "ninety eight point six seven" — each fractional digit
        // pronounced individually, the natural medical-readout style.
        assertEquals(
            "ninety eight point six seven",
            NumberFormatter.format("98.67", EN, spellOutNumbers = true),
        )
    }

    // ── format() — pass-through cases ──────────────────────────

    @Test
    fun `format passes through when spellOutNumbers is false`() {
        val text = "BP is 130/85, sugar 142"
        assertEquals(text, NumberFormatter.format(text, EN, spellOutNumbers = false))
    }

    @Test
    fun `format passes through for Hindi even with spellOutNumbers true`() {
        // Indic TTS engines pronounce digits natively in their script;
        // English-style spelling would corrupt the output.
        val text = "बीपी 130/85 है"
        assertEquals(text, NumberFormatter.format(text, "hi-IN", spellOutNumbers = true))
    }

    @Test
    fun `format passes through for Bengali even with spellOutNumbers true`() {
        val text = "রক্তচাপ 120/80"
        assertEquals(text, NumberFormatter.format(text, "bn-IN", spellOutNumbers = true))
    }

    // ── format() — robustness ──────────────────────────────────

    @Test
    fun `format leaves out-of-range numbers as digits`() {
        // 1500 is outside our 0..999 spelling range — let TTS read it.
        assertEquals(
            "Weight is 1500 grams",
            NumberFormatter.format("Weight is 1500 grams", EN, spellOutNumbers = true),
        )
    }

    @Test
    fun `format does not eat digits in compound tokens`() {
        // Word boundaries protect identifiers: in `V001` there's no \b
        // between V and 0 (both word chars), so the regex never
        // matches the embedded digits. In `S3` same story. `2026` IS a
        // standalone integer match, but it's outside our 0..999 spell
        // range, so it falls through unchanged. Net: pure passthrough.
        val input = "Saved to S3 key V001-2026"
        val output = NumberFormatter.format(input, EN, spellOutNumbers = true)
        assertEquals(input, output)
    }

    @Test
    fun `format handles empty and digit-free text`() {
        assertEquals("", NumberFormatter.format("", EN, spellOutNumbers = true))
        assertEquals(
            "How are you feeling today?",
            NumberFormatter.format("How are you feeling today?", EN, spellOutNumbers = true),
        )
    }
}

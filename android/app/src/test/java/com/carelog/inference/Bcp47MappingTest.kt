package com.carelog.inference

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Pinned mapping from the v1 [com.carelog.core.config.AppLanguage] ISO codes
 * to the BCP-47 tags the v2 backend (and [com.carelog.conversation.audio.stt.SttManager],
 * [com.carelog.conversation.audio.tts.TtsManager]) expect. Caught a real
 * 500 in dev when the client sent `en` instead of `en-IN`.
 */
class Bcp47MappingTest {

    @Test
    fun `iso codes map to en-IN, hi-IN, bn-IN`() {
        assertEquals("en-IN", toBcp47("en"))
        assertEquals("hi-IN", toBcp47("hi"))
        assertEquals("bn-IN", toBcp47("bn"))
    }

    @Test
    fun `mapping is case-insensitive`() {
        assertEquals("en-IN", toBcp47("EN"))
        assertEquals("hi-IN", toBcp47("Hi"))
    }

    @Test
    fun `already-BCP-47 tags pass through`() {
        // If AppSettings ever switches to BCP-47, this layer doesn't
        // double-tag.
        assertEquals("en-IN", toBcp47("en-IN"))
        assertEquals("en-US", toBcp47("en-US"))
        assertEquals("hi-IN", toBcp47("hi-IN"))
    }

    @Test
    fun `unknown codes pass through unchanged`() {
        // Better to send an unknown tag and let the backend reject it
        // than to silently coerce. Keeps the failure mode visible.
        assertEquals("ja", toBcp47("ja"))
        assertEquals("", toBcp47(""))
    }
}

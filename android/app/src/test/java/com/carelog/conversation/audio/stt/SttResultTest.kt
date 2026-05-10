package com.carelog.conversation.audio.stt

import android.speech.SpeechRecognizer
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Tests for the framework-error-int → [SttErrorCode] mapping.
 *
 * Pure JVM test — `SpeechRecognizer.ERROR_*` are `static final int`
 * constants inlined at compile time, so they resolve correctly against
 * `android.jar` without Robolectric.
 */
class SttResultTest {

    @Test
    fun `audio engine errors map to CLIENT`() {
        assertEquals(SttErrorCode.CLIENT, mapAndroidErrorCode(SpeechRecognizer.ERROR_AUDIO))
        assertEquals(SttErrorCode.CLIENT, mapAndroidErrorCode(SpeechRecognizer.ERROR_CLIENT))
    }

    @Test
    fun `permission denial maps to PERMISSION_DENIED`() {
        assertEquals(
            SttErrorCode.PERMISSION_DENIED,
            mapAndroidErrorCode(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS),
        )
    }

    @Test
    fun `network errors split between NETWORK and TIMEOUT`() {
        assertEquals(SttErrorCode.NETWORK, mapAndroidErrorCode(SpeechRecognizer.ERROR_NETWORK))
        assertEquals(
            SttErrorCode.TIMEOUT,
            mapAndroidErrorCode(SpeechRecognizer.ERROR_NETWORK_TIMEOUT),
        )
    }

    @Test
    fun `recognizer state errors map cleanly`() {
        assertEquals(SttErrorCode.NO_MATCH, mapAndroidErrorCode(SpeechRecognizer.ERROR_NO_MATCH))
        assertEquals(SttErrorCode.BUSY, mapAndroidErrorCode(SpeechRecognizer.ERROR_RECOGNIZER_BUSY))
        assertEquals(SttErrorCode.SERVER, mapAndroidErrorCode(SpeechRecognizer.ERROR_SERVER))
    }

    @Test
    fun `speech timeout maps to TIMEOUT`() {
        assertEquals(
            SttErrorCode.TIMEOUT,
            mapAndroidErrorCode(SpeechRecognizer.ERROR_SPEECH_TIMEOUT),
        )
    }

    @Test
    fun `unrecognized codes fall through to UNKNOWN`() {
        assertEquals(SttErrorCode.UNKNOWN, mapAndroidErrorCode(-1))
        assertEquals(SttErrorCode.UNKNOWN, mapAndroidErrorCode(99))
        assertEquals(SttErrorCode.UNKNOWN, mapAndroidErrorCode(Int.MAX_VALUE))
    }

    @Test
    fun `F25 — language-pack errors map to LANGUAGE_NOT_SUPPORTED`() {
        // F25 (docs/testing_todos_v2.md): SttManager.recognize()'s
        // online-fallback re-arm is gated on these two engine codes
        // exactly. If a future Android API surface adds new
        // language-pack-related error codes that ALSO need the
        // fallback path, update both this assertion AND the gate in
        // SttManager.onError. Keeping them pinned here so that future
        // refactors of the mapping don't silently drop the fallback.
        assertEquals(SttErrorCode.LANGUAGE_NOT_SUPPORTED, mapAndroidErrorCode(12))
        assertEquals(SttErrorCode.LANGUAGE_NOT_SUPPORTED, mapAndroidErrorCode(13))
    }

    @Test
    fun `Final and Partial are distinct types not collapsed by data class equals`() {
        // `Partial("hi")` and `Final("hi")` carry the same string but are
        // different SttResult subtypes — make sure equals() doesn't lie.
        val partial: SttResult = SttResult.Partial("hi")
        val final: SttResult = SttResult.Final("hi")
        assertEquals(false, partial == final)
    }
}

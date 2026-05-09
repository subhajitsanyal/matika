package com.carelog.conversation.audio.stt

import android.os.Bundle
import android.speech.SpeechRecognizer

/**
 * Result of one STT recognition turn. The flow emits zero or more
 * [Partial] events, then exactly one terminal event ([Final] or
 * [Error]) before completing.
 */
sealed class SttResult {
    /** Streaming partial transcript update — do not commit to UI as final. */
    data class Partial(val text: String) : SttResult()

    /** Final transcript for this utterance. Emitted exactly once. */
    data class Final(val text: String) : SttResult()

    /** Terminal error event. The flow completes after emitting this. */
    data class Error(val code: SttErrorCode, val message: String) : SttResult()
}

enum class SttErrorCode {
    /** RECORD_AUDIO not granted, or insufficient. */
    PERMISSION_DENIED,

    /** Recognizer found no candidates for the audio. */
    NO_MATCH,

    /** Network is required (offline pack missing) and is unavailable. */
    NETWORK,

    /** Recognition server returned an error. */
    SERVER,

    /** Recognition timed out — either no input or final beam timed out. */
    TIMEOUT,

    /** Another recognition is already in progress on this recognizer. */
    BUSY,

    /** Generic client-side error reported by the engine. */
    CLIENT,

    /** No speech recognition service installed on the device. */
    UNAVAILABLE,

    /**
     * The engine doesn't have a speech model for the requested
     * language. Most common cause: the offline language pack hasn't
     * been downloaded. Fix on most devices: Settings → System →
     * Languages → Speech → Offline speech recognition → install the
     * matching pack (e.g. English (India)). Patient can also use the
     * text-input fallback while resolving.
     */
    LANGUAGE_NOT_SUPPORTED,

    /** Anything we don't recognize. */
    UNKNOWN,
}

/**
 * Translate an [SpeechRecognizer.ERROR_*] integer into our typed enum.
 * `internal` so package tests can verify the mapping without spinning
 * up a real recognizer.
 */
internal fun mapAndroidErrorCode(code: Int): SttErrorCode = when (code) {
    SpeechRecognizer.ERROR_AUDIO -> SttErrorCode.CLIENT
    SpeechRecognizer.ERROR_CLIENT -> SttErrorCode.CLIENT
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> SttErrorCode.PERMISSION_DENIED
    SpeechRecognizer.ERROR_NETWORK -> SttErrorCode.NETWORK
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> SttErrorCode.TIMEOUT
    SpeechRecognizer.ERROR_NO_MATCH -> SttErrorCode.NO_MATCH
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> SttErrorCode.BUSY
    SpeechRecognizer.ERROR_SERVER -> SttErrorCode.SERVER
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> SttErrorCode.TIMEOUT
    // API 31+ codes — referenced by raw int to keep minSdk=28 compatible.
    // Names: 10=TOO_MANY_REQUESTS, 11=SERVER_DISCONNECTED,
    //        12=LANGUAGE_NOT_SUPPORTED, 13=LANGUAGE_UNAVAILABLE.
    10 -> SttErrorCode.BUSY
    11 -> SttErrorCode.SERVER
    12 -> SttErrorCode.LANGUAGE_NOT_SUPPORTED
    13 -> SttErrorCode.LANGUAGE_NOT_SUPPORTED
    else -> SttErrorCode.UNKNOWN
}

/**
 * Pull the highest-confidence non-blank transcript out of a Bundle of
 * recognition results. F9 fix: previous version returned null when only
 * the *first* hyp was blank, even if subsequent hyps were non-blank —
 * that silently dropped real speech in cases where Soda ranked an empty
 * hyp first (observed under noisy / short utterances).
 */
internal fun extractFirstTranscript(bundle: Bundle?): String? {
    if (bundle == null) return null
    val list = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return null
    return list.firstOrNull { !it.isNullOrBlank() }
}

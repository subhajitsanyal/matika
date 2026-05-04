package com.carelog.conversation.audio.tts

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v2 on-device TTS wrapper around Android's [TextToSpeech].
 *
 * Spec: docs/matika_spec_v2.md §3.1 + §8.1.
 *
 * Lifecycle:
 *  - The underlying [TextToSpeech] engine is created in `init` and
 *    reports readiness asynchronously via the [onInitListener]. Every
 *    [speak] call awaits the [initDeferred] before issuing — callers
 *    don't need to coordinate startup themselves.
 *  - Hilt singleton; one instance for the app lifetime. Call [release]
 *    from a session-level teardown when no further speech is expected.
 *
 * Streaming behaviour: `QUEUE_ADD` (the default) appends to the
 * playback queue, so the typical streaming-response usage of "speak
 * each sentence as it arrives" is just sequential `speak(...)` calls.
 * `QUEUE_FLUSH` is the barge-in path — clear the queue and start the
 * new utterance immediately.
 *
 * Number formatting: the caller is responsible for running
 * [NumberFormatter] on the LLM response when `ttsHints.spellOutNumbers`
 * is true. This class does not inspect the text.
 */
@Singleton
class TtsManager @Inject constructor(
    @ApplicationContext private val appContext: Context,
) {
    private companion object {
        const val TAG = "TtsManager"
        const val UTTERANCE_ID_PREFIX = "matika-tts-"
    }

    /**
     * Resolved on first construction. `Success` means the engine
     * reported ready; `Failure` means we won't be able to speak — UI
     * should show a fallback path (text-only).
     */
    private val initDeferred = CompletableDeferred<TtsInitResult>()

    private var tts: TextToSpeech? = null

    /** Track in-flight utterance IDs so [isSpeaking] is accurate across queued utterances. */
    private val inFlight = ConcurrentHashMap.newKeySet<String>()

    private val _isSpeaking = MutableStateFlow(false)
    /** True iff at least one queued utterance is currently being synthesised or played. */
    val isSpeaking: StateFlow<Boolean> = _isSpeaking.asStateFlow()

    private val progressListener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            if (utteranceId == null) return
            inFlight.add(utteranceId)
            _isSpeaking.value = inFlight.isNotEmpty()
        }

        override fun onDone(utteranceId: String?) {
            if (utteranceId == null) return
            inFlight.remove(utteranceId)
            _isSpeaking.value = inFlight.isNotEmpty()
        }

        // Deprecated overload — older platforms only call this one. We
        // override both to be safe; either path drains the in-flight set.
        @Deprecated("Older API; the int-error variant is preferred.")
        override fun onError(utteranceId: String?) {
            if (utteranceId == null) return
            inFlight.remove(utteranceId)
            _isSpeaking.value = inFlight.isNotEmpty()
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            Log.w(TAG, "Utterance $utteranceId failed with errorCode=$errorCode")
            if (utteranceId == null) return
            inFlight.remove(utteranceId)
            _isSpeaking.value = inFlight.isNotEmpty()
        }
    }

    init {
        // The OnInitListener may fire on a background thread; the
        // CompletableDeferred handles either ordering relative to the
        // assignment below.
        tts = TextToSpeech(appContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.setOnUtteranceProgressListener(progressListener)
                initDeferred.complete(TtsInitResult.Success)
            } else {
                initDeferred.complete(
                    TtsInitResult.Failure("TextToSpeech.onInit returned status=$status"),
                )
            }
        }
    }

    /**
     * Set the engine voice for [languageTag] (BCP-47 — `en-IN`,
     * `hi-IN`, `bn-IN`). Returns [TtsLanguageStatus.MissingData] if
     * the voice data needs to be downloaded; the UI should prompt the
     * user via the system Settings → Text-to-speech screen.
     */
    suspend fun setLanguage(languageTag: String): TtsLanguageStatus {
        val init = initDeferred.await()
        if (init !is TtsInitResult.Success) return TtsLanguageStatus.NotInitialized
        val engine = tts ?: return TtsLanguageStatus.NotInitialized
        val locale = Locale.forLanguageTag(languageTag)
        return when (engine.setLanguage(locale)) {
            TextToSpeech.LANG_AVAILABLE,
            TextToSpeech.LANG_COUNTRY_AVAILABLE,
            TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE -> TtsLanguageStatus.Available
            TextToSpeech.LANG_MISSING_DATA -> TtsLanguageStatus.MissingData
            TextToSpeech.LANG_NOT_SUPPORTED -> TtsLanguageStatus.NotSupported
            else -> TtsLanguageStatus.NotSupported
        }
    }

    /**
     * Queue [text] for speech. Awaits engine init before issuing.
     *
     * @param queueMode [TtsQueueMode.ADD] appends; [TtsQueueMode.FLUSH]
     *   interrupts whatever is currently speaking and starts immediately.
     *   Use FLUSH for barge-in (user starts speaking) and the start of a
     *   fresh response; ADD for sentence-by-sentence streaming.
     */
    suspend fun speak(
        text: String,
        languageTag: String,
        queueMode: TtsQueueMode = TtsQueueMode.ADD,
    ): TtsSpeakResult {
        if (text.isBlank()) return TtsSpeakResult.EmptyText
        val init = initDeferred.await()
        if (init !is TtsInitResult.Success) return TtsSpeakResult.NotInitialized

        val langStatus = setLanguage(languageTag)
        when (langStatus) {
            TtsLanguageStatus.MissingData -> return TtsSpeakResult.LanguageUnavailable(langStatus)
            TtsLanguageStatus.NotSupported -> return TtsSpeakResult.LanguageUnavailable(langStatus)
            TtsLanguageStatus.NotInitialized -> return TtsSpeakResult.NotInitialized
            TtsLanguageStatus.Available -> Unit // proceed
        }

        val engine = tts ?: return TtsSpeakResult.NotInitialized
        val utteranceId = "$UTTERANCE_ID_PREFIX${System.nanoTime()}"
        val mode = when (queueMode) {
            TtsQueueMode.ADD -> TextToSpeech.QUEUE_ADD
            TtsQueueMode.FLUSH -> TextToSpeech.QUEUE_FLUSH
        }
        val result = engine.speak(text, mode, /* params = */ null, utteranceId)
        return if (result == TextToSpeech.SUCCESS) {
            TtsSpeakResult.Queued(utteranceId)
        } else {
            TtsSpeakResult.EngineRejected
        }
    }

    /** Stop any in-progress speech and clear the queue. Use for barge-in. */
    fun stop() {
        runCatching { tts?.stop() }
        inFlight.clear()
        _isSpeaking.value = false
    }

    /**
     * Tear down the underlying [TextToSpeech]. Safe to call repeatedly.
     * The instance is not re-creatable — callers expecting more speech
     * after a release would need a fresh [TtsManager], which Hilt does
     * not currently provide. Reserve [release] for app-shutdown paths.
     */
    fun release() {
        runCatching { tts?.shutdown() }
        tts = null
        inFlight.clear()
        _isSpeaking.value = false
    }
}

// ── Public result types ────────────────────────────────────────

sealed class TtsInitResult {
    data object Success : TtsInitResult()
    data class Failure(val message: String) : TtsInitResult()
}

enum class TtsLanguageStatus {
    /** Engine is ready and the requested locale is supported. */
    Available,

    /** Engine is ready but the voice data for this language needs to be downloaded. */
    MissingData,

    /** Engine reports the language is not supported at all on this device. */
    NotSupported,

    /** Engine never finished initializing — `speak()` will fail until it does. */
    NotInitialized,
}

enum class TtsQueueMode {
    /** Append to the playback queue (default). Use for streaming sentences. */
    ADD,

    /** Clear the queue and start immediately. Use for barge-in. */
    FLUSH,
}

sealed class TtsSpeakResult {
    /** Successfully queued. [utteranceId] tracks completion via [TtsManager.isSpeaking]. */
    data class Queued(val utteranceId: String) : TtsSpeakResult()

    /** The engine rejected the request (returned a non-SUCCESS code). */
    data object EngineRejected : TtsSpeakResult()

    /** Caller passed blank text — nothing queued. */
    data object EmptyText : TtsSpeakResult()

    /** Engine never initialised — no speech possible without a fresh [TtsManager]. */
    data object NotInitialized : TtsSpeakResult()

    /**
     * Language-pack issue. UI should surface a "download voice data"
     * prompt that opens the system TTS settings. Carries the precise
     * status so callers can distinguish missing-data from unsupported.
     */
    data class LanguageUnavailable(val status: TtsLanguageStatus) : TtsSpeakResult()
}

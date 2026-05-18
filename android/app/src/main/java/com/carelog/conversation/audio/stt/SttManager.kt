package com.carelog.conversation.audio.stt

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import com.google.firebase.crashlytics.FirebaseCrashlytics
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v2 on-device STT wrapper around Android's [SpeechRecognizer].
 *
 * Spec: docs/matika_spec_v2.md §3.1 + §8.3.
 *
 * Behaviour:
 *  - First attempt requests [RecognizerIntent.EXTRA_PREFER_OFFLINE].
 *    On most devices the platform silently falls back to online
 *    recognition if the offline pack is missing — but on Samsung One UI
 *    and some Bengali/Hindi configurations the engine instead surfaces
 *    error 12 (LANGUAGE_NOT_SUPPORTED) or 13 (LANGUAGE_UNAVAILABLE)
 *    without trying the network. F25 fix: when that happens, we
 *    transparently retry once with `EXTRA_PREFER_OFFLINE=false` so the
 *    turn reaches Bedrock either way. The retry is invisible to the
 *    collector — it only sees Partial → Final/Error from whichever
 *    pass succeeds. Logcat carries "stt_offline_used=false" on the
 *    fallback path so the agentic voice harness can record which
 *    recognition mode actually served a turn.
 *  - Emits streaming [SttResult.Partial] events plus exactly one
 *    terminal [SttResult.Final] or [SttResult.Error]. Cancelling the
 *    collecting flow stops the recognizer; the engine may still emit
 *    a delayed final result that will be discarded.
 *
 * Lifecycle: a single [SpeechRecognizer] instance is held for the
 * Singleton lifetime and reused across utterances. Call [release]
 * from session-end paths to free the underlying audio resources.
 *
 * Thread model: [SpeechRecognizer] requires creation and method calls
 * on a thread with a Looper. We funnel everything through
 * [Dispatchers.Main.immediate] so callers can invoke from any
 * dispatcher.
 */
@Singleton
class SttManager @Inject constructor(
    @ApplicationContext private val appContext: Context,
) {
    private companion object {
        const val TAG = "SttManager"
    }

    private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var recognizer: SpeechRecognizer? = null
    private val isListening = AtomicBoolean(false)

    /** True when the device has at least one speech recognition service. */
    fun isAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(appContext)

    /**
     * Begin one recognition turn. The returned Flow emits zero or more
     * [SttResult.Partial] events and exactly one terminal event
     * ([SttResult.Final] or [SttResult.Error]) before completing.
     * Cancelling the collector stops the recognizer.
     *
     * @param languageTag IETF BCP-47 tag — `en-IN`, `hi-IN`, `bn-IN`.
     *   Tags outside this set are passed through; behaviour depends on
     *   what the underlying engine reports as supported.
     */
    fun recognize(languageTag: String): Flow<SttResult> = callbackFlow {
        if (!isAvailable()) {
            trySend(
                SttResult.Error(
                    SttErrorCode.UNAVAILABLE,
                    "No speech recognition service available on this device.",
                ),
            )
            close()
            return@callbackFlow
        }

        // Atomically claim the recognizer; second concurrent caller gets BUSY.
        if (!isListening.compareAndSet(false, true)) {
            trySend(SttResult.Error(SttErrorCode.BUSY, "Recognizer already listening."))
            close()
            return@callbackFlow
        }

        // Tracks whether we've already used the online-fallback path on
        // this recognize() call. Kept on the heap (rather than as a
        // listener field) so the listener can read+update it atomically
        // across the original-arming and the retry callback.
        val onlineFallbackUsed = AtomicBoolean(false)

        // Builds a fresh RecognitionListener for the requested
        // (preferOffline) pass. On error 12/13 from the offline-preferred
        // pass we suppress the error from the collector and re-arm with
        // preferOffline=false. On the same error from the fallback pass
        // OR any other error from either pass, we surface to collector.
        fun buildListener(preferOffline: Boolean): RecognitionListener = object : RecognitionListener {
            override fun onPartialResults(partialResults: Bundle?) {
                extractFirstTranscript(partialResults)?.let {
                    trySend(SttResult.Partial(it))
                }
            }

            override fun onResults(results: Bundle?) {
                // F9 — if Soda returned hypotheses but every one is
                // blank/whitespace, that's a NO_MATCH (not a successful
                // empty transcript) and we must surface it as an error
                // so the VM doesn't silently drop the turn. Logging both
                // success and failure here so future regressions show up
                // in logcat without a separate trace tool.
                val text = extractFirstTranscript(results)
                if (text.isNullOrBlank()) {
                    Log.w(TAG, "RecognitionListener.onResults: no usable hyp (all blank or null) — emitting NO_MATCH")
                    trySend(
                        SttResult.Error(
                            SttErrorCode.NO_MATCH,
                            "RecognitionListener.onResults returned no non-blank hypotheses",
                        ),
                    )
                } else {
                    Log.i(
                        TAG,
                        "RecognitionListener.onResults chars=${text.length} stt_offline_used=$preferOffline",
                    )
                    trySend(SttResult.Final(text))
                }
                isListening.set(false)
                channel.close()
            }

            override fun onError(error: Int) {
                Log.w(TAG, "RecognitionListener.onError($error) preferOffline=$preferOffline")
                // Crashlytics breadcrumb only — STT errors are too noisy
                // for non-fatals; the breadcrumb gives a future crash the
                // surrounding STT context (last error code + lang) without
                // a per-error report. runCatching keeps JVM unit tests
                // safe (FirebaseApp uninitialized).
                runCatching {
                    FirebaseCrashlytics.getInstance().log(
                        "stt onError code=$error preferOffline=$preferOffline lang=$languageTag",
                    )
                }

                // F25 — silent online fallback. Only retry on the
                // offline-preferred pass and only for the exact engine
                // codes that mean "engine never tried the network."
                // 12 = LANGUAGE_NOT_SUPPORTED, 13 = LANGUAGE_UNAVAILABLE.
                val isLanguagePackError = error == 12 || error == 13
                if (preferOffline && isLanguagePackError && onlineFallbackUsed.compareAndSet(false, true)) {
                    Log.i(
                        TAG,
                        "stt_offline_used=false: language pack missing for $languageTag, " +
                            "retrying with EXTRA_PREFER_OFFLINE=false",
                    )
                    // Re-arm on the SAME recognizer with online fallback.
                    // Must run on Main (recognizer's Looper).
                    mainScope.launch {
                        val rec = recognizer ?: return@launch
                        runCatching {
                            rec.setRecognitionListener(buildListener(preferOffline = false))
                            rec.startListening(buildRecognitionIntent(languageTag, preferOffline = false))
                        }.onFailure {
                            Log.e(TAG, "stt online-fallback re-arm failed", it)
                            runCatching { FirebaseCrashlytics.getInstance().recordException(it) }
                            trySend(
                                SttResult.Error(
                                    mapAndroidErrorCode(error),
                                    "RecognitionListener error: $error (online-fallback re-arm failed: ${it.message})",
                                ),
                            )
                            isListening.set(false)
                            channel.close()
                        }
                    }
                    return
                }

                trySend(
                    SttResult.Error(
                        mapAndroidErrorCode(error),
                        "RecognitionListener error: $error",
                    ),
                )
                isListening.set(false)
                channel.close()
            }

            override fun onReadyForSpeech(params: Bundle?) {
                // Deterministic mic-armed signal for the agentic voice
                // harness (`scripts/matika-voice-run.sh`). Soda's own
                // "Offline recognizer - start listening" line is emitted
                // only on Pixel/Google builds — Samsung devices fire a
                // different system-level log, breaking the harness's
                // logcat trigger. Emitting this from inside the app
                // makes the trigger device-independent.
                Log.i(TAG, "RecognitionListener.onReadyForSpeech: mic open preferOffline=$preferOffline")
            }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        }

        // SpeechRecognizer must be created and called from a Looper thread.
        // Funnel through Main regardless of the collector's dispatcher.
        withContext(Dispatchers.Main.immediate) {
            val rec = recognizer ?: SpeechRecognizer
                .createSpeechRecognizer(appContext)
                .also { recognizer = it }
            rec.setRecognitionListener(buildListener(preferOffline = true))
            rec.startListening(buildRecognitionIntent(languageTag, preferOffline = true))
        }

        awaitClose {
            // Mark idle synchronously so a follow-up recognize() call
            // doesn't see the stale BUSY state.
            isListening.set(false)
            // SpeechRecognizer methods must be called on the same Looper
            // that created it (Main). Fire-and-forget so the cancelling
            // collector returns promptly.
            mainScope.launch {
                runCatching { recognizer?.stopListening() }
            }
        }
    }

    /**
     * Tear down the underlying [SpeechRecognizer] and release the
     * microphone resources it holds. Safe to call repeatedly. The next
     * [recognize] call will lazily create a fresh recognizer.
     */
    fun release() {
        mainScope.launch {
            runCatching { recognizer?.destroy() }
            recognizer = null
            isListening.set(false)
        }
    }

    private fun buildRecognitionIntent(languageTag: String, preferOffline: Boolean): Intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
            )
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, languageTag)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, appContext.packageName)
        }
}

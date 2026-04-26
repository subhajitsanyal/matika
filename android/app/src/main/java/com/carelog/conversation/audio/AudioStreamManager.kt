package com.carelog.conversation.audio

import android.util.Log
import com.carelog.core.di.MacMiniApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages WebSocket connections for STT and TTS streaming.
 *
 * - STT streaming: sends audio chunks, receives partial/final transcripts.
 * - TTS streaming: sends text, receives audio chunks for playback.
 */
@Singleton
class AudioStreamManager @Inject constructor(
    @MacMiniApi private val okHttpClient: OkHttpClient
) {

    companion object {
        private const val TAG = "AudioStreamManager"
        private const val STT_STREAM_PATH = "/transcribe/stream"
        private const val TTS_STREAM_PATH = "/synthesize/stream"
    }

    // ── STT Streaming ───────────────────────────────────────────

    private var sttWebSocket: WebSocket? = null

    private val _sttTranscripts = MutableSharedFlow<SttStreamEvent>(extraBufferCapacity = 16)
    /** Transcript events from the STT streaming WebSocket. */
    val sttTranscripts: SharedFlow<SttStreamEvent> = _sttTranscripts.asSharedFlow()

    private val _sttConnected = MutableStateFlow(false)
    val sttConnected: StateFlow<Boolean> = _sttConnected.asStateFlow()

    /**
     * Open a WebSocket connection to the STT streaming endpoint.
     *
     * @param macMiniBaseUrl Base URL of the Mac Mini (e.g., "http://192.168.1.50:8001").
     * @param language Language code: "en", "hi", or "bn".
     */
    fun connectStt(macMiniBaseUrl: String, language: String) {
        disconnectStt()

        val wsUrl = macMiniBaseUrl.replace("http://", "ws://")
            .replace("https://", "wss://") +
            STT_STREAM_PATH + "?language=$language&sample_rate=${AudioFormat.SAMPLE_RATE}"

        val request = Request.Builder().url(wsUrl).build()

        sttWebSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "STT WebSocket connected")
                _sttConnected.value = true
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                // Parse JSON transcript message
                try {
                    val event = parseSttMessage(text)
                    _sttTranscripts.tryEmit(event)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to parse STT message", e)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "STT WebSocket closing: $reason")
                webSocket.close(1000, null)
                _sttConnected.value = false
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "STT WebSocket closed")
                _sttConnected.value = false
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "STT WebSocket failure", t)
                _sttConnected.value = false
            }
        })
    }

    /**
     * Send an audio chunk to the STT WebSocket.
     */
    fun sendAudioChunk(audioData: ByteArray) {
        sttWebSocket?.send(ByteString.of(*audioData))
    }

    /**
     * Signal end of audio stream to STT.
     */
    fun finishSttStream() {
        // Send an empty message to signal end-of-stream
        sttWebSocket?.send("")
    }

    /** Disconnect the STT WebSocket. */
    fun disconnectStt() {
        sttWebSocket?.close(1000, "Client disconnect")
        sttWebSocket = null
        _sttConnected.value = false
    }

    // ── TTS Streaming ───────────────────────────────────────────

    private var ttsWebSocket: WebSocket? = null

    private val _ttsAudioChunks = MutableSharedFlow<ByteArray>(extraBufferCapacity = 32)
    /** Audio chunks from the TTS streaming WebSocket. */
    val ttsAudioChunks: SharedFlow<ByteArray> = _ttsAudioChunks.asSharedFlow()

    private val _ttsConnected = MutableStateFlow(false)
    val ttsConnected: StateFlow<Boolean> = _ttsConnected.asStateFlow()

    private val _ttsComplete = MutableSharedFlow<Unit>(extraBufferCapacity = 4)
    /** Emitted when TTS streaming playback is complete. */
    val ttsComplete: SharedFlow<Unit> = _ttsComplete.asSharedFlow()

    /**
     * Open a WebSocket connection to the TTS streaming endpoint.
     *
     * @param macMiniBaseUrl Base URL of the Mac Mini (e.g., "http://192.168.1.50:8003").
     * @param language Language code.
     */
    fun connectTts(macMiniBaseUrl: String, language: String) {
        disconnectTts()

        val wsUrl = macMiniBaseUrl.replace("http://", "ws://")
            .replace("https://", "wss://") +
            TTS_STREAM_PATH + "?language=$language&sample_rate=${AudioFormat.SAMPLE_RATE}"

        val request = Request.Builder().url(wsUrl).build()

        ttsWebSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "TTS WebSocket connected")
                _ttsConnected.value = true
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                _ttsAudioChunks.tryEmit(bytes.toByteArray())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                // Text messages may signal completion
                if (text.contains("\"done\"") || text.contains("\"complete\"")) {
                    _ttsComplete.tryEmit(Unit)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "TTS WebSocket closing: $reason")
                webSocket.close(1000, null)
                _ttsConnected.value = false
                _ttsComplete.tryEmit(Unit)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "TTS WebSocket closed")
                _ttsConnected.value = false
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "TTS WebSocket failure", t)
                _ttsConnected.value = false
                _ttsComplete.tryEmit(Unit)
            }
        })
    }

    /**
     * Send text to the TTS WebSocket for synthesis.
     */
    fun sendTextForSynthesis(text: String) {
        ttsWebSocket?.send(text)
    }

    /** Disconnect the TTS WebSocket. */
    fun disconnectTts() {
        ttsWebSocket?.close(1000, "Client disconnect")
        ttsWebSocket = null
        _ttsConnected.value = false
    }

    /**
     * Disconnect all WebSockets and release resources.
     */
    fun disconnectAll() {
        disconnectStt()
        disconnectTts()
    }

    // ── Helpers ─────────────────────────────────────────────────

    private fun parseSttMessage(json: String): SttStreamEvent {
        // Simple JSON parsing without pulling in a full JSON library dependency.
        // The STT streaming endpoint sends: {"type":"partial"|"final", "text":"..."}
        val isPartial = json.contains("\"partial\"")
        val textStart = json.indexOf("\"text\"") + 8
        val textEnd = json.indexOf("\"", textStart)
        val text = if (textStart > 8 && textEnd > textStart) {
            json.substring(textStart, textEnd)
        } else {
            ""
        }

        return if (isPartial) {
            SttStreamEvent.PartialTranscript(text)
        } else {
            SttStreamEvent.FinalTranscript(text)
        }
    }
}

/**
 * Events from the STT streaming WebSocket.
 */
sealed interface SttStreamEvent {
    /** Partial (interim) transcript for live display. */
    data class PartialTranscript(val text: String) : SttStreamEvent

    /** Final transcript — ready to send to LLM. */
    data class FinalTranscript(val text: String) : SttStreamEvent
}

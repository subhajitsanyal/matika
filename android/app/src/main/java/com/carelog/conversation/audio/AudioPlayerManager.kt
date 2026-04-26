package com.carelog.conversation.audio

import android.media.AudioAttributes
import android.media.AudioTrack
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages PCM audio playback using Android's [AudioTrack] API.
 *
 * Supports two playback modes:
 * - **Batch**: Play a complete PCM buffer at once.
 * - **Streaming**: Feed audio chunks as they arrive from TTS WebSocket.
 *
 * Audio format: 16kHz mono 16-bit PCM (matching [AudioFormat] constants).
 */
@Singleton
class AudioPlayerManager @Inject constructor() {

    companion object {
        private const val TAG = "AudioPlayerManager"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var audioTrack: AudioTrack? = null
    private var playbackJob: Job? = null

    private val _isPlaying = MutableStateFlow(false)
    /** Whether audio is currently being played back. */
    val isPlaying: StateFlow<Boolean> = _isPlaying.asStateFlow()

    /**
     * Play a complete PCM audio buffer.
     *
     * @param audioData Raw PCM bytes (16kHz mono 16-bit).
     */
    fun playBuffer(audioData: ByteArray) {
        stop()

        playbackJob = scope.launch {
            val track = createAudioTrack(AudioTrack.MODE_STATIC, audioData.size) ?: return@launch
            audioTrack = track
            _isPlaying.value = true

            try {
                track.write(audioData, 0, audioData.size)
                track.play()

                // Wait for playback to complete
                val durationMs = (audioData.size.toLong() * 1000L) /
                    (AudioFormat.SAMPLE_RATE * AudioFormat.BYTES_PER_SAMPLE)
                kotlinx.coroutines.delay(durationMs + 100) // small buffer
            } catch (e: Exception) {
                Log.e(TAG, "Playback error", e)
            } finally {
                releaseTrack(track)
                _isPlaying.value = false
            }
        }
    }

    /**
     * Start streaming playback mode. Call [writeStreamingChunk] to feed audio.
     */
    fun startStreamingPlayback() {
        stop()

        val minBufferSize = AudioTrack.getMinBufferSize(
            AudioFormat.SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT,
            AudioFormat.ENCODING
        )
        val track = createAudioTrack(
            AudioTrack.MODE_STREAM,
            maxOf(minBufferSize * 2, AudioFormat.CHUNK_SIZE * 4)
        ) ?: return

        audioTrack = track
        track.play()
        _isPlaying.value = true
    }

    /**
     * Write a chunk of audio data in streaming playback mode.
     *
     * @param chunk Raw PCM bytes.
     */
    fun writeStreamingChunk(chunk: ByteArray) {
        audioTrack?.let { track ->
            try {
                track.write(chunk, 0, chunk.size)
            } catch (e: Exception) {
                Log.e(TAG, "Error writing streaming chunk", e)
            }
        }
    }

    /**
     * Stop streaming playback and release the AudioTrack.
     */
    fun stopStreamingPlayback() {
        audioTrack?.let { track ->
            releaseTrack(track)
        }
        audioTrack = null
        _isPlaying.value = false
    }

    /**
     * Stop any active playback.
     */
    fun stop() {
        playbackJob?.cancel()
        playbackJob = null
        audioTrack?.let { releaseTrack(it) }
        audioTrack = null
        _isPlaying.value = false
    }

    /**
     * Release all resources.
     */
    fun release() {
        stop()
    }

    private fun createAudioTrack(mode: Int, bufferSize: Int): AudioTrack? {
        return try {
            val attributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()

            val format = android.media.AudioFormat.Builder()
                .setSampleRate(AudioFormat.SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT)
                .setEncoding(AudioFormat.ENCODING)
                .build()

            AudioTrack(attributes, format, bufferSize, mode, android.media.AudioManager.AUDIO_SESSION_ID_GENERATE).also {
                if (it.state != AudioTrack.STATE_INITIALIZED) {
                    Log.e(TAG, "AudioTrack failed to initialize")
                    it.release()
                    return null
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create AudioTrack", e)
            null
        }
    }

    private fun releaseTrack(track: AudioTrack) {
        try {
            if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                track.stop()
            }
            track.release()
        } catch (e: Exception) {
            Log.e(TAG, "Error releasing AudioTrack", e)
        }
    }
}

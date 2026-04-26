package com.carelog.conversation.audio

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlin.math.sqrt

/**
 * Energy-based Voice Activity Detector (VAD).
 *
 * Tracks the RMS energy of incoming PCM audio frames and emits
 * [VadEvent.SilenceDetected] when continuous silence exceeds the
 * configured threshold. Ignores utterances shorter than [MIN_UTTERANCE_MS].
 *
 * This is intentionally simple: a proper WebRTC VAD or ML-based detector
 * would be more accurate but adds complexity and latency.
 */
class VoiceActivityDetector(
    private val silenceThresholdMs: Long = AudioFormat.VAD_SILENCE_THRESHOLD_MS,
    private val minUtteranceMs: Long = AudioFormat.MIN_UTTERANCE_MS,
    /**
     * RMS energy below this value is considered silence.
     * Tuned for typical indoor environments with PCM 16-bit audio.
     */
    private val silenceEnergyThreshold: Double = 500.0
) {

    private val _events = MutableSharedFlow<VadEvent>(extraBufferCapacity = 4)
    /** VAD events stream. */
    val events: SharedFlow<VadEvent> = _events.asSharedFlow()

    private var silenceStartMs: Long = 0L
    private var utteranceStartMs: Long = 0L
    private var isSpeaking: Boolean = false

    /**
     * Process a chunk of PCM 16-bit audio data.
     *
     * @param audioData Raw PCM bytes (16-bit little-endian).
     * @param timestampMs Monotonic timestamp of this chunk.
     */
    fun processAudioChunk(audioData: ByteArray, timestampMs: Long) {
        val rms = calculateRms(audioData)
        val hasSpeech = rms > silenceEnergyThreshold

        if (hasSpeech) {
            if (!isSpeaking) {
                isSpeaking = true
                utteranceStartMs = timestampMs
                _events.tryEmit(VadEvent.SpeechStarted)
            }
            // Reset silence tracking while speech is active
            silenceStartMs = 0L
        } else {
            if (isSpeaking) {
                if (silenceStartMs == 0L) {
                    silenceStartMs = timestampMs
                }
                val silenceDuration = timestampMs - silenceStartMs
                if (silenceDuration >= silenceThresholdMs) {
                    val utteranceDuration = silenceStartMs - utteranceStartMs
                    if (utteranceDuration >= minUtteranceMs) {
                        _events.tryEmit(VadEvent.SilenceDetected(utteranceDuration))
                    }
                    // Reset state for next utterance
                    isSpeaking = false
                    silenceStartMs = 0L
                    utteranceStartMs = 0L
                }
            }
        }
    }

    /**
     * Reset detector state. Call when starting a new recording session.
     */
    fun reset() {
        isSpeaking = false
        silenceStartMs = 0L
        utteranceStartMs = 0L
    }

    /**
     * Calculate Root Mean Square energy of PCM 16-bit audio.
     */
    private fun calculateRms(audioData: ByteArray): Double {
        if (audioData.size < 2) return 0.0

        var sumSquares = 0.0
        val sampleCount = audioData.size / AudioFormat.BYTES_PER_SAMPLE

        for (i in 0 until sampleCount) {
            val low = audioData[i * 2].toInt() and 0xFF
            val high = audioData[i * 2 + 1].toInt()
            val sample = (high shl 8) or low
            sumSquares += sample.toDouble() * sample.toDouble()
        }

        return sqrt(sumSquares / sampleCount)
    }
}

/**
 * Events emitted by the Voice Activity Detector.
 */
sealed interface VadEvent {
    /** Speech has started (energy above threshold). */
    data object SpeechStarted : VadEvent

    /**
     * Silence detected after speech.
     * @param utteranceDurationMs Duration of the preceding utterance in milliseconds.
     */
    data class SilenceDetected(val utteranceDurationMs: Long) : VadEvent
}

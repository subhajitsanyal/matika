package com.carelog.conversation.audio

import android.media.AudioFormat as AndroidAudioFormat

/**
 * Audio format constants for CareLog conversation capture and playback.
 *
 * All audio is PCM 16kHz mono 16-bit, matching the Mac Mini
 * STT/TTS service expectations.
 */
object AudioFormat {
    /** Sample rate in Hz. */
    const val SAMPLE_RATE = 16000

    /** Audio channel configuration for recording. */
    const val CHANNEL_IN = AndroidAudioFormat.CHANNEL_IN_MONO

    /** Audio channel configuration for playback. */
    const val CHANNEL_OUT = AndroidAudioFormat.CHANNEL_OUT_MONO

    /** PCM encoding format. */
    const val ENCODING = AndroidAudioFormat.ENCODING_PCM_16BIT

    /** Chunk size in bytes for streaming mode. */
    const val CHUNK_SIZE = 4096

    /** Silence duration (ms) before end-of-utterance in batch mode. */
    const val VAD_SILENCE_THRESHOLD_MS = 1500L

    /** Minimum utterance duration (ms) to avoid capturing noise/clicks. */
    const val MIN_UTTERANCE_MS = 500L

    /** Bytes per sample (16-bit = 2 bytes). */
    const val BYTES_PER_SAMPLE = 2
}

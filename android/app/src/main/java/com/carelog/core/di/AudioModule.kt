package com.carelog.core.di

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module providing audio capture and playback dependencies.
 *
 * Placeholder for P1 — will provide AudioRecord configuration,
 * AudioTrack for playback, and Voice Activity Detection settings.
 */
@Module
@InstallIn(SingletonComponent::class)
object AudioModule {

    /**
     * Audio format constants used across the audio pipeline.
     */
    object AudioConfig {
        /** Sample rate for STT and TTS: 16 kHz mono PCM */
        const val SAMPLE_RATE = 16000

        /** Audio channel: mono */
        const val CHANNEL_COUNT = 1

        /** Bits per sample: 16-bit PCM */
        const val BITS_PER_SAMPLE = 16

        /** Size of each audio chunk sent during streaming (bytes) */
        const val STREAMING_CHUNK_SIZE = 4096

        /** Voice Activity Detection silence threshold (ms) for batch mode */
        const val VAD_SILENCE_THRESHOLD_MS = 1500L
    }
}

package com.carelog.conversation.audio

import android.annotation.SuppressLint
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages audio capture using Android's [AudioRecord] API.
 *
 * Supports two modes:
 * - **Batch mode**: Records until [VoiceActivityDetector] signals silence,
 *   then returns the complete PCM ByteArray.
 * - **Streaming mode**: Emits PCM chunks via [audioChunks] SharedFlow
 *   for real-time WebSocket transmission.
 *
 * Requires RECORD_AUDIO permission to be granted before use.
 */
@Singleton
class AudioCaptureManager @Inject constructor() {

    companion object {
        private const val TAG = "AudioCaptureManager"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var audioRecord: AudioRecord? = null
    private var recordingJob: Job? = null

    private val _isRecording = MutableStateFlow(false)
    /** Whether the microphone is actively recording. */
    val isRecording: StateFlow<Boolean> = _isRecording.asStateFlow()

    private val _audioChunks = MutableSharedFlow<ByteArray>(extraBufferCapacity = 16)
    /** Stream of PCM audio chunks for streaming mode. */
    val audioChunks: SharedFlow<ByteArray> = _audioChunks.asSharedFlow()

    /** VAD instance for batch mode silence detection. */
    val vad = VoiceActivityDetector()

    private val bufferSize: Int by lazy {
        val minSize = AudioRecord.getMinBufferSize(
            AudioFormat.SAMPLE_RATE,
            AudioFormat.CHANNEL_IN,
            AudioFormat.ENCODING
        )
        // Use at least 2x the minimum for smooth capture
        maxOf(minSize * 2, AudioFormat.CHUNK_SIZE * 2)
    }

    /**
     * Start recording in batch mode. Records audio and feeds it through
     * the VAD. When silence is detected, returns the full PCM audio.
     *
     * @return Complete PCM audio ByteArray of the utterance, or null if
     *         recording was stopped/failed before an utterance completed.
     */
    suspend fun recordBatchUtterance(): ByteArray? {
        if (_isRecording.value) {
            Log.w(TAG, "Already recording, ignoring batch request")
            return null
        }

        val record = createAudioRecord() ?: return null
        audioRecord = record
        vad.reset()

        val outputStream = ByteArrayOutputStream()
        val buffer = ByteArray(AudioFormat.CHUNK_SIZE)
        var utteranceComplete = false

        _isRecording.value = true
        record.startRecording()

        // Collect VAD events in a separate coroutine
        val vadJob = scope.launch {
            vad.events.collect { event ->
                if (event is VadEvent.SilenceDetected) {
                    utteranceComplete = true
                }
            }
        }

        try {
            val startTime = System.currentTimeMillis()
            while (!utteranceComplete && _isRecording.value) {
                val bytesRead = record.read(buffer, 0, buffer.size)
                if (bytesRead > 0) {
                    outputStream.write(buffer, 0, bytesRead)
                    val timestamp = System.currentTimeMillis() - startTime
                    vad.processAudioChunk(buffer.copyOf(bytesRead), timestamp)
                } else if (bytesRead < 0) {
                    Log.e(TAG, "AudioRecord read error: $bytesRead")
                    break
                }
            }
        } finally {
            vadJob.cancel()
            stopRecordInternal(record)
        }

        val audio = outputStream.toByteArray()
        return if (audio.isNotEmpty() && utteranceComplete) audio else null
    }

    /**
     * Start recording in streaming mode. Audio chunks are emitted
     * to [audioChunks] for real-time processing.
     */
    fun startStreamingCapture() {
        if (_isRecording.value) {
            Log.w(TAG, "Already recording, ignoring streaming request")
            return
        }

        val record = createAudioRecord() ?: return
        audioRecord = record
        vad.reset()

        _isRecording.value = true
        record.startRecording()

        recordingJob = scope.launch {
            val buffer = ByteArray(AudioFormat.CHUNK_SIZE)
            val startTime = System.currentTimeMillis()

            while (isActive && _isRecording.value) {
                val bytesRead = record.read(buffer, 0, buffer.size)
                if (bytesRead > 0) {
                    val chunk = buffer.copyOf(bytesRead)
                    _audioChunks.emit(chunk)
                    val timestamp = System.currentTimeMillis() - startTime
                    vad.processAudioChunk(chunk, timestamp)
                } else if (bytesRead < 0) {
                    Log.e(TAG, "AudioRecord read error: $bytesRead")
                    break
                }
            }

            stopRecordInternal(record)
        }
    }

    /**
     * Stop any active recording (batch or streaming).
     */
    suspend fun stopRecording() {
        _isRecording.value = false
        recordingJob?.cancelAndJoin()
        recordingJob = null
    }

    /**
     * Release resources. Call when the conversation session ends.
     */
    fun release() {
        _isRecording.value = false
        recordingJob?.cancel()
        recordingJob = null
        audioRecord?.release()
        audioRecord = null
    }

    @SuppressLint("MissingPermission")
    private fun createAudioRecord(): AudioRecord? {
        return try {
            val record = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                AudioFormat.SAMPLE_RATE,
                AudioFormat.CHANNEL_IN,
                AudioFormat.ENCODING,
                bufferSize
            )
            if (record.state != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "AudioRecord failed to initialize")
                record.release()
                null
            } else {
                record
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "RECORD_AUDIO permission not granted", e)
            null
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create AudioRecord", e)
            null
        }
    }

    private fun stopRecordInternal(record: AudioRecord) {
        try {
            if (record.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                record.stop()
            }
            record.release()
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping AudioRecord", e)
        }
        _isRecording.value = false
        audioRecord = null
    }
}

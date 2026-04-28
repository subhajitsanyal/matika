package com.carelog.conversation

import android.util.Log
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.conversation.audio.AudioCaptureManager
import com.carelog.conversation.audio.AudioPlayerManager
import com.carelog.conversation.audio.AudioStreamManager
import com.carelog.conversation.audio.SttStreamEvent
import com.carelog.conversation.audio.VadEvent
import com.carelog.conversation.session.ConversationUiState
import com.carelog.conversation.session.SessionManager
import com.carelog.conversation.session.SessionPhase
import com.carelog.conversation.session.VisionReading
import com.carelog.conversation.session.VisionResult
import com.carelog.core.config.AppSettings
import com.carelog.core.config.AudioMode
import com.carelog.discovery.HealthCheckService
import com.carelog.network.MacMiniVisionApi
import com.carelog.network.VisionExtractResponse
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject

/**
 * Main ViewModel for the conversation screen.
 *
 * Orchestrates [SessionManager], audio capture/playback, and user actions.
 * Exposes [uiState] as a single observable state for the UI layer.
 */
@HiltViewModel
class ConversationViewModel @Inject constructor(
    private val sessionManager: SessionManager,
    private val audioCaptureManager: AudioCaptureManager,
    private val audioPlayerManager: AudioPlayerManager,
    private val audioStreamManager: AudioStreamManager,
    private val healthCheckService: HealthCheckService,
    private val visionApi: MacMiniVisionApi,
    private val appSettings: AppSettings,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    companion object {
        private const val TAG = "ConversationViewModel"
    }

    /** The patient ID passed via navigation arguments. */
    private val patientId: String = savedStateHandle.get<String>("patientId") ?: ""

    /** Observable conversation UI state. */
    val uiState: StateFlow<ConversationUiState> = sessionManager.uiState
        .stateIn(viewModelScope, SharingStarted.Eagerly, ConversationUiState())

    /** Audio recording state for UI indicators. */
    val isRecording: StateFlow<Boolean> = audioCaptureManager.isRecording

    /** Audio playback state for UI indicators. */
    val isPlaying: StateFlow<Boolean> = audioPlayerManager.isPlaying

    /** Live health status from HealthCheckService. */
    val liveHealthStatus = healthCheckService.healthStatus

    init {
        // Observe health status changes
        viewModelScope.launch {
            healthCheckService.healthStatus.collect { status ->
                // Health status is part of the UI state managed by SessionManager
            }
        }

        // Observe VAD events for batch mode auto-send
        viewModelScope.launch {
            audioCaptureManager.vad.events.collect { event ->
                when (event) {
                    is VadEvent.SilenceDetected -> {
                        Log.d(TAG, "Silence detected after ${event.utteranceDurationMs}ms")
                    }
                    is VadEvent.SpeechStarted -> {
                        Log.d(TAG, "Speech started")
                    }
                }
            }
        }

        // Observe streaming STT transcripts for live display
        viewModelScope.launch {
            audioStreamManager.sttTranscripts.collect { event ->
                when (event) {
                    is SttStreamEvent.PartialTranscript -> {
                        sessionManager.updateCurrentTranscript(event.text)
                    }
                    is SttStreamEvent.FinalTranscript -> {
                        sessionManager.updateCurrentTranscript(event.text)
                        // Process the final transcript through LLM
                        val language = appSettings.language.first().code
                        sessionManager.processTextInput(event.text, language)
                    }
                }
            }
        }
    }

    /**
     * User pressed the Start button.
     */
    fun onStartPressed() {
        viewModelScope.launch {
            sessionManager.startSession(patientId)
        }
    }

    /**
     * User pressed the record/microphone button to capture an utterance.
     * In batch mode: records until silence detected, then processes.
     * In streaming mode: starts streaming capture.
     */
    fun onRecordPressed() {
        if (uiState.value.sessionPhase != SessionPhase.ACTIVE) return
        if (uiState.value.isProcessing || uiState.value.isPlayingAudio) return

        viewModelScope.launch {
            try {
                val audioMode = appSettings.audioMode.first()
                val language = appSettings.language.first().code

                Log.i(TAG, "Record pressed, mode=$audioMode, language=$language")
                sessionManager.setRecording(true)

                if (audioMode == AudioMode.STREAMING) {
                    startStreamingCapture(language)
                } else {
                    startBatchCapture(language)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Recording failed", e)
                sessionManager.setRecording(false)
                sessionManager.showError("Recording failed: ${e.message}")
            }
        }
    }

    /**
     * User pressed stop recording (streaming mode only).
     */
    fun onStopRecordingPressed() {
        viewModelScope.launch {
            audioCaptureManager.stopRecording()
            sessionManager.setRecording(false)

            // In streaming mode, signal end of stream
            audioStreamManager.finishSttStream()
        }
    }

    /**
     * User pressed the Pause button.
     */
    fun onPausePressed() {
        viewModelScope.launch {
            audioCaptureManager.stopRecording()
            sessionManager.setRecording(false)
            sessionManager.pauseSession()
        }
    }

    /**
     * User pressed the Resume button.
     */
    fun onResumePressed() {
        viewModelScope.launch {
            sessionManager.resumeSession()
        }
    }

    /**
     * User pressed the Stop button to end the session.
     */
    fun onStopPressed() {
        viewModelScope.launch {
            audioCaptureManager.stopRecording()
            audioPlayerManager.stop()
            sessionManager.setRecording(false)
            sessionManager.stopSession("user_stopped")
        }
    }

    /**
     * User submitted text input (fallback mode).
     */
    fun onTextSubmitted(text: String) {
        if (text.isBlank()) return

        viewModelScope.launch {
            val language = appSettings.language.first().code
            sessionManager.processTextInput(text.trim(), language)
        }
    }

    /**
     * User captured a photo for vision processing.
     *
     * @param imageBytes JPEG image data.
     * @param deviceHint Optional device type hint.
     */
    fun onPhotoTaken(imageBytes: ByteArray, deviceHint: String? = null) {
        viewModelScope.launch {
            try {
                val imagePart = MultipartBody.Part.createFormData(
                    "image",
                    "capture.jpg",
                    imageBytes.toRequestBody("image/jpeg".toMediaType())
                )
                val hintBody = deviceHint?.toRequestBody("text/plain".toMediaType())

                val response = visionApi.extractReadings(imagePart, hintBody)
                val result = mapVisionResponse(response)
                sessionManager.setVisionResult(result)
            } catch (e: Exception) {
                Log.e(TAG, "Vision extraction failed", e)
                sessionManager.setVisionResult(null)
            }
        }
    }

    /**
     * User confirmed the vision readings — feed them back into the conversation.
     */
    fun onVisionReadingsConfirmed() {
        val result = uiState.value.visionResult ?: return

        viewModelScope.launch {
            val language = appSettings.language.first().code
            // Build a text representation of the readings and feed to LLM
            val readingsText = result.readings.joinToString(", ") { r ->
                "${r.label}: ${r.value} ${r.unit}"
            }
            sessionManager.processTextInput(
                "I took a photo. The readings show: $readingsText",
                language
            )
            sessionManager.setVisionResult(null)
        }
    }

    /**
     * User wants to retake the photo.
     */
    fun onVisionRetake() {
        sessionManager.setVisionResult(null)
    }

    /**
     * Dismiss the current error message.
     */
    fun onErrorDismissed() {
        sessionManager.dismissError()
    }

    override fun onCleared() {
        super.onCleared()
        sessionManager.resetSession()
    }

    // ── Private Helpers ─────────────────────────────────────────

    private suspend fun startBatchCapture(language: String) {
        val audioData = audioCaptureManager.recordBatchUtterance()
        sessionManager.setRecording(false)

        if (audioData != null && audioData.isNotEmpty()) {
            sessionManager.processUtterance(audioData, language)
        } else {
            Log.w(TAG, "Batch recording returned no audio — check RECORD_AUDIO permission")
            sessionManager.showError("Could not record audio. Please check microphone permission in Settings.")
        }
    }

    private suspend fun startStreamingCapture(language: String) {
        val macMiniUrl = appSettings.macMiniBaseUrl.first() ?: return
        // Replace port for STT service (8001)
        val sttUrl = macMiniUrl.replace(Regex(":\\d+$"), ":8001")
        audioStreamManager.connectStt(sttUrl, language)
        audioCaptureManager.startStreamingCapture()

        // Forward audio chunks to the STT WebSocket
        viewModelScope.launch {
            audioCaptureManager.audioChunks.collect { chunk ->
                audioStreamManager.sendAudioChunk(chunk)
            }
        }
    }

    private fun mapVisionResponse(response: VisionExtractResponse): VisionResult {
        return VisionResult(
            deviceType = response.device_type,
            confidence = response.confidence,
            readings = response.readings.map { r ->
                VisionReading(
                    label = r.label,
                    value = r.value,
                    unit = r.unit
                )
            },
            rawTextDetected = response.raw_text_detected
        )
    }
}

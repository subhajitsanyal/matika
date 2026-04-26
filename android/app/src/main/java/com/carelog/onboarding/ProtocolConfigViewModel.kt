package com.carelog.onboarding

import android.util.Log
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.conversation.audio.AudioCaptureManager
import com.carelog.conversation.audio.AudioPlayerManager
import com.carelog.conversation.audio.AudioStreamManager
import com.carelog.conversation.audio.SttStreamEvent
import com.carelog.conversation.audio.VadEvent
import com.carelog.core.config.AppSettings
import com.carelog.core.config.AudioMode
import com.carelog.network.CloudApiService
import com.carelog.network.LlmCreateSessionRequest
import com.carelog.network.LlmSessionConfig
import com.carelog.network.LlmUtteranceRequest
import com.carelog.network.MacMiniLlmApi
import com.carelog.network.MacMiniSttApi
import com.carelog.network.MacMiniTtsApi
import com.carelog.network.ParameterConfigEntry
import com.carelog.network.SaveParameterConfigsRequest
import com.carelog.network.TtsSynthesizeRequest
import com.google.gson.Gson
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject

/**
 * ViewModel for the protocol configuration conversation.
 *
 * Starts a `caregiver_config` LLM session on Mac Mini to configure
 * monitoring parameters, frequencies, deadlines, and thresholds.
 * Saves config changes to the cloud API when complete.
 */
@HiltViewModel
class ProtocolConfigViewModel @Inject constructor(
    private val llmApi: MacMiniLlmApi,
    private val sttApi: MacMiniSttApi,
    private val ttsApi: MacMiniTtsApi,
    private val cloudApiService: CloudApiService,
    private val audioCaptureManager: AudioCaptureManager,
    private val audioPlayerManager: AudioPlayerManager,
    private val audioStreamManager: AudioStreamManager,
    private val appSettings: AppSettings,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    companion object {
        private const val TAG = "ProtocolConfigVM"
    }

    private val patientId: String = savedStateHandle.get<String>("patientId") ?: ""
    private val patientName: String = savedStateHandle.get<String>("patientName") ?: ""

    private val _uiState = MutableStateFlow(ProtocolConfigUiState())
    val uiState: StateFlow<ProtocolConfigUiState> = _uiState.asStateFlow()

    val isRecording: StateFlow<Boolean> = audioCaptureManager.isRecording
    val isPlaying: StateFlow<Boolean> = audioPlayerManager.isPlaying

    private var turnNumber = 0
    private val gson = Gson()
    private val pendingConfigChanges = mutableListOf<ConfigChange>()

    init {
        viewModelScope.launch {
            audioCaptureManager.vad.events.collect { event ->
                when (event) {
                    is VadEvent.SilenceDetected -> Log.d(TAG, "Silence detected")
                    is VadEvent.SpeechStarted -> Log.d(TAG, "Speech started")
                }
            }
        }

        viewModelScope.launch {
            audioStreamManager.sttTranscripts.collect { event ->
                when (event) {
                    is SttStreamEvent.PartialTranscript -> {
                        _uiState.update { it.copy(currentTranscript = event.text) }
                    }
                    is SttStreamEvent.FinalTranscript -> {
                        _uiState.update { it.copy(currentTranscript = event.text) }
                        val language = appSettings.language.first().code
                        processTextInput(event.text, language)
                    }
                }
            }
        }
    }

    /**
     * Start the protocol configuration session.
     */
    fun onStartPressed() {
        viewModelScope.launch {
            if (_uiState.value.phase != OnboardingPhase.NOT_STARTED) return@launch

            _uiState.update { it.copy(phase = OnboardingPhase.STARTING, errorMessage = null) }
            turnNumber = 0

            try {
                val language = appSettings.language.first().code

                val sessionResponse = llmApi.createSession(
                    LlmCreateSessionRequest(
                        session_type = "caregiver_config",
                        patient_id = patientId,
                        language = language,
                        config = LlmSessionConfig(
                            parameters = emptyList(),
                            topics = null,
                            system_prompt = null,
                            patient_name = patientName,
                            last_session_summary = null
                        )
                    )
                )

                playTts(sessionResponse.greeting_text, language)

                _uiState.update {
                    it.copy(
                        phase = OnboardingPhase.ACTIVE,
                        sessionId = sessionResponse.session_id,
                        lastSystemResponse = sessionResponse.greeting_text,
                        conversationTurns = listOf(
                            OnboardingTurn(
                                turnNumber = 0,
                                userText = "",
                                systemText = sessionResponse.greeting_text,
                                action = "greeting"
                            )
                        )
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start config session", e)
                _uiState.update {
                    it.copy(
                        phase = OnboardingPhase.NOT_STARTED,
                        errorMessage = "Failed to start session. Please try again."
                    )
                }
            }
        }
    }

    fun onRecordPressed() {
        if (_uiState.value.phase != OnboardingPhase.ACTIVE) return
        if (_uiState.value.isProcessing) return

        viewModelScope.launch {
            val audioMode = appSettings.audioMode.first()
            val language = appSettings.language.first().code

            _uiState.update { it.copy(isRecording = true) }

            if (audioMode == AudioMode.STREAMING) {
                startStreamingCapture(language)
            } else {
                startBatchCapture(language)
            }
        }
    }

    fun onStopRecordingPressed() {
        viewModelScope.launch {
            audioCaptureManager.stopRecording()
            _uiState.update { it.copy(isRecording = false) }
            audioStreamManager.finishSttStream()
        }
    }

    fun onTextSubmitted(text: String) {
        if (text.isBlank()) return
        viewModelScope.launch {
            val language = appSettings.language.first().code
            processTextInput(text.trim(), language)
        }
    }

    /**
     * Finish configuration and save all pending config changes to cloud.
     */
    fun onFinishPressed() {
        viewModelScope.launch {
            audioCaptureManager.stopRecording()
            audioPlayerManager.stop()

            if (pendingConfigChanges.isNotEmpty() && patientId.isNotBlank()) {
                try {
                    cloudApiService.saveParameterConfigs(
                        patientId = patientId,
                        request = SaveParameterConfigsRequest(
                            configs = pendingConfigChanges.map { change ->
                                ParameterConfigEntry(
                                    action = change.action,
                                    parameter = change.parameter,
                                    loinc_codes = change.loinc_codes,
                                    unit = change.unit,
                                    frequency_days = change.frequency_days,
                                    daily_deadline = change.daily_deadline,
                                    threshold_min = change.threshold_min,
                                    threshold_max = change.threshold_max
                                )
                            }
                        )
                    )
                    Log.i(TAG, "Parameter configs saved for patient $patientId")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to save parameter configs", e)
                }
            }

            _uiState.update { it.copy(phase = OnboardingPhase.ENDED, configComplete = true) }
        }
    }

    fun onErrorDismissed() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    override fun onCleared() {
        super.onCleared()
        audioCaptureManager.release()
        audioPlayerManager.release()
        audioStreamManager.disconnectAll()
    }

    // ── Private Helpers ─────────────────────────────────────────

    private suspend fun processTextInput(text: String, language: String) {
        val sessionId = _uiState.value.sessionId ?: return

        _uiState.update { it.copy(isProcessing = true, errorMessage = null) }
        turnNumber++

        try {
            val llmResponse = llmApi.sendUtterance(
                sessionId = sessionId,
                request = LlmUtteranceRequest(text = text, turn_number = turnNumber)
            )

            playTts(llmResponse.response_text, language)

            // Try parsing protocol config-specific fields
            val rawJson = gson.toJson(llmResponse)
            val configResponse = try {
                gson.fromJson(rawJson, ProtocolConfigLlmResponse::class.java)
            } catch (e: Exception) {
                Log.w(TAG, "Could not parse config-specific fields", e)
                null
            }

            // Accumulate config changes
            configResponse?.config_changes?.let { changes ->
                pendingConfigChanges.addAll(changes)

                // Update displayed parameter list
                val updatedParams = _uiState.value.parameters.toMutableList()
                for (change in changes) {
                    when (change.action) {
                        "add" -> updatedParams.add(
                            ProtocolParameter(
                                name = change.parameter,
                                unit = change.unit ?: "",
                                frequencyDays = change.frequency_days,
                                dailyDeadline = change.daily_deadline,
                                thresholdMin = change.threshold_min,
                                thresholdMax = change.threshold_max
                            )
                        )
                        "remove" -> updatedParams.removeAll { it.name == change.parameter }
                        "update" -> {
                            val idx = updatedParams.indexOfFirst { it.name == change.parameter }
                            if (idx >= 0) {
                                updatedParams[idx] = updatedParams[idx].copy(
                                    frequencyDays = change.frequency_days ?: updatedParams[idx].frequencyDays,
                                    dailyDeadline = change.daily_deadline ?: updatedParams[idx].dailyDeadline,
                                    thresholdMin = change.threshold_min ?: updatedParams[idx].thresholdMin,
                                    thresholdMax = change.threshold_max ?: updatedParams[idx].thresholdMax
                                )
                            }
                        }
                    }
                }

                _uiState.update { it.copy(parameters = updatedParams) }
            }

            val isComplete = configResponse?.action == "protocol_summary"

            val turn = OnboardingTurn(
                turnNumber = turnNumber,
                userText = text,
                systemText = llmResponse.response_text,
                action = configResponse?.action ?: llmResponse.action
            )

            _uiState.update { state ->
                state.copy(
                    isProcessing = false,
                    retryCount = 0,
                    conversationTurns = state.conversationTurns + turn,
                    lastSystemResponse = llmResponse.response_text,
                    currentTranscript = "",
                    configComplete = isComplete
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Processing failed", e)
            val newRetryCount = _uiState.value.retryCount + 1
            _uiState.update {
                it.copy(
                    isProcessing = false,
                    retryCount = newRetryCount,
                    showTextInput = newRetryCount >= 2,
                    errorMessage = if (newRetryCount >= 2) {
                        "Voice recognition failed. Please type your response."
                    } else {
                        "Could not understand. Please try again."
                    }
                )
            }
        }
    }

    private suspend fun startBatchCapture(language: String) {
        val audioData = audioCaptureManager.recordBatchUtterance()
        _uiState.update { it.copy(isRecording = false) }

        if (audioData != null && audioData.isNotEmpty()) {
            _uiState.update { it.copy(isProcessing = true) }
            try {
                val audioBody = audioData.toRequestBody("audio/pcm".toMediaType())
                val sttResponse = sttApi.transcribe(
                    sampleRate = "16000",
                    language = language,
                    audioBody = audioBody
                )
                processTextInput(sttResponse.text, language)
            } catch (e: Exception) {
                Log.e(TAG, "STT failed", e)
                _uiState.update {
                    it.copy(
                        isProcessing = false,
                        errorMessage = "Could not understand. Please try again."
                    )
                }
            }
        }
    }

    private suspend fun startStreamingCapture(language: String) {
        val macMiniUrl = appSettings.macMiniBaseUrl.first() ?: return
        val sttUrl = macMiniUrl.replace(Regex(":\\d+$"), ":8001")
        audioStreamManager.connectStt(sttUrl, language)
        audioCaptureManager.startStreamingCapture()

        viewModelScope.launch {
            audioCaptureManager.audioChunks.collect { chunk ->
                audioStreamManager.sendAudioChunk(chunk)
            }
        }
    }

    private suspend fun playTts(text: String, language: String) {
        try {
            val responseBody = ttsApi.synthesize(
                TtsSynthesizeRequest(
                    text = text,
                    language = language,
                    format = "pcm",
                    sample_rate = 16000
                )
            )
            val audioBytes = responseBody.bytes()
            if (audioBytes.isNotEmpty()) {
                audioPlayerManager.playBuffer(audioBytes)
            }
        } catch (e: Exception) {
            Log.e(TAG, "TTS playback failed", e)
        }
    }
}

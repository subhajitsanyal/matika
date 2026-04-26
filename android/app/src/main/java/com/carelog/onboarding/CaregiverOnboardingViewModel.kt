package com.carelog.onboarding

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.conversation.ConversationRepository
import com.carelog.conversation.audio.AudioCaptureManager
import com.carelog.conversation.audio.AudioPlayerManager
import com.carelog.conversation.audio.AudioStreamManager
import com.carelog.conversation.audio.SttStreamEvent
import com.carelog.conversation.audio.VadEvent
import com.carelog.core.config.AppSettings
import com.carelog.core.config.AudioMode
import com.carelog.network.LlmCreateSessionRequest
import com.carelog.network.LlmSessionConfig
import com.carelog.network.LlmUtteranceRequest
import com.carelog.network.MacMiniLlmApi
import com.carelog.network.MacMiniSttApi
import com.carelog.network.MacMiniTtsApi
import com.carelog.network.TtsSynthesizeRequest
import com.google.gson.Gson
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject

/**
 * ViewModel managing the caregiver onboarding conversation flow.
 *
 * Starts a `caregiver_onboarding` LLM session on Mac Mini to collect
 * patient profile information through conversation. Uses the same audio
 * pipeline as patient sessions.
 *
 * When the LLM returns `profile_complete: true`, signals navigation
 * to the patient profile confirmation screen.
 */
@HiltViewModel
class CaregiverOnboardingViewModel @Inject constructor(
    private val llmApi: MacMiniLlmApi,
    private val sttApi: MacMiniSttApi,
    private val ttsApi: MacMiniTtsApi,
    private val audioCaptureManager: AudioCaptureManager,
    private val audioPlayerManager: AudioPlayerManager,
    private val audioStreamManager: AudioStreamManager,
    private val appSettings: AppSettings
) : ViewModel() {

    companion object {
        private const val TAG = "CaregiverOnboardingVM"
    }

    private val _uiState = MutableStateFlow(OnboardingUiState())
    val uiState: StateFlow<OnboardingUiState> = _uiState.asStateFlow()

    val isRecording: StateFlow<Boolean> = audioCaptureManager.isRecording
    val isPlaying: StateFlow<Boolean> = audioPlayerManager.isPlaying

    private var turnNumber = 0
    private val gson = Gson()

    init {
        // Observe VAD events
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

        // Observe streaming STT transcripts
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
     * Start the onboarding conversation session.
     */
    fun onStartPressed() {
        viewModelScope.launch {
            if (_uiState.value.phase != OnboardingPhase.NOT_STARTED) return@launch

            _uiState.update { it.copy(phase = OnboardingPhase.STARTING, errorMessage = null) }
            turnNumber = 0

            try {
                val language = appSettings.language.first().code

                // Create a caregiver_onboarding session on Mac Mini
                val sessionResponse = llmApi.createSession(
                    LlmCreateSessionRequest(
                        session_type = "caregiver_onboarding",
                        patient_id = "",
                        language = language,
                        config = LlmSessionConfig(
                            parameters = emptyList(),
                            topics = null,
                            system_prompt = null,
                            patient_name = "",
                            last_session_summary = null
                        )
                    )
                )

                // Play greeting
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
                Log.e(TAG, "Failed to start onboarding session", e)
                _uiState.update {
                    it.copy(
                        phase = OnboardingPhase.NOT_STARTED,
                        errorMessage = "Failed to start session. Please try again."
                    )
                }
            }
        }
    }

    /**
     * Record button pressed -- capture audio utterance.
     */
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

    /**
     * Stop recording (streaming mode).
     */
    fun onStopRecordingPressed() {
        viewModelScope.launch {
            audioCaptureManager.stopRecording()
            _uiState.update { it.copy(isRecording = false) }
            audioStreamManager.finishSttStream()
        }
    }

    /**
     * Text input submitted (fallback mode).
     */
    fun onTextSubmitted(text: String) {
        if (text.isBlank()) return
        viewModelScope.launch {
            val language = appSettings.language.first().code
            processTextInput(text.trim(), language)
        }
    }

    /**
     * Stop the onboarding session.
     */
    fun onStopPressed() {
        viewModelScope.launch {
            audioCaptureManager.stopRecording()
            audioPlayerManager.stop()
            _uiState.update { it.copy(isRecording = false, phase = OnboardingPhase.ENDED) }
        }
    }

    fun onErrorDismissed() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    /**
     * Get the extracted profile for passing to the confirmation screen.
     */
    fun getExtractedProfile(): ExtractedPatientProfile = _uiState.value.extractedProfile

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

            // Play TTS response
            playTts(llmResponse.response_text, language)

            // Parse the onboarding-specific fields from the raw response.
            // The LLM response includes extracted_profile and profile_complete
            // in addition to the standard utterance response fields.
            val rawJson = gson.toJson(llmResponse)
            val onboardingResponse = try {
                gson.fromJson(rawJson, OnboardingLlmResponse::class.java)
            } catch (e: Exception) {
                Log.w(TAG, "Could not parse onboarding-specific fields", e)
                null
            }

            val updatedProfile = mergeProfile(
                _uiState.value.extractedProfile,
                onboardingResponse?.extracted_profile
            )

            val profileComplete = onboardingResponse?.profile_complete == true

            val turn = OnboardingTurn(
                turnNumber = turnNumber,
                userText = text,
                systemText = llmResponse.response_text,
                action = onboardingResponse?.action ?: llmResponse.action
            )

            _uiState.update { state ->
                state.copy(
                    isProcessing = false,
                    retryCount = 0,
                    conversationTurns = state.conversationTurns + turn,
                    lastSystemResponse = llmResponse.response_text,
                    currentTranscript = "",
                    extractedProfile = updatedProfile,
                    profileComplete = profileComplete,
                    phase = if (profileComplete) OnboardingPhase.PROFILE_COMPLETE else state.phase
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
            // Transcribe audio first
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

    /**
     * Merge newly extracted profile fields into the cumulative profile.
     */
    private fun mergeProfile(
        existing: ExtractedPatientProfile,
        extracted: LlmExtractedProfile?
    ): ExtractedPatientProfile {
        if (extracted == null) return existing

        return existing.copy(
            name = extracted.name?.takeIf { it.isNotBlank() } ?: existing.name,
            age = extracted.age ?: existing.age,
            dateOfBirth = extracted.date_of_birth?.takeIf { it.isNotBlank() } ?: existing.dateOfBirth,
            gender = extracted.gender?.takeIf { it.isNotBlank() } ?: existing.gender,
            conditions = extracted.conditions?.takeIf { it.isNotEmpty() } ?: existing.conditions,
            medications = extracted.medications?.takeIf { it.isNotEmpty() } ?: existing.medications,
            allergies = extracted.allergies?.takeIf { it.isNotEmpty() } ?: existing.allergies,
            emergencyContactName = extracted.emergency_contact_name?.takeIf { it.isNotBlank() }
                ?: existing.emergencyContactName,
            emergencyContactPhone = extracted.emergency_contact_phone?.takeIf { it.isNotBlank() }
                ?: existing.emergencyContactPhone,
            emergencyContactRelationship = extracted.emergency_contact_relationship?.takeIf { it.isNotBlank() }
                ?: existing.emergencyContactRelationship,
            primaryDoctor = extracted.primary_doctor?.takeIf { it.isNotBlank() } ?: existing.primaryDoctor
        )
    }
}

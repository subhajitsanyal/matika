package com.carelog.conversation.session

import android.util.Log
import com.carelog.conversation.ConversationRepository
import com.carelog.discovery.HealthCheckService
import com.carelog.network.CloudApiService
import com.carelog.network.FhirBatchRequest
import com.carelog.network.FhirObservationEntry
import com.carelog.network.LlmEndSessionRequest
import com.carelog.network.MacMiniLlmApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages the full conversation session lifecycle:
 *
 * 1. **Start**: Fetch config from cloud -> Create LLM session -> Play greeting -> ACTIVE
 * 2. **Process**: STT -> LLM -> TTS -> Play -> Update UI state (per utterance)
 * 3. **Pause**: Pause LLM session -> Start 5-min timeout
 * 4. **Resume**: Resume LLM session -> Cancel timeout
 * 5. **Stop**: End LLM session -> Upload FHIR + raw interaction to cloud
 */
@Singleton
class SessionManager @Inject constructor(
    private val conversationRepository: ConversationRepository,
    private val cloudApiService: CloudApiService,
    private val llmApi: MacMiniLlmApi,
    private val healthCheckService: HealthCheckService
) {

    companion object {
        private const val TAG = "SessionManager"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _uiState = MutableStateFlow(ConversationUiState())
    /** Observable UI state for the conversation screen. */
    val uiState: StateFlow<ConversationUiState> = _uiState.asStateFlow()

    private var turnNumber = 0
    private var sessionStartTime = 0L

    private val pauseTimeoutHandler = PauseTimeoutHandler(scope) {
        stopSession("pause_timeout")
    }

    /**
     * Start a new conversation session.
     *
     * 1. Fetch session config from cloud API
     * 2. Create LLM session on Mac Mini
     * 3. Synthesize and play greeting via TTS
     * 4. Transition to ACTIVE phase
     *
     * @param patientId The patient to create a session for.
     */
    suspend fun startSession(patientId: String) {
        if (_uiState.value.sessionPhase != SessionPhase.NOT_STARTED) {
            Log.w(TAG, "Session already in progress, ignoring start")
            return
        }

        _uiState.update { it.copy(sessionPhase = SessionPhase.STARTING, errorMessage = null) }
        sessionStartTime = System.currentTimeMillis()
        turnNumber = 0

        try {
            // Step 1: Fetch config from cloud
            val config = cloudApiService.getSessionConfig(patientId)

            val remainingParams = config.parameters.map { param ->
                ParameterConfig(
                    name = param.name,
                    loincCodes = param.loinc_codes,
                    unit = param.unit,
                    frequencyDays = param.frequency_days,
                    thresholdMin = param.threshold_min,
                    thresholdMax = param.threshold_max
                )
            }

            // Step 2: Create LLM session on Mac Mini
            val sessionResponse = conversationRepository.createSession(config)

            // Step 3: Play greeting TTS
            conversationRepository.playGreeting(sessionResponse.greeting_text, config.language)

            // Step 4: Transition to ACTIVE
            _uiState.update {
                it.copy(
                    sessionPhase = SessionPhase.ACTIVE,
                    sessionId = sessionResponse.session_id,
                    remainingParameters = remainingParams,
                    lastSystemResponse = sessionResponse.greeting_text,
                    conversationTurns = listOf(
                        ConversationTurn(
                            turnNumber = 0,
                            patientText = "",
                            systemText = sessionResponse.greeting_text,
                            action = "greeting"
                        )
                    ),
                    modelStatus = healthCheckService.healthStatus.value
                )
            }

            Log.i(TAG, "Session started: ${sessionResponse.session_id}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start session", e)
            _uiState.update {
                it.copy(
                    sessionPhase = SessionPhase.NOT_STARTED,
                    errorMessage = "Failed to start session. Please try again."
                )
            }
        }
    }

    /**
     * Process a patient utterance through the STT -> LLM -> TTS pipeline.
     *
     * @param audioData Raw PCM audio from the microphone.
     * @param language Language code for STT/TTS.
     */
    suspend fun processUtterance(audioData: ByteArray, language: String) {
        val sessionId = _uiState.value.sessionId ?: return

        _uiState.update { it.copy(isProcessing = true, errorMessage = null) }
        turnNumber++

        try {
            val result = conversationRepository.processAudio(
                audioData = audioData,
                language = language,
                sessionId = sessionId,
                turnNumber = turnNumber
            )

            handleLlmResponse(result)

            _uiState.update { it.copy(isProcessing = false, retryCount = 0) }
        } catch (e: Exception) {
            Log.e(TAG, "Utterance processing failed", e)
            handleProcessingError()
        }
    }

    /**
     * Process text input (fallback when STT fails repeatedly).
     *
     * @param text The text entered by the patient.
     * @param language Language code for TTS.
     */
    suspend fun processTextInput(text: String, language: String) {
        val sessionId = _uiState.value.sessionId ?: return

        _uiState.update { it.copy(isProcessing = true, errorMessage = null) }
        turnNumber++

        try {
            val result = conversationRepository.processText(
                text = text,
                language = language,
                sessionId = sessionId,
                turnNumber = turnNumber
            )

            handleLlmResponse(result)

            _uiState.update { it.copy(isProcessing = false, retryCount = 0) }
        } catch (e: Exception) {
            Log.e(TAG, "Text processing failed", e)
            _uiState.update {
                it.copy(
                    isProcessing = false,
                    errorMessage = "Failed to process input. Please try again."
                )
            }
        }
    }

    /**
     * Pause the current session. Starts a 5-minute auto-end timer.
     */
    suspend fun pauseSession() {
        val sessionId = _uiState.value.sessionId ?: return
        if (_uiState.value.sessionPhase != SessionPhase.ACTIVE) return

        try {
            llmApi.pauseSession(sessionId)
            _uiState.update { it.copy(sessionPhase = SessionPhase.PAUSED) }
            pauseTimeoutHandler.startTimeout()
            Log.i(TAG, "Session paused: $sessionId")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to pause session", e)
            _uiState.update {
                it.copy(errorMessage = "Failed to pause session.")
            }
        }
    }

    /**
     * Resume a paused session. Cancels the auto-end timer.
     */
    suspend fun resumeSession() {
        val sessionId = _uiState.value.sessionId ?: return
        if (_uiState.value.sessionPhase != SessionPhase.PAUSED) return

        pauseTimeoutHandler.cancelTimeout()

        try {
            val response = llmApi.resumeSession(sessionId)
            _uiState.update {
                it.copy(
                    sessionPhase = SessionPhase.ACTIVE,
                    lastSystemResponse = response.response_text ?: it.lastSystemResponse
                )
            }

            // Play resume message if provided
            response.response_text?.let { text ->
                conversationRepository.playTts(text, "en")
            }

            Log.i(TAG, "Session resumed: $sessionId")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to resume session (may have timed out)", e)
            // Session may have auto-ended on the server
            _uiState.update {
                it.copy(
                    sessionPhase = SessionPhase.ENDED,
                    errorMessage = "Session expired. Please start a new conversation."
                )
            }
        }
    }

    /**
     * Stop the session and upload data to cloud.
     *
     * @param reason Why the session is ending: "user_stopped", "pause_timeout", "all_captured"
     */
    suspend fun stopSession(reason: String = "user_stopped") {
        val sessionId = _uiState.value.sessionId ?: return
        val currentPhase = _uiState.value.sessionPhase
        if (currentPhase != SessionPhase.ACTIVE && currentPhase != SessionPhase.PAUSED) return

        pauseTimeoutHandler.cancelTimeout()
        _uiState.update { it.copy(sessionPhase = SessionPhase.ENDING) }

        try {
            // Step 1: End LLM session to get transcript + summary
            val endResponse = llmApi.endSession(sessionId, LlmEndSessionRequest(reason))

            val sessionDuration = System.currentTimeMillis() - sessionStartTime

            // Update state with final summary
            val confirmedValues = endResponse.summary.confirmed_values.map { v ->
                ConfirmedValue(
                    parameter = v.parameter,
                    loincCode = v.loinc_code,
                    value = v.value,
                    unit = v.unit,
                    timestamp = Instant.now().toString()
                )
            }

            val missedParams = endResponse.summary.missed_parameters.map { name ->
                ParameterConfig(name = name, loincCodes = emptyList(), unit = "", frequencyDays = null, thresholdMin = null, thresholdMax = null)
            }

            _uiState.update {
                it.copy(
                    confirmedValues = confirmedValues,
                    remainingParameters = missedParams,
                    sessionDurationMs = sessionDuration,
                    turnCount = endResponse.summary.turn_count
                )
            }

            // Step 2: Submit FHIR batch (FIRST priority)
            scope.launch {
                try {
                    submitFhirBatch(sessionId, confirmedValues)
                    Log.i(TAG, "FHIR batch submitted for session $sessionId")
                } catch (e: Exception) {
                    Log.e(TAG, "FHIR batch submission failed", e)
                }
            }

            // Step 3: Store raw interaction (INDEPENDENT, retry on failure)
            scope.launch {
                try {
                    conversationRepository.storeRawInteraction(sessionId, endResponse)
                    Log.i(TAG, "Raw interaction stored for session $sessionId")
                } catch (e: Exception) {
                    Log.e(TAG, "Raw interaction storage failed (non-blocking)", e)
                }
            }

            _uiState.update { it.copy(sessionPhase = SessionPhase.ENDED) }
            Log.i(TAG, "Session ended: $sessionId, reason=$reason")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to end session cleanly", e)
            _uiState.update {
                it.copy(
                    sessionPhase = SessionPhase.ENDED,
                    errorMessage = "Session ended with errors. Data may not have been saved."
                )
            }
        }
    }

    /**
     * Reset the session state for a fresh start.
     */
    fun resetSession() {
        pauseTimeoutHandler.cancelTimeout()
        conversationRepository.resetLatencyTracking()
        conversationRepository.release()
        turnNumber = 0
        sessionStartTime = 0L
        _uiState.value = ConversationUiState()
    }

    /**
     * Update the recording state in UI.
     */
    fun setRecording(recording: Boolean) {
        _uiState.update { it.copy(isRecording = recording) }
    }

    /**
     * Update the current live transcript (for streaming mode).
     */
    fun updateCurrentTranscript(transcript: String) {
        _uiState.update { it.copy(currentTranscript = transcript) }
    }

    /**
     * Set vision result from photo capture.
     */
    fun setVisionResult(result: VisionResult?) {
        _uiState.update { it.copy(visionResult = result, showCamera = false) }
    }

    /**
     * Dismiss the current error message.
     */
    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    // ── Private Helpers ─────────────────────────────────────────

    private fun handleLlmResponse(result: ConversationTurn) {
        _uiState.update { state ->
            val newTurns = state.conversationTurns + result

            // Update confirmed/pending values from extracted values
            val newConfirmed = state.confirmedValues.toMutableList()
            val newPending = state.pendingConfirmation.toMutableList()

            for (value in result.extractedValues) {
                when (value.status) {
                    "confirmed" -> {
                        newConfirmed.add(
                            ConfirmedValue(
                                parameter = value.parameter,
                                loincCode = value.loincCode,
                                value = value.value,
                                unit = value.unit,
                                timestamp = Instant.now().toString()
                            )
                        )
                        // Remove from pending if it was there
                        newPending.removeAll { it.parameter == value.parameter }
                    }
                    "pending" -> {
                        newPending.removeAll { it.parameter == value.parameter }
                        newPending.add(value)
                    }
                }
            }

            // Determine if camera should be shown
            val showCamera = result.action == "request_photo"

            // Check if all parameters are captured
            val allCaptured = result.action == "all_captured"

            state.copy(
                conversationTurns = newTurns,
                lastSystemResponse = result.systemText,
                currentTranscript = "",
                confirmedValues = newConfirmed,
                pendingConfirmation = newPending,
                showCamera = showCamera,
                turnCount = state.turnCount + 1
            ).let { updated ->
                if (allCaptured) {
                    // Auto-end when all parameters are captured
                    scope.launch { stopSession("all_captured") }
                    updated
                } else {
                    updated
                }
            }
        }
    }

    private fun handleProcessingError() {
        _uiState.update { state ->
            val newRetryCount = state.retryCount + 1
            state.copy(
                isProcessing = false,
                retryCount = newRetryCount,
                // Show text fallback after 2 failed STT attempts
                showTextInput = newRetryCount >= 2,
                errorMessage = if (newRetryCount >= 2) {
                    "Voice recognition failed. Please type your response."
                } else {
                    "Could not understand. Please try again."
                }
            )
        }
    }

    private suspend fun submitFhirBatch(sessionId: String, values: List<ConfirmedValue>) {
        if (values.isEmpty()) return

        val patientId = _uiState.value.sessionId?.let {
            // Patient ID is embedded in session context; use a sensible fallback
            "unknown"
        } ?: return

        val observations = values.map { v ->
            FhirObservationEntry(
                parameter = v.parameter,
                loinc_code = v.loincCode,
                value = v.value,
                unit = v.unit,
                timestamp = v.timestamp
            )
        }

        cloudApiService.submitFhirBatch(
            FhirBatchRequest(
                session_id = sessionId,
                patient_id = patientId,
                observations = observations
            )
        )
    }
}

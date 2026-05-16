package com.carelog.conversation.session

/**
 * UI state for the conversation screen.
 *
 * This is the single source of truth observed by ConversationScreen.
 * Updated by ConversationViewModel as the STT -> LLM -> TTS pipeline runs.
 */
data class ConversationUiState(
    val sessionPhase: SessionPhase = SessionPhase.NOT_STARTED,
    val sessionId: String? = null,
    val confirmedValues: List<ConfirmedValue> = emptyList(),
    val pendingConfirmation: List<ExtractedValue> = emptyList(),
    val remainingParameters: List<ParameterConfig> = emptyList(),
    val conversationTurns: List<ConversationTurn> = emptyList(),
    val currentTranscript: String = "",
    val lastSystemResponse: String = "",
    val isRecording: Boolean = false,
    val isProcessing: Boolean = false,
    val isPlayingAudio: Boolean = false,
    val errorMessage: String? = null,
    val retryCount: Int = 0,
    val showTextInput: Boolean = false,
    val showCamera: Boolean = false,
    val visionResult: VisionResult? = null,
    val sessionDurationMs: Long = 0L,
    val turnCount: Int = 0
)

/**
 * Phases of a conversation session lifecycle.
 */
enum class SessionPhase {
    /** No session active. Show Start button. */
    NOT_STARTED,
    /** Fetching config from cloud + creating LLM session. */
    STARTING,
    /** Session is active, conversation in progress. */
    ACTIVE,
    /** Session paused by user. 5-minute auto-end timer running. */
    PAUSED,
    /** Session ending: uploading data to cloud. */
    ENDING,
    /** Session complete. Show summary. */
    ENDED
}

/**
 * A confirmed clinical value extracted from the conversation.
 */
data class ConfirmedValue(
    val parameter: String,
    val loincCode: String,
    val value: Double,
    val unit: String,
    val timestamp: String
)

/**
 * A value extracted by the LLM that is pending patient confirmation.
 */
data class ExtractedValue(
    val parameter: String,
    val loincCode: String,
    val value: Double,
    val unit: String,
    val status: String
)

/**
 * Configuration for a parameter to be collected in this session.
 */
data class ParameterConfig(
    val name: String,
    val loincCodes: List<String>,
    val unit: String,
    val frequencyDays: Int?,
    val thresholdMin: List<Double>?,
    val thresholdMax: List<Double>?
)

/**
 * A single turn in the conversation (patient utterance + system response).
 */
data class ConversationTurn(
    val turnNumber: Int,
    val patientText: String,
    val systemText: String,
    val extractedValues: List<ExtractedValue> = emptyList(),
    val action: String? = null
)

/**
 * Result from the Vision API after processing a device photo.
 */
data class VisionResult(
    val deviceType: String,
    val confidence: Double,
    val readings: List<VisionReading>,
    val rawTextDetected: String?
)

/**
 * A single reading extracted from a device photo.
 */
data class VisionReading(
    val label: String,
    val value: Double,
    val unit: String
)

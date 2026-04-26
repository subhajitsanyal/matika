package com.carelog.network

import retrofit2.http.Body
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * Retrofit interface for the Mac Mini LLM service on port 8002.
 *
 * Manages conversation sessions: create, send utterances, pause, resume, end.
 */
interface MacMiniLlmApi {

    /**
     * Create a new conversation session.
     *
     * @param request Session creation request with patient config, parameters, and topics.
     * @return Session ID, greeting text, and initial state.
     */
    @POST("sessions")
    suspend fun createSession(
        @Body request: LlmCreateSessionRequest
    ): LlmCreateSessionResponse

    /**
     * Send a patient utterance to the active session.
     *
     * @param sessionId The active session ID.
     * @param request Utterance text and turn number.
     * @return LLM response with extracted values, session state, and next action.
     */
    @POST("sessions/{sessionId}/utterance")
    suspend fun sendUtterance(
        @Path("sessionId") sessionId: String,
        @Body request: LlmUtteranceRequest
    ): LlmUtteranceResponse

    /**
     * End an active session.
     *
     * @param sessionId The session to end.
     * @param request Reason for ending (user_stopped, pause_timeout, all_captured).
     * @return Session summary with confirmed values, transcript, and statistics.
     */
    @POST("sessions/{sessionId}/end")
    suspend fun endSession(
        @Path("sessionId") sessionId: String,
        @Body request: LlmEndSessionRequest
    ): LlmEndSessionResponse

    /**
     * Pause an active session. Session auto-ends after 300 seconds.
     */
    @POST("sessions/{sessionId}/pause")
    suspend fun pauseSession(
        @Path("sessionId") sessionId: String
    ): LlmPauseSessionResponse

    /**
     * Resume a paused session within the timeout window.
     * Returns 410 Gone if the session has already timed out.
     */
    @POST("sessions/{sessionId}/resume")
    suspend fun resumeSession(
        @Path("sessionId") sessionId: String
    ): LlmResumeSessionResponse
}

// ── Request Models ───────────────────────────────────────────

data class LlmCreateSessionRequest(
    val session_type: String,
    val patient_id: String,
    val language: String,
    val config: LlmSessionConfig
)

data class LlmSessionConfig(
    val parameters: List<LlmParameter>,
    val topics: List<LlmTopic>?,
    val system_prompt: String?,
    val patient_name: String,
    val last_session_summary: String?
)

data class LlmParameter(
    val name: String,
    val loinc_codes: List<String>,
    val unit: String,
    val frequency_days: Int?,
    val threshold_min: List<Double>?,
    val threshold_max: List<Double>?
)

data class LlmTopic(
    val id: String,
    val name: String,
    val description: String?,
    val status: String?,
    val last_collected: String?
)

data class LlmUtteranceRequest(
    val text: String,
    val turn_number: Int
)

data class LlmEndSessionRequest(
    val reason: String
)

// ── Response Models ──────────────────────────────────────────

data class LlmCreateSessionResponse(
    val session_id: String,
    val greeting_text: String,
    val state: String
)

data class LlmUtteranceResponse(
    val response_text: String,
    val extracted_values: List<LlmExtractedValue>,
    val session_state: LlmSessionState,
    val action: String,
    val requires_photo: Boolean?
)

data class LlmExtractedValue(
    val parameter: String,
    val loinc_code: String,
    val value: Double,
    val unit: String,
    val status: String
)

data class LlmSessionState(
    val confirmed_values: List<LlmExtractedValue>,
    val pending_confirmation: List<String>,
    val remaining_parameters: List<String>,
    val topics_addressed: List<String>,
    val turn_count: Int
)

data class LlmEndSessionResponse(
    val session_id: String,
    val summary: LlmSessionSummary,
    val full_transcript: List<LlmTranscriptEntry>?,
    val state: String
)

data class LlmSessionSummary(
    val confirmed_values: List<LlmExtractedValue>,
    val missed_parameters: List<String>,
    val topics_addressed: List<String>,
    val turn_count: Int,
    val language: String,
    val duration_ms: Long,
    val status: String
)

data class LlmTranscriptEntry(
    val turn: Int,
    val role: String,
    val text: String
)

data class LlmPauseSessionResponse(
    val session_id: String,
    val state: String,
    val timeout_seconds: Int
)

data class LlmResumeSessionResponse(
    val session_id: String,
    val state: String,
    val response_text: String?
)

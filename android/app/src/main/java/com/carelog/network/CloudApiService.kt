package com.carelog.network

import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Retrofit interface for AWS Cloud API Gateway endpoints.
 *
 * All requests are authenticated with Cognito JWT via [AuthInterceptor].
 * Base URL is configured from Amplify/BuildConfig.
 */
interface CloudApiService {

    /**
     * Fetch session configuration for a patient.
     * Returns parameters, topics, thresholds, and last session context
     * needed to start a conversation session on the Mac Mini LLM.
     */
    @GET("session-config/{patientId}")
    suspend fun getSessionConfig(
        @Path("patientId") patientId: String
    ): SessionConfigResponse

    /**
     * Submit a batch of FHIR observations extracted from a conversation session.
     */
    @POST("observations/batch")
    suspend fun submitFhirBatch(
        @Body batch: FhirBatchRequest
    ): Response<Unit>

    /**
     * Store a raw conversation interaction (audio, transcript, photos).
     * Uses multipart upload to handle binary attachments.
     */
    @Multipart
    @POST("interactions")
    suspend fun storeInteraction(
        @Part("metadata") metadata: RequestBody,
        @Part audio: MultipartBody.Part?,
        @Part transcript: MultipartBody.Part?,
        @Part photos: List<MultipartBody.Part>?
    ): Response<Unit>

    /**
     * Create a new patient account.
     */
    @POST("patients")
    suspend fun createPatient(
        @Body request: CreatePatientRequest
    ): CreatePatientResponse

    /**
     * Fetch linked patients for the current caregiver.
     */
    @GET("patients")
    suspend fun getPatients(): PatientsResponse

    /**
     * Fetch a patient summary (latest values, last session info).
     */
    @GET("patients/{patientId}/summary")
    suspend fun getPatientSummary(
        @Path("patientId") patientId: String
    ): PatientSummaryResponse

    /**
     * Fetch alerts for a patient (threshold breaches, missed measurements).
     */
    @GET("patients/{patientId}/alerts")
    suspend fun getAlerts(
        @Path("patientId") patientId: String
    ): AlertsResponse

    /**
     * Acknowledge an alert.
     */
    @PUT("patients/{patientId}/alerts/{alertId}/acknowledge")
    suspend fun acknowledgeAlert(
        @Path("patientId") patientId: String,
        @Path("alertId") alertId: String
    ): Response<Unit>

    /**
     * Fetch past interactions (sessions) for a patient.
     */
    @GET("patients/{patientId}/interactions")
    suspend fun getInteractions(
        @Path("patientId") patientId: String,
        @Query("limit") limit: Int = 20,
        @Query("offset") offset: Int = 0
    ): InteractionsResponse

    /**
     * Save parameter configuration for a patient.
     */
    @POST("patients/{patientId}/parameter-configs")
    suspend fun saveParameterConfigs(
        @Path("patientId") patientId: String,
        @Body request: SaveParameterConfigsRequest
    ): Response<Unit>

    /**
     * Send an invite (SMS/email) to a patient or doctor.
     */
    @POST("invites")
    suspend fun sendInvite(
        @Body request: SendInviteRequest
    ): Response<Unit>

    /**
     * Mark a conversation session as explicitly closed (F2). Sent when
     * the user hits Stop or navigates away mid-session — gives the
     * backend a clean status='complete' transition that the LLM-driven
     * terminus path can't always observe (e.g., the user bails after
     * one turn). Idempotent on the server: a second call against an
     * already-terminal row returns the existing terminal state.
     *
     * The Android client treats this as fire-and-forget telemetry —
     * failures must not block the UI navigation that triggered them.
     */
    @POST("sessions/{sessionId}/end")
    suspend fun endSession(
        @Path("sessionId") sessionId: String
    ): Response<Unit>

    // ── Care Notes (PRD §6.9 / Spec §4.6) ───────────────────────
    // Patient-originated asides captured during conversational sessions
    // (see backend/lambdas/care-notes). The caregiver UI surfaces them
    // on CareNotesScreen with two tabs (unacked / resolved) + ack.

    /**
     * List care notes for a patient. Defaults to `unacknowledged`;
     * pass `status="acknowledged"` for the Resolved tab.
     */
    @GET("patients/{patientId}/care-notes")
    suspend fun getCareNotes(
        @Path("patientId") patientId: String,
        @Query("status") status: String = "unacknowledged",
        @Query("limit") limit: Int = 50,
        @Query("cursor") cursor: String? = null
    ): CareNotesListResponse

    /**
     * Acknowledge a care note. Idempotent — a re-ack returns the
     * existing ack timestamp + user, without re-stamping.
     */
    @POST("patients/{patientId}/care-notes/{noteId}/acknowledge")
    suspend fun acknowledgeCareNote(
        @Path("patientId") patientId: String,
        @Path("noteId") noteId: String
    ): AcknowledgeCareNoteResponse

    /**
     * Per-caregiver unread count, fanned out across every patient
     * linked to the caregiver. Drives the dashboard badge.
     */
    @GET("caregivers/{caregiverUserId}/care-notes/unread-count")
    suspend fun getCareNotesUnreadCount(
        @Path("caregiverUserId") caregiverUserId: String
    ): CareNotesUnreadCountResponse
}

// ── Response Models ──────────────────────────────────────────

/**
 * Session configuration returned by the cloud API.
 * Used to initialize a conversation session on the Mac Mini LLM.
 */
data class SessionConfigResponse(
    val patient_id: String,
    val patient_name: String,
    val language: String,
    val timezone: String,
    val parameters: List<SessionParameter>,
    val topics: List<SessionTopic>?,
    val system_prompt: String?,
    val last_session_summary: String?
)

data class SessionParameter(
    val id: String?,
    val name: String,
    val loinc_codes: List<String>,
    val unit: String,
    val frequency_days: Int?,
    val daily_deadline: String?,
    val threshold_min: List<Double>?,
    val threshold_max: List<Double>?
)

data class SessionTopic(
    val id: String,
    val name: String,
    val description: String?,
    val status: String?,
    val last_collected: String?
)

/**
 * Request body for batch FHIR observation submission.
 */
data class FhirBatchRequest(
    val session_id: String,
    val patient_id: String,
    val observations: List<FhirObservationEntry>
)

data class FhirObservationEntry(
    val parameter: String,
    val loinc_code: String,
    val value: Double,
    val unit: String,
    val timestamp: String
)

// ── Patient Management Models ───────────────────────────────

data class CreatePatientRequest(
    val name: String,
    val age: Int?,
    val date_of_birth: String?,
    val gender: String?,
    val conditions: List<String>,
    val medications: List<String>,
    val allergies: List<String>,
    val emergency_contact: EmergencyContact?,
    val primary_doctor: String?
)

data class EmergencyContact(
    val name: String,
    val phone: String,
    val relationship: String?
)

data class CreatePatientResponse(
    val patient_id: String,
    val temporary_password: String,
    val email: String?,
    /**
     * Patient's Cognito sub. Required by the v2 caregiver-onboarding
     * flow (Phase C) — `MatikaConversationViewModel` sends this as
     * `patientId` on the wire and the backend resolves the internal
     * UUID server-side. Nullable so older deployments of the
     * `create-patient` Lambda (pre-Phase-C) still parse cleanly.
     */
    val cognito_sub: String?
)

data class PatientsResponse(
    val patients: List<PatientListItem>
)

data class PatientListItem(
    val patient_id: String,
    val name: String,
    val age: Int?,
    val conditions: List<String>,
    val last_check_in: String?,
    val alert_count: Int
)

data class PatientSummaryResponse(
    val patient_id: String,
    val name: String,
    val last_session: LastSessionInfo?,
    val latest_values: List<LatestValue>,
    val alert_count: Int
)

data class LastSessionInfo(
    val session_id: String,
    val timestamp: String,
    val status: String,
    val turn_count: Int,
    val duration_ms: Long
)

data class LatestValue(
    val parameter: String,
    val value: Double,
    val unit: String,
    val timestamp: String,
    val is_threshold_breach: Boolean
)

// ── Alert Models ────────────────────────────────────────────

data class AlertsResponse(
    val alerts: List<AlertItem>
)

data class AlertItem(
    val alert_id: String,
    val patient_id: String,
    val patient_name: String?,
    val type: String,
    val parameter: String?,
    val value: Double?,
    val unit: String?,
    val threshold_min: Double?,
    val threshold_max: Double?,
    val severity: String,
    val timestamp: String,
    val days_overdue: Int?,
    val acknowledged: Boolean
)

// ── Interaction Models ──────────────────────────────────────

data class InteractionsResponse(
    val interactions: List<InteractionItem>,
    val total: Int
)

data class InteractionItem(
    val session_id: String,
    val timestamp: String,
    val type: String,
    val status: String,
    val duration_ms: Long,
    val turn_count: Int,
    val confirmed_values: List<InteractionValue>?
)

data class InteractionValue(
    val parameter: String,
    val value: Double,
    val unit: String
)

// ── Parameter Config Models ─────────────────────────────────

data class SaveParameterConfigsRequest(
    val configs: List<ParameterConfigEntry>
)

data class ParameterConfigEntry(
    val action: String,
    val parameter: String,
    val loinc_codes: List<String>?,
    val unit: String?,
    val frequency_days: Int?,
    val daily_deadline: String?,
    val threshold_min: Double?,
    val threshold_max: Double?
)

// ── Invite Models ───────────────────────────────────────────

data class SendInviteRequest(
    val patient_id: String,
    val patient_name: String,
    val invite_type: String,
    val channel: String,
    val recipient_email: String?,
    val recipient_phone: String?,
    val temporary_password: String?
)

// ── Care Notes Models (PRD §6.9 / Spec §4.6) ────────────────

/**
 * A single care note row as returned by the care-notes lambda's list
 * endpoint. Field names mirror the JSON exactly (camelCase) — moshi
 * will deserialize without a custom adapter.
 */
data class CareNoteItem(
    val id: String,
    val patientId: String,
    val patientShortId: String?,
    val sessionId: String?,
    val turnIndex: Int?,
    val source: String,                // 'patient_request' | 'matika_observation' (v2.1) | 'doctor_note' (Phase 2)
    val recipientRole: String,         // 'caregiver' (v2.0) | 'doctor' (Phase 2)
    val recipientUserId: String?,
    val recipientDisplayName: String?,
    val candidateUserIds: List<String>?,
    val mentionedName: String?,
    val disambiguationStatus: String,  // 'resolved' | 'resolved_default' | 'ambiguous' | 'no_match'
    val noteText: String,
    val noteLanguage: String,
    val acknowledgedAt: String?,
    val acknowledgedBy: String?,
    val createdAt: String
)

data class CareNotesListResponse(
    val items: List<CareNoteItem>,
    val nextCursor: String?,
    val unacknowledgedCount: Int
)

data class AcknowledgeCareNoteResponse(
    val id: String,
    val acknowledgedAt: String,
    val acknowledgedBy: String
)

data class CareNotesUnreadCountResponse(
    val count: Int,
    val perPatient: List<CareNotesPerPatientCount>
)

data class CareNotesPerPatientCount(
    val patientShortId: String,
    val count: Int
)

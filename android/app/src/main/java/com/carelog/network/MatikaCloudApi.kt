package com.carelog.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

/**
 * Matika v2 cloud API — the AWS Bedrock conversational backend.
 *
 * Routes are added to the same API Gateway REST API as the v1
 * [CloudApiService], so this interface uses the same `@CloudApi`
 * Retrofit instance and shares the Cognito [AuthInterceptor]. Kept as a
 * separate interface (rather than extending [CloudApiService]) so the
 * v1 surface can be deleted later without churn here.
 *
 * Wire format: backend speaks camelCase JSON (TypeScript style), so DTO
 * properties are camelCase to match exactly. Default Gson naming policy
 * preserves field names as-is — no `@SerializedName` annotations needed.
 *
 * Identity convention: every request that takes a `patientId` sends the
 * patient's Cognito sub. The backend resolves the internal
 * `patients.id` UUID server-side. See `docs/android_v2_plan.md` Phase 0
 * gap #5 for citation.
 */
interface MatikaCloudApi {

    /**
     * Single conversational turn — patient or caregiver speaks, the LLM
     * responds, and the server persists session state.
     *
     * Spec: `docs/matika_spec_v2.md` §4.1.
     * Backend: `backend/lambdas/bedrock-router`.
     */
    @POST("conversation/turn")
    suspend fun turn(@Body request: TurnRequest): TurnResponse

    /**
     * Issue a short-lived (5 min) S3 PUT URL the client uses to upload a
     * JPEG before calling [photoExtract]. The response carries
     * [PhotoPresignResponse.requiredHeaders] — every entry MUST be
     * echoed on the S3 PUT or the bucket policy rejects with 403.
     *
     * Spec: `docs/matika_spec_v2.md` §4.2 (companion to photo-extract).
     * Backend: `backend/lambdas/photo-presign`.
     */
    @POST("conversation/photo-presign")
    suspend fun photoPresign(@Body request: PhotoPresignRequest): PhotoPresignResponse

    /**
     * Extract a numeric reading (BP, glucose, etc.) from a previously
     * uploaded photo. Caller passes the [photoS3Key] returned by
     * [photoPresign] — Lambda fetches the object server-side and
     * invokes Bedrock Haiku vision (escalating to Sonnet on low
     * confidence).
     *
     * Spec: `docs/matika_spec_v2.md` §4.2.
     * Backend: `backend/lambdas/bedrock-vision`.
     */
    @POST("conversation/photo-extract")
    suspend fun photoExtract(@Body request: PhotoExtractRequest): PhotoExtractResponse

    /**
     * Aggregate health probe (RDS + Bedrock + S3). Unauthenticated by
     * design — the [AuthInterceptor] header is harmlessly ignored.
     *
     * Spec: `docs/matika_spec_v2.md` §4.3.
     * Backend: `backend/lambdas/health-check`.
     */
    @GET("health")
    suspend fun health(): MatikaHealthResponse
}

// ── /conversation/turn ──────────────────────────────────────────

/**
 * Request body for `POST /conversation/turn`.
 *
 * @property sessionId Client-generated UUID. Stable across all turns of
 *   the same conversation; the first turn creates the
 *   `interaction_sessions` row.
 * @property patientId Patient's Cognito sub (NOT the internal
 *   `patients.id` UUID — backend resolves that server-side).
 * @property language `en-IN`, `hi-IN`, or `bn-IN`. Backend validates.
 * @property turnSequence Monotonic counter, starting at 1 for the first
 *   turn of the session.
 * @property sessionType Optional. Honored only on the first turn of a
 *   session; ignored thereafter (session type is fixed at creation).
 *   Defaults server-side to `patient_logging`.
 * @property actorCognitoSub Cognito sub of the user actually making the
 *   call. For `patient_logging` this equals [patientId]; for
 *   `caregiver_*` sessions this is the caregiver's sub. Drives
 *   `parameter_configs.threshold_set_by` attribution. Always send it.
 */
data class TurnRequest(
    val sessionId: String,
    val patientId: String,
    val transcript: String,
    val language: String,
    val turnSequence: Int,
    val sessionType: String? = null,
    val actorCognitoSub: String? = null,
    val clientHints: ClientHints? = null,
)

data class ClientHints(
    val preferStreaming: Boolean? = null,
    val deviceLatencyEstimateMs: Int? = null,
)

/** Session type constants matching backend validation. */
object SessionType {
    const val PATIENT_LOGGING = "patient_logging"
    const val CAREGIVER_CONFIG = "caregiver_config"
    const val CAREGIVER_ONBOARDING = "caregiver_onboarding"
}

/**
 * Response body for `POST /conversation/turn`.
 *
 * Mirrors `TurnResponseBody` in
 * `backend/lambdas/bedrock-router/src/handler.ts`.
 */
data class TurnResponse(
    val responseText: String,
    val ttsHints: TtsHints,
    val extractedValues: List<ExtractedValue>,
    val sessionState: SessionStateBlock,
    val actions: List<TurnAction>,
    val telemetry: TurnTelemetry,
    /**
     * Present only on `caregiver_onboarding` turns that triggered the
     * end-of-session protocol-extraction pass. Absent on every other
     * turn.
     */
    val protocol: ProtocolResult? = null,
    /**
     * Present only on turns that confirmed at least one extracted
     * value (T-V2-304 — confirmed-value → FHIR Observation bridge).
     * Absent when no values were confirmed this turn.
     */
    val observations: ObservationsResult? = null,
)

data class TtsHints(
    val language: String,
    val spellOutNumbers: Boolean,
    val rate: Double? = null,
)

/**
 * One extracted reading from the transcript. The same parameter may
 * appear with different statuses across turns (e.g. `rejected` when
 * the patient corrects an earlier value, then `pending_confirmation`
 * for the corrected value).
 */
data class ExtractedValue(
    val parameter: String,
    val value: Double,
    val unit: String,
    val loincCode: String,
    val status: String,
    val confidence: Double,
)

/** [ExtractedValue.status] vocabulary. */
object ExtractedValueStatus {
    const val PENDING_CONFIRMATION = "pending_confirmation"
    const val CONFIRMED = "confirmed"
    const val REJECTED = "rejected"
}

data class SessionStateBlock(
    val capturedThisSession: List<ExtractedValue>,
    val pendingConfirmation: List<ExtractedValue>,
    val stillNeeded: List<String>,
    val fsmState: String,
)

data class TurnAction(
    val type: String,
    val reason: String? = null,
)

/** [TurnAction.type] vocabulary — drive UI side-effects from these. */
object TurnActionType {
    const val REQUEST_PHOTO = "request_photo"
    const val ESCALATE_EMERGENCY = "escalate_emergency"
    const val PAUSE_SESSION = "pause_session"
    const val COMPLETE_SESSION = "complete_session"
    const val CONFIRM_VALUE = "confirm_value"
}

data class TurnTelemetry(
    val tier: String,
    val model: String,
    val latencyMs: Long,
    val inputTokens: Int,
    val cachedInputTokens: Int,
    val outputTokens: Int,
    val guardrailBlocked: Boolean,
    val inferenceRegion: String,
    val escalationReason: String?,
    val softCapReached: Boolean,
)

data class ProtocolResult(
    val extracted: Boolean,
    val parametersConfigured: Int,
    val topicsConfigured: Int,
    val topicsSkipped: List<String>,
    val error: String?,
)

data class ObservationsResult(
    val written: Int,
    val failed: Int,
    val s3Keys: List<String>,
    val errors: List<String>,
)

// ── /conversation/photo-presign ────────────────────────────────

data class PhotoPresignRequest(
    val patientId: String,
    val sessionId: String,
    /** Defaults server-side to `image/jpeg`. Must match `image/(jpe?g|png|heic|webp)`. */
    val contentType: String? = null,
)

/**
 * @property requiredHeaders Headers the client MUST echo on the S3 PUT.
 *   Includes `Content-Type` and `x-amz-server-side-encryption: aws:kms`
 *   — omitting either causes the bucket policy to reject the upload
 *   with 403. Iterate and apply all entries.
 * @property expiresIn Seconds until [uploadUrl] becomes invalid.
 */
data class PhotoPresignResponse(
    val uploadUrl: String,
    val s3Key: String,
    val requiredHeaders: Map<String, String>,
    val expiresIn: Int,
)

// ── /conversation/photo-extract ────────────────────────────────

data class PhotoExtractRequest(
    val sessionId: String,
    val patientId: String,
    val photoS3Key: String,
    val expectedParameter: String,
    val expectedUnit: String,
    val deviceHint: String? = null,
    /**
     * On-device ML Kit pre-pass result. Sent when ML Kit produced a
     * candidate but with confidence below the local threshold (0.85);
     * the Lambda treats it as a hint, not ground truth.
     */
    val localOcrAttempt: LocalOcrAttempt? = null,
)

data class LocalOcrAttempt(
    val rawText: String,
    val confidence: Double,
)

data class PhotoExtractResponse(
    val extractedValue: PhotoExtractedValue,
    val telemetry: PhotoTelemetry,
)

data class PhotoExtractedValue(
    val parameter: String,
    val value: Double,
    val unit: String,
    val loincCode: String,
    val confidence: Double,
    /** e.g. `claude-haiku-4-5-vision`, `claude-sonnet-4-x-vision`. */
    val source: String,
)

data class PhotoTelemetry(
    val tier: String,
    val haikuLatencyMs: Long,
    val sonnetLatencyMs: Long? = null,
    val sonnetUsed: Boolean,
    val inferenceRegion: String,
)

// ── /health ────────────────────────────────────────────────────
//
// `Matika`-prefixed to avoid colliding with the v1 `HealthResponse` in
// `MacMiniApiService.kt`, which the v1 `HealthCheckService` still uses.
// The v1 type can be deleted alongside the rest of the Mac Mini surface
// in Phase E.

data class MatikaHealthResponse(
    val status: String,
    val checks: MatikaHealthChecks,
    /** Populated only when one or more probes failed; key is probe name. */
    val errors: Map<String, String>? = null,
    val timestamp: String,
)

/**
 * Two fields use snake_case on the wire (only on this endpoint — the
 * conversation routes are pure camelCase). `@SerializedName` keeps the
 * Kotlin properties idiomatic without forcing snake_case Kotlin names.
 */
data class MatikaHealthChecks(
    val rds: String,
    val bedrock: String,
    @SerializedName("bedrock_inference_region")
    val bedrockInferenceRegion: String?,
    val s3: String,
    @SerializedName("lambda_warm")
    val lambdaWarm: Boolean,
)

/** [MatikaHealthResponse.status] values. */
object MatikaHealthStatus {
    const val HEALTHY = "healthy"
    const val DEGRADED = "degraded"
}

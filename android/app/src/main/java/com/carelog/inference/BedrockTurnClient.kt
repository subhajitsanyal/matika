package com.carelog.inference

import com.carelog.network.ClientHints
import com.carelog.network.MatikaCloudApi
import com.carelog.network.PatientCredentials
import com.carelog.network.TurnRequest
import com.carelog.network.TurnResponse
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Thin domain-layer wrapper around [MatikaCloudApi.turn].
 *
 * Responsibilities:
 *  - Translate the domain naming (`patientCognitoSub`, `actorCognitoSub`)
 *    to the wire field name (`patientId` carries the Cognito sub —
 *    backend resolves the internal UUID; see `docs/android_v2_plan.md`
 *    Phase 0 gap #5).
 *  - Wrap the network call in a [Result] so callers can fold success
 *    and failure without try/catch.
 *
 * Stateless by design — the caller (typically [ConversationStateMachine])
 * owns sessionId, the turn counter, and per-session config. Keeping
 * this client stateless lets future cross-cutting concerns (timing
 * logs, retry, idempotency keys) attach here without untangling state.
 */
@Singleton
class BedrockTurnClient @Inject constructor(
    private val api: MatikaCloudApi,
) {
    /**
     * Submit one turn. Network/server errors surface as
     * [Result.failure]; the caller decides how to translate them into
     * UI state.
     */
    suspend fun submitTurn(
        sessionId: String,
        patientCognitoSub: String,
        actorCognitoSub: String,
        transcript: String,
        languageTag: String,
        turnSequence: Int,
        sessionType: String? = null,
        patientCredentials: PatientCredentials? = null,
        forceNonStreaming: Boolean = false,
    ): Result<TurnResponse> = runCatching {
        // F23 — caregiver_onboarding placeholder turns MUST go via the
        // non-streaming handler (`/conversation/turn`). The streaming
        // path doesn't implement the mid-session pivot to
        // create-patient-from-voice; the only safe route while
        // patientCognitoSub is the `pending-<sessionId>` sentinel is to
        // pin preferStreaming=false. The hint is advisory but the
        // handler honors it.
        val hints = if (forceNonStreaming) ClientHints(preferStreaming = false) else null
        api.turn(
            TurnRequest(
                sessionId = sessionId,
                patientId = patientCognitoSub,
                transcript = transcript,
                language = languageTag,
                turnSequence = turnSequence,
                sessionType = sessionType,
                actorCognitoSub = actorCognitoSub,
                clientHints = hints,
                patientCredentials = patientCredentials,
            ),
        )
    }
}

package com.carelog.inference

import com.carelog.network.TurnResponse
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID
import javax.inject.Inject

/**
 * Holds [ConversationState] and exposes it as a [StateFlow] for the UI.
 *
 * Per spec §8.5, the server is authoritative for FSM transitions —
 * this class is a *projector*, not an enforcer. It generates
 * `sessionId`, increments the turn counter, snapshots inputs for
 * outbound calls, and folds responses back into state. It never
 * decides FSM transitions on its own.
 *
 * Local-only state (pause, connectivity, processing flag, last error)
 * is mutated directly by client-side events.
 *
 * Not Hilt-scoped: each `@Inject`-site gets a fresh instance, so
 * `ConversationViewModel` (one per screen) gets a clean state holder.
 */
class ConversationStateMachine @Inject constructor() {

    private val _state = MutableStateFlow(ConversationState())
    val state: StateFlow<ConversationState> = _state.asStateFlow()

    /**
     * Initialise a new session. Generates and returns a fresh
     * `sessionId` unless [externalSessionId] is supplied, in which case
     * that one is used verbatim. Resets per-turn state; preserves
     * nothing from the prior session — call [reset] explicitly if you
     * want to clear before starting a new one.
     *
     * F23 — the voice patient-onboarding flow generates the sessionId
     * at the FAB navigation point so it can construct the matching
     * `pending-<sessionId>` placeholder patientCognitoSub. The
     * ViewModel forwards that sessionId here so the wire payload's
     * sessionId stays in sync with the patientCognitoSub sentinel
     * across every turn.
     */
    fun start(
        patientCognitoSub: String,
        actorCognitoSub: String,
        languageTag: String,
        sessionType: String?,
        externalSessionId: String? = null,
    ): String {
        val sessionId = externalSessionId ?: UUID.randomUUID().toString()
        _state.value = ConversationState(
            fsmState = ConversationFsmState.CREATED,
            sessionId = sessionId,
            turnSequence = 0,
            language = languageTag,
            sessionType = sessionType,
            patientCognitoSub = patientCognitoSub,
            actorCognitoSub = actorCognitoSub,
        )
        return sessionId
    }

    /**
     * Atomically increment the turn counter, mark the session as
     * processing, clear any prior error, and return a frozen
     * [TurnInputs] snapshot for the caller to use when building the
     * outbound [com.carelog.network.TurnRequest].
     *
     * Throws if the session was never started — the orchestrator
     * should always call [start] first.
     */
    fun beginTurn(): TurnInputs {
        val current = _state.value
        val sessionId = requireNotNull(current.sessionId) {
            "ConversationStateMachine.beginTurn called before start()"
        }
        val patientSub = requireNotNull(current.patientCognitoSub) {
            "patientCognitoSub missing — start() not called?"
        }
        val actorSub = requireNotNull(current.actorCognitoSub) {
            "actorCognitoSub missing — start() not called?"
        }
        val nextSeq = current.turnSequence + 1
        _state.value = current.copy(
            turnSequence = nextSeq,
            isProcessingTurn = true,
            lastError = null,
        )
        return TurnInputs(
            sessionId = sessionId,
            patientCognitoSub = patientSub,
            actorCognitoSub = actorSub,
            languageTag = current.language,
            turnSequence = nextSeq,
            // Server fixes session type at creation and ignores it on
            // subsequent turns. Send it only on turn 1 so the wire
            // payload is honest about intent.
            sessionType = if (nextSeq == 1) current.sessionType else null,
        )
    }

    /**
     * Fold a successful [TurnResponse] into state. Mirrors all
     * server-driven fields and clears the in-flight flag. Resets
     * connectivity to `HEALTHY` since a successful turn implies the
     * link is up.
     */
    fun applyTurnResponse(response: TurnResponse) {
        _state.value = _state.value.copy(
            fsmState = ConversationFsmState.fromServer(response.sessionState.fsmState),
            capturedThisSession = response.sessionState.capturedThisSession,
            pendingConfirmation = response.sessionState.pendingConfirmation,
            stillNeeded = response.sessionState.stillNeeded,
            lastResponseText = response.responseText,
            lastTtsHints = response.ttsHints,
            lastActions = response.actions,
            isProcessingTurn = false,
            connectivity = ConnectivityState.HEALTHY,
            lastError = null,
        )
    }

    /** Surface a turn failure without rolling back the turn counter. */
    fun applyTurnFailure(error: Throwable) {
        _state.value = _state.value.copy(
            isProcessingTurn = false,
            lastError = error.message ?: error::class.simpleName ?: "Unknown error",
        )
    }

    /** Clear the surfaced [ConversationState.lastError] (e.g. after the UI shows it). */
    fun clearLastError() {
        if (_state.value.lastError == null) return
        _state.value = _state.value.copy(lastError = null)
    }

    /** User explicitly paused the conversation. FSM state is preserved. */
    fun userPause() {
        _state.value = _state.value.copy(isPausedByUser = true)
    }

    /** User resumed from pause. FSM state was untouched while paused. */
    fun userResume() {
        _state.value = _state.value.copy(isPausedByUser = false)
    }

    /** Update connectivity independently of the FSM state. */
    fun connectivityChanged(connectivity: ConnectivityState) {
        _state.value = _state.value.copy(connectivity = connectivity)
    }

    /** Clear all state and return to [ConversationFsmState.IDLE]. */
    fun reset() {
        _state.value = ConversationState()
    }
}

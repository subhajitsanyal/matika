package com.carelog.inference

import com.carelog.network.ExtractedValue
import com.carelog.network.TtsHints
import com.carelog.network.TurnAction

/**
 * Mirror of the server-side conversation FSM (spec §6.2). Per spec
 * §8.5 the server is authoritative — the client renders whatever
 * `sessionState.fsmState` value comes back. We model the full set
 * here so transitions can be exhaustively handled in the UI; an
 * unrecognised value falls into [UNKNOWN] rather than crashing, so a
 * server-side state addition never bricks an in-pilot client.
 */
enum class ConversationFsmState {
    /** No session in progress yet. */
    IDLE,

    // ── Server-mirrored states (matika_spec_v2.md §6.2) ────────
    CREATED,
    GREETING,
    EXTRACTING,
    PENDING_CONFIRMATION,
    AWAITING_PHOTO,
    PLAUSIBILITY_CHALLENGE,
    EMERGENCY,
    COMPLETE,
    TERMINAL,
    TERMINAL_INCOMPLETE,
    PAUSED,
    SUSPENDED,

    // ── F23 caregiver_onboarding profile-extraction sub-states ─
    // Emitted by the server on caregiver_onboarding sessions while
    // the LLM is capturing / confirming the patient profile (name,
    // age, gender, conditions, …). See backend `output_schema.json`
    // stateTransition pattern. Without these here, the F23 state
    // badge in MatikaConversationScreen rendered the literal
    // "UNKNOWN" for every caregiver turn.
    EXTRACTING_PROFILE,
    AWAITING_PROFILE_CONFIRMATION,
    PROFILE_CONFIRMED,

    /** Server returned an FSM state we don't recognise. UI should fall back gracefully. */
    UNKNOWN;

    companion object {
        /** Lenient lookup — unknown strings map to [UNKNOWN] rather than throwing. */
        fun fromServer(value: String?): ConversationFsmState {
            if (value == null) return UNKNOWN
            return entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: UNKNOWN
        }
    }
}

/**
 * Local-only flag tracking how reliable the connection looks. Distinct
 * from the server FSM — a session can be in `EXTRACTING` while
 * connectivity is `DEGRADED` (the last turn timed out).
 */
enum class ConnectivityState {
    HEALTHY,
    RECONNECTING,
    DEGRADED,
}

/**
 * Snapshot of the conversation. Exposed via
 * [ConversationStateMachine.state] for the UI to render directly.
 *
 * Identity and per-session config (`sessionId`, both Cognito subs,
 * `language`, `sessionType`) are seeded by [ConversationStateMachine.start]
 * and stay stable across the session. Per-turn fields
 * (`pendingConfirmation`, `lastResponseText`, etc.) are overwritten on
 * each [ConversationStateMachine.applyTurnResponse].
 */
data class ConversationState(
    val fsmState: ConversationFsmState = ConversationFsmState.IDLE,

    // ── Session identity / config (stable per session) ─────────
    val sessionId: String? = null,
    val turnSequence: Int = 0,
    val language: String = "en-IN",
    val sessionType: String? = null,
    val patientCognitoSub: String? = null,
    val actorCognitoSub: String? = null,

    // ── Server-mirrored data (refreshed each turn) ─────────────
    val capturedThisSession: List<ExtractedValue> = emptyList(),
    val pendingConfirmation: List<ExtractedValue> = emptyList(),
    val stillNeeded: List<String> = emptyList(),
    val lastResponseText: String? = null,
    val lastTtsHints: TtsHints? = null,
    val lastActions: List<TurnAction> = emptyList(),

    // ── Local-only state ───────────────────────────────────────
    val isPausedByUser: Boolean = false,
    val connectivity: ConnectivityState = ConnectivityState.HEALTHY,
    val isProcessingTurn: Boolean = false,
    /** Last error message from a failed turn — null after the next successful turn. */
    val lastError: String? = null,
)

/**
 * Frozen snapshot of the inputs needed to build one [com.carelog.network.TurnRequest].
 * Returned by [ConversationStateMachine.beginTurn] so the orchestrator
 * (typically `ConversationViewModel`) doesn't have to re-read state
 * fields that may change while the network call is in flight.
 */
data class TurnInputs(
    val sessionId: String,
    val patientCognitoSub: String,
    val actorCognitoSub: String,
    val languageTag: String,
    val turnSequence: Int,
    /** Non-null only on the first turn of a session (server fixes the type at creation). */
    val sessionType: String?,
)

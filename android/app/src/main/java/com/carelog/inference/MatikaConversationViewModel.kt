package com.carelog.inference

import android.util.Log
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.auth.AuthRepository
import com.carelog.conversation.audio.stt.SttErrorCode
import com.carelog.conversation.audio.stt.SttManager
import com.carelog.conversation.audio.stt.SttResult
import com.carelog.conversation.audio.tts.NumberFormatter
import com.carelog.conversation.audio.tts.TtsManager
import com.carelog.conversation.audio.tts.TtsQueueMode
import com.carelog.core.config.AppSettings
import com.carelog.network.CloudApiService
import com.carelog.network.ProtocolResult
import com.carelog.network.SessionType
import com.carelog.network.TtsHints
import com.carelog.network.TurnActionType
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * v2 patient-logging conversation orchestration.
 *
 * Wires the four building blocks from earlier A.x phases:
 *  - [SttManager] (A.2) for on-device STT
 *  - [TtsManager] + [NumberFormatter] (A.3) for TTS playback
 *  - [BedrockTurnClient] (A.4) for `/conversation/turn`
 *  - [ConversationStateMachine] (A.4) as the projector of server-driven
 *    session state
 *
 * Scope (Phase A): patient_logging only — the actor and patient are
 * the same person, both identified by the current Cognito user's sub.
 * Caregiver-acting-on-patient flows land in Phase C.
 *
 * Threading: all public methods are safe to call from the main thread;
 * downstream suspending work runs on [viewModelScope].
 */
@HiltViewModel
class MatikaConversationViewModel @Inject constructor(
    private val sttManager: SttManager,
    private val ttsManager: TtsManager,
    private val turnClient: BedrockTurnClient,
    private val stateMachine: ConversationStateMachine,
    private val authRepository: AuthRepository,
    private val appSettings: AppSettings,
    private val cloudApiService: CloudApiService,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    /**
     * Patient's Cognito sub from the nav graph. Present on the
     * caregiver-onboarding route (Phase C); absent on the
     * patient_logging route, in which case the patient is the
     * authenticated user themselves.
     */
    private val navPatientCognitoSub: String? =
        savedStateHandle.get<String>("patientCognitoSub")

    private companion object {
        const val TAG = "MatikaConversationVM"
    }

    private val sttPartialTranscript = MutableStateFlow("")
    private val lastUserUtterance = MutableStateFlow("")
    private val sttError = MutableStateFlow<String?>(null)
    private val sessionEnded = MutableStateFlow(false)
    private val isListening = MutableStateFlow(false)
    /**
     * Caregiver-onboarding sessions emit a `protocol` block on the
     * turn that fires `complete_session`. Pin it here so the
     * SessionCompleteCard can show the extraction summary
     * ("X parameters and Y topics configured").
     */
    private val lastProtocolResult = MutableStateFlow<ProtocolResult?>(null)

    /**
     * Single observable for the screen. Composed from the state
     * machine's authoritative snapshot plus local-only flows (STT
     * partial, error, listening flag, TTS speaking flag).
     */
    val uiState: StateFlow<MatikaConversationUiState> =
        combine(
            stateMachine.state,
            sttPartialTranscript,
            lastUserUtterance,
            sttError,
            ttsManager.isSpeaking,
            isListening,
            sessionEnded,
            lastProtocolResult,
        ) { values ->
            @Suppress("UNCHECKED_CAST")
            MatikaConversationUiState(
                conversation = values[0] as ConversationState,
                sttPartialTranscript = values[1] as String,
                lastUserUtterance = values[2] as String,
                sttError = values[3] as String?,
                isSpeaking = values[4] as Boolean,
                isListening = values[5] as Boolean,
                sessionEnded = values[6] as Boolean,
                protocolResult = values[7] as ProtocolResult?,
            )
        }.stateIn(
            scope = viewModelScope,
            started = SharingStarted.Eagerly,
            initialValue = MatikaConversationUiState(),
        )

    private var sttJob: Job? = null
    private var sessionStarted = false

    /**
     * Initialize the session. Idempotent — calling repeatedly inside
     * the same screen instance is a no-op. The Compose screen calls
     * this from `LaunchedEffect(Unit)` on first entry.
     *
     * If `getCurrentUser()` returns null (the auth restore hasn't
     * populated yet, or the user really is signed out), we leave
     * `sessionStarted = false` so a later trigger (e.g. retrying after
     * sign-in) can retry. The error surfaces via [sttError].
     */
    fun startSession() {
        if (sessionStarted) return
        viewModelScope.launch {
            val user = authRepository.getCurrentUser()
            if (user == null) {
                sttError.value = "Not signed in — please sign in and re-enter the conversation screen."
                Log.w(TAG, "startSession called with no current user")
                return@launch
            }
            val languageTag = toBcp47(appSettings.language.first().code)
            val actorCognitoSub = user.userId

            // Caregiver mode: nav graph supplied the patient's Cognito
            // sub; the actor (current user) is a different person.
            // Patient mode: actor and patient are the same — the
            // authenticated user logging their own vitals.
            val isCaregiverMode = !navPatientCognitoSub.isNullOrBlank()
            val patientCognitoSub = if (isCaregiverMode) navPatientCognitoSub!! else actorCognitoSub
            val sessionType =
                if (isCaregiverMode) SessionType.CAREGIVER_ONBOARDING
                else SessionType.PATIENT_LOGGING

            // Clear any lingering UI state from a prior session so the
            // SessionCompleteCard doesn't render over the new
            // conversation when this screen is re-entered.
            sessionEnded.value = false
            sttPartialTranscript.value = ""
            lastUserUtterance.value = ""
            sttError.value = null
            lastProtocolResult.value = null
            stateMachine.start(
                patientCognitoSub = patientCognitoSub,
                actorCognitoSub = actorCognitoSub,
                languageTag = languageTag,
                sessionType = sessionType,
            )
            sessionStarted = true
            Log.i(
                TAG,
                "Started v2 session sessionType=$sessionType actor=$actorCognitoSub " +
                    "patient=$patientCognitoSub language=$languageTag",
            )
        }
    }

    /**
     * Mic button pressed. If we're already listening, this acts as a
     * cancel; otherwise it kicks off a fresh STT capture.
     */
    fun onMicPressed() {
        val active = sttJob
        if (active != null && active.isActive) {
            active.cancel()
            isListening.value = false
            return
        }

        sttError.value = null
        sttPartialTranscript.value = ""
        isListening.value = true

        sttJob = viewModelScope.launch {
            val language = stateMachine.state.value.language
            sttManager.recognize(language).collect { result ->
                when (result) {
                    is SttResult.Partial -> sttPartialTranscript.value = result.text

                    is SttResult.Final -> {
                        sttPartialTranscript.value = ""
                        isListening.value = false
                        if (result.text.isNotBlank()) {
                            Log.i(TAG, "STT final transcript chars=${result.text.length}; submitting turn")
                            lastUserUtterance.value = result.text
                            submitTurn(result.text)
                        } else {
                            // F9 — defensive: SttManager now promotes
                            // blank-hyp results to NO_MATCH errors, so
                            // we shouldn't see a blank Final here. If we
                            // do, surface it (don't silently drop) so
                            // a regression upstream doesn't disappear.
                            Log.w(TAG, "STT final returned blank text; surfacing as user-visible error")
                            sttError.value = "Didn't catch that — please try again, more loudly or closer to the microphone."
                        }
                    }

                    is SttResult.Error -> {
                        sttPartialTranscript.value = ""
                        isListening.value = false
                        sttError.value = friendlySttErrorMessage(result)
                        Log.w(TAG, "STT error ${result.code}: ${result.message}")
                    }
                }
            }
            // Coroutine completion (cancellation or natural end) drops
            // the listening flag if we somehow missed a terminal event.
            isListening.value = false
        }
    }

    /** Fallback path: the user typed text instead of speaking. */
    fun onTextSubmitted(text: String) {
        if (text.isBlank()) return
        if (uiState.value.conversation.isProcessingTurn) return
        sttError.value = null
        lastUserUtterance.value = text
        viewModelScope.launch { submitTurn(text.trim()) }
    }

    fun onPausePressed() {
        sttJob?.cancel()
        isListening.value = false
        ttsManager.stop()
        stateMachine.userPause()
    }

    fun onResumePressed() {
        stateMachine.userResume()
    }

    /**
     * User explicitly ended the session before the LLM signalled
     * `complete_session`. Doesn't reset the state machine — that would
     * wipe `capturedThisSession`, so the [SessionCompleteCard] would
     * have nothing to show even though the server has already
     * persisted any confirmed values. The next [startSession] call
     * provisions a fresh state machine cleanly.
     *
     * Also fires a fire-and-forget POST /sessions/{id}/end so the
     * backend marks the row status='complete' (F2 — explicit-close
     * half). Failures are swallowed: this is telemetry-only and must
     * not block the UI navigation that triggered the stop.
     */
    fun onStopPressed() {
        sttJob?.cancel()
        isListening.value = false
        ttsManager.stop()
        sessionStarted = false
        sessionEnded.value = true

        val sessionId = stateMachine.state.value.sessionId
        if (sessionId != null) {
            viewModelScope.launch {
                try {
                    val response = cloudApiService.endSession(sessionId)
                    if (!response.isSuccessful) {
                        Log.w(
                            TAG,
                            "endSession non-2xx (ignored) sessionId=$sessionId code=${response.code()}",
                        )
                    }
                } catch (t: Throwable) {
                    Log.w(TAG, "endSession threw (ignored) sessionId=$sessionId", t)
                }
            }
        }
    }

    fun onErrorDismissed() {
        sttError.value = null
    }

    fun onTurnErrorDismissed() {
        stateMachine.clearLastError()
    }

    override fun onCleared() {
        super.onCleared()
        sttJob?.cancel()
        ttsManager.stop()
    }

    // ── Internal helpers ──────────────────────────────────────

    private suspend fun submitTurn(transcript: String) {
        // Wrap the entire turn so any throw before the network call
        // (e.g. beginTurn() precondition violations when start() was
        // never reached) surfaces in the UI via lastError instead of
        // being swallowed by the coroutine exception handler.
        val inputs = try {
            stateMachine.beginTurn()
        } catch (t: Throwable) {
            Log.e(TAG, "beginTurn threw — was startSession called?", t)
            stateMachine.applyTurnFailure(t)
            return
        }

        Log.i(
            TAG,
            "submitTurn seq=${inputs.turnSequence} sessionId=${inputs.sessionId} " +
                "lang=${inputs.languageTag} type=${inputs.sessionType} chars=${transcript.length}",
        )

        val result = turnClient.submitTurn(
            sessionId = inputs.sessionId,
            patientCognitoSub = inputs.patientCognitoSub,
            actorCognitoSub = inputs.actorCognitoSub,
            transcript = transcript,
            languageTag = inputs.languageTag,
            turnSequence = inputs.turnSequence,
            sessionType = inputs.sessionType,
        )
        result.fold(
            onSuccess = { response ->
                Log.i(
                    TAG,
                    "submitTurn ok fsm=${response.sessionState.fsmState} " +
                        "extracted=${response.extractedValues.size} " +
                        "actions=${response.actions.map { it.type }} " +
                        "protocol=${response.protocol?.let { "${it.parametersConfigured}p+${it.topicsConfigured}t" }}",
                )
                stateMachine.applyTurnResponse(response)
                response.protocol?.let { lastProtocolResult.value = it }
                speakResponse(response.responseText, response.ttsHints)
                if (response.actions.any { it.type == TurnActionType.COMPLETE_SESSION }) {
                    sessionEnded.value = true
                }
            },
            onFailure = { err ->
                Log.e(TAG, "submitTurn failed seq=${inputs.turnSequence}", err)
                stateMachine.applyTurnFailure(err)
            },
        )
    }

    private suspend fun speakResponse(text: String, hints: TtsHints) {
        val spoken = NumberFormatter.format(
            text = text,
            languageTag = hints.language,
            spellOutNumbers = hints.spellOutNumbers,
        )
        // FLUSH so a fresh response interrupts any leftover speech
        // from the prior turn — patients shouldn't hear two responses
        // overlap if turns arrive in quick succession.
        ttsManager.speak(spoken, hints.language, queueMode = TtsQueueMode.FLUSH)
    }
}

/**
 * Map the v1 [com.carelog.core.config.AppLanguage] short ISO-639-1 codes
 * (`en`, `hi`, `bn`) to the BCP-47 region-tagged forms (`en-IN`, `hi-IN`,
 * `bn-IN`) that the v2 backend, [SttManager], and [TtsManager] all
 * expect. Passes through any code already containing a region tag so a
 * future shift to BCP-47 in `AppSettings` doesn't break this layer.
 */
internal fun toBcp47(code: String): String =
    if ("-" in code) code
    else when (code.lowercase()) {
        "en" -> "en-IN"
        "hi" -> "hi-IN"
        "bn" -> "bn-IN"
        else -> code
    }

/**
 * Surface a user-friendly message for each STT error class. The raw
 * code/message still reaches CloudWatch via `Log.w` for debugging.
 */
private fun friendlySttErrorMessage(error: SttResult.Error): String = when (error.code) {
    SttErrorCode.PERMISSION_DENIED ->
        "Microphone permission denied. Enable it in Settings → Apps → CareLog → Permissions, " +
            "or use the text-input fallback below."
    SttErrorCode.LANGUAGE_NOT_SUPPORTED ->
        "Speech recognition for this language isn't installed on your device. " +
            "Open Settings → System → Languages → Speech → Offline speech recognition " +
            "and install the matching pack. You can use the text-input fallback below " +
            "in the meantime."
    SttErrorCode.UNAVAILABLE ->
        "No speech recognition service available on this device. Use the text-input fallback below."
    SttErrorCode.NETWORK ->
        "Couldn't reach the speech service. Check your connection or use the text-input fallback below."
    SttErrorCode.NO_MATCH ->
        "Didn't catch that — please try again, more loudly or closer to the microphone."
    SttErrorCode.TIMEOUT ->
        "Listening timed out. Tap the mic again when you're ready."
    SttErrorCode.BUSY ->
        "The recogniser is still wrapping up the previous turn. Try again in a moment."
    SttErrorCode.SERVER ->
        "Speech service hit an error. Try again, or use the text-input fallback below."
    SttErrorCode.CLIENT ->
        "Audio capture failed. Check your microphone and try again."
    SttErrorCode.UNKNOWN ->
        "Speech recognition failed (${error.message}). Use the text-input fallback below."
}

/**
 * Composed UI state for the v2 conversation screen. The `conversation`
 * field is the server-authoritative slice; everything else is local
 * UX state.
 */
data class MatikaConversationUiState(
    val conversation: ConversationState = ConversationState(),
    val sttPartialTranscript: String = "",
    val lastUserUtterance: String = "",
    val sttError: String? = null,
    val isSpeaking: Boolean = false,
    val isListening: Boolean = false,
    val sessionEnded: Boolean = false,
    /**
     * Present only after a caregiver_onboarding session ends — the
     * Lambda's Sonnet protocol extractor returns its result on the
     * `complete_session` turn. Null on patient_logging sessions.
     */
    val protocolResult: ProtocolResult? = null,
)

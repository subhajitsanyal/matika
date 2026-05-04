package com.carelog.inference

import com.carelog.network.ExtractedValue
import com.carelog.network.MatikaCloudApi
import com.carelog.network.MatikaHealthResponse
import com.carelog.network.PhotoExtractRequest
import com.carelog.network.PhotoExtractResponse
import com.carelog.network.PhotoPresignRequest
import com.carelog.network.PhotoPresignResponse
import com.carelog.network.SessionStateBlock
import com.carelog.network.TtsHints
import com.carelog.network.TurnAction
import com.carelog.network.TurnRequest
import com.carelog.network.TurnResponse
import com.carelog.network.TurnTelemetry

/**
 * Test-only [MatikaCloudApi] fake. The `turn()` handler is
 * configurable so individual tests can stub the response or capture
 * the request shape; everything else throws so accidental calls
 * surface immediately.
 */
class FakeMatikaCloudApi(
    private val turnHandler: suspend (TurnRequest) -> TurnResponse =
        { error("FakeMatikaCloudApi.turn handler not stubbed") },
) : MatikaCloudApi {
    val recordedTurnRequests: MutableList<TurnRequest> = mutableListOf()

    override suspend fun turn(request: TurnRequest): TurnResponse {
        recordedTurnRequests.add(request)
        return turnHandler(request)
    }

    override suspend fun photoPresign(request: PhotoPresignRequest): PhotoPresignResponse =
        error("photoPresign not stubbed in FakeMatikaCloudApi")

    override suspend fun photoExtract(request: PhotoExtractRequest): PhotoExtractResponse =
        error("photoExtract not stubbed in FakeMatikaCloudApi")

    override suspend fun health(): MatikaHealthResponse =
        error("health not stubbed in FakeMatikaCloudApi")
}

/** Build a plausible [TurnResponse] for tests. Override fields as needed. */
fun fakeTurnResponse(
    responseText: String = "I heard one thirty over eighty five. Is that correct?",
    fsmState: String = "PENDING_CONFIRMATION",
    extractedValues: List<ExtractedValue> = listOf(
        ExtractedValue(
            parameter = "blood_pressure_systolic",
            value = 130.0,
            unit = "mmHg",
            loincCode = "8480-6",
            status = "pending_confirmation",
            confidence = 0.94,
        ),
    ),
    pendingConfirmation: List<ExtractedValue> = extractedValues,
    capturedThisSession: List<ExtractedValue> = emptyList(),
    stillNeeded: List<String> = listOf("blood_glucose"),
    actions: List<TurnAction> = emptyList(),
    tier: String = "T2",
    model: String = "claude-haiku-4-5",
    escalationReason: String? = null,
): TurnResponse = TurnResponse(
    responseText = responseText,
    ttsHints = TtsHints(language = "en-IN", spellOutNumbers = false),
    extractedValues = extractedValues,
    sessionState = SessionStateBlock(
        capturedThisSession = capturedThisSession,
        pendingConfirmation = pendingConfirmation,
        stillNeeded = stillNeeded,
        fsmState = fsmState,
    ),
    actions = actions,
    telemetry = TurnTelemetry(
        tier = tier,
        model = model,
        latencyMs = 612,
        inputTokens = 1840,
        cachedInputTokens = 1420,
        outputTokens = 28,
        guardrailBlocked = false,
        inferenceRegion = "ap-southeast-1",
        escalationReason = escalationReason,
        softCapReached = false,
    ),
)

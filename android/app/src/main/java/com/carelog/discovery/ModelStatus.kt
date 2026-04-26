package com.carelog.discovery

/**
 * Overall health status of the Mac Mini model services.
 */
enum class OverallStatus {
    /** All required services (STT, LLM, TTS, Vision) are up. */
    HEALTHY,

    /** Some services are down but partial functionality is available. */
    DEGRADED,

    /** Mac Mini not discovered or all services are down. */
    OFFLINE
}

/**
 * Status of an individual model service on the Mac Mini.
 */
data class ServiceStatus(
    val status: String,
    val port: Int
) {
    /** Whether this service is operational. */
    val isUp: Boolean get() = status == "up"
}

/**
 * Aggregated health status of all Mac Mini model services.
 *
 * Matches the response from `GET :8000/health` on the Mac Mini
 * health aggregator endpoint.
 */
data class ModelHealthStatus(
    val overallStatus: OverallStatus,
    val services: Map<String, ServiceStatus>
) {
    /** Whether the STT service is available. */
    val isSttUp: Boolean get() = services["stt"]?.isUp == true

    /** Whether the LLM service is available. */
    val isLlmUp: Boolean get() = services["llm"]?.isUp == true

    /** Whether the TTS service is available. */
    val isTtsUp: Boolean get() = services["tts"]?.isUp == true

    /** Whether the Vision service is available. */
    val isVisionUp: Boolean get() = services["vision"]?.isUp == true

    /**
     * Whether a conversation session can be started.
     * Requires both STT and LLM to be up.
     */
    val canStartConversation: Boolean get() = isSttUp && isLlmUp

    /**
     * Whether text-only mode should be used (TTS is down but STT+LLM are up).
     */
    val isTextOnlyMode: Boolean get() = canStartConversation && !isTtsUp

    /**
     * Whether photo capture for device readings is available.
     */
    val canCapturePhoto: Boolean get() = isVisionUp

    companion object {
        /** Default offline status when Mac Mini is not discovered. */
        val OFFLINE = ModelHealthStatus(
            overallStatus = OverallStatus.OFFLINE,
            services = emptyMap()
        )
    }
}

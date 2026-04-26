package com.carelog.network

import retrofit2.http.GET

/**
 * Retrofit interface for the Mac Mini health aggregator (port 8000).
 */
interface MacMiniApiService {

    /**
     * Get aggregated health status of all Mac Mini model services.
     * Returns overall status and per-service status.
     */
    @GET("health")
    suspend fun getHealth(): HealthResponse
}

// ── Response Models ──────────────────────────────────────────

/**
 * Response from `GET :8000/health`.
 */
data class HealthResponse(
    val status: String,
    val services: Map<String, ServiceStatusResponse>
)

/**
 * Status of an individual service in the health response.
 */
data class ServiceStatusResponse(
    val status: String,
    val port: Int
)

package com.carelog.discovery

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import com.carelog.core.config.AppSettings
import com.carelog.core.di.MacMiniApi
import com.carelog.network.MacMiniApiService
import com.carelog.network.HealthResponse
import com.carelog.network.ServiceStatusResponse
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Polls the Mac Mini health aggregator endpoint every 10 seconds.
 *
 * Exposes [healthStatus] as a StateFlow that downstream consumers
 * (PatientHomeScreen, CaregiverHomeScreen, ModelStatusBanner) observe
 * to determine conversation readiness and feature availability.
 *
 * Health-based behavior:
 * - LLM + STT up: conversation session can start
 * - TTS down: text-only mode allowed
 * - Vision down: photo capture disabled
 * - All down or Mac Mini not discovered: conversation button disabled
 */
@Singleton
class HealthCheckService @Inject constructor(
    private val macMiniDiscovery: MacMiniDiscovery,
    private val appSettings: AppSettings,
    @MacMiniApi private val macMiniOkHttpClient: OkHttpClient
) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _healthStatus = MutableStateFlow(ModelHealthStatus.OFFLINE)
    /** Current health status of Mac Mini model services. */
    val healthStatus: StateFlow<ModelHealthStatus> = _healthStatus.asStateFlow()

    private var pollingJob: Job? = null

    @Volatile
    private var isPolling = false

    companion object {
        private const val TAG = "HealthCheckService"
        private const val POLL_INTERVAL_MS = 10_000L
    }

    /**
     * Start polling the Mac Mini health endpoint.
     * Observes [MacMiniDiscovery.macMiniUrl] and polls when a URL is available.
     */
    fun startPolling() {
        if (isPolling) return
        isPolling = true

        pollingJob = scope.launch {
            // Use mDNS-discovered URL or manually saved URL, whichever is available.
            // collectLatest cancels the previous pollLoop when a new URL arrives.
            combine(
                macMiniDiscovery.macMiniUrl,
                appSettings.macMiniBaseUrl
            ) { discoveredUrl, savedUrl ->
                discoveredUrl ?: savedUrl
            }.collectLatest { url ->
                if (url != null) {
                    pollLoop(url)
                } else {
                    _healthStatus.value = ModelHealthStatus.OFFLINE
                }
            }
        }
    }

    /**
     * Stop health check polling.
     */
    fun stopPolling() {
        isPolling = false
        pollingJob?.cancel()
        pollingJob = null
    }

    private suspend fun pollLoop(baseUrl: String) {
        val apiService = createApiService(baseUrl)

        while (isPolling) {
            try {
                val response = apiService.getHealth()
                _healthStatus.value = mapHealthResponse(response)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e // Don't catch cancellation
            } catch (e: Exception) {
                Log.w(TAG, "Health check failed for $baseUrl", e)
                _healthStatus.value = ModelHealthStatus.OFFLINE
            }
            delay(POLL_INTERVAL_MS)
        }
    }

    private fun createApiService(baseUrl: String): MacMiniApiService {
        // Ensure the base URL ends with a slash for Retrofit
        val normalizedUrl = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        return Retrofit.Builder()
            .baseUrl(normalizedUrl)
            .client(macMiniOkHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(MacMiniApiService::class.java)
    }

    private fun mapHealthResponse(response: HealthResponse): ModelHealthStatus {
        val services = response.services.mapValues { (_, serviceResponse) ->
            ServiceStatus(
                status = serviceResponse.status,
                port = serviceResponse.port
            )
        }

        val overallStatus = when (response.status) {
            "healthy" -> OverallStatus.HEALTHY
            "degraded" -> OverallStatus.DEGRADED
            else -> OverallStatus.OFFLINE
        }

        return ModelHealthStatus(
            overallStatus = overallStatus,
            services = services
        )
    }
}

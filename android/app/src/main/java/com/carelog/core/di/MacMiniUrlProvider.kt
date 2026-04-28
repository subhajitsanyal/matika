package com.carelog.core.di

import com.carelog.core.config.AppSettings
import com.carelog.discovery.MacMiniDiscovery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Provides the current Mac Mini base URL to OkHttp interceptors.
 *
 * Combines the mDNS-discovered URL with the manually saved URL from Settings.
 * mDNS takes priority; saved URL is the fallback.
 */
@Singleton
class MacMiniUrlProvider @Inject constructor(
    private val macMiniDiscovery: MacMiniDiscovery,
    private val appSettings: AppSettings
) {
    @Volatile
    var currentUrl: String? = null
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        scope.launch {
            combine(
                macMiniDiscovery.macMiniUrl,
                appSettings.macMiniBaseUrl
            ) { discoveredUrl, savedUrl ->
                discoveredUrl ?: savedUrl
            }.collect { url ->
                currentUrl = url
            }
        }
    }
}

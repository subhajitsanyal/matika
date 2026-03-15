package com.carelog.sync

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages FHIR sync operations.
 *
 * Observes network changes and triggers sync when WiFi connects.
 * Coordinates between NetworkMonitor and FhirSyncWorker.
 */
@Singleton
class SyncManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val networkMonitor: NetworkMonitor
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var isInitialized = false

    /**
     * Initialize the sync manager.
     * Should be called from Application onCreate.
     */
    fun initialize() {
        if (isInitialized) return
        isInitialized = true

        // Schedule periodic sync
        FhirSyncWorker.schedulePeriodicSync(context)

        // Observe WiFi connectivity and trigger sync
        observeWifiConnectivity()
    }

    /**
     * Trigger an immediate sync.
     */
    fun triggerSync() {
        if (networkMonitor.isCurrentlyOnWifi()) {
            FhirSyncWorker.enqueueWifiSync(context)
        } else if (networkMonitor.isConnected()) {
            FhirSyncWorker.enqueueOneTimeSync(context)
        }
    }

    /**
     * Trigger sync only on WiFi.
     */
    fun triggerWifiSync() {
        FhirSyncWorker.enqueueWifiSync(context)
    }

    private fun observeWifiConnectivity() {
        scope.launch {
            networkMonitor.wifiAvailable.collectLatest { isWifiAvailable ->
                if (isWifiAvailable) {
                    // WiFi became available - trigger sync
                    FhirSyncWorker.enqueueWifiSync(context)
                }
            }
        }
    }
}

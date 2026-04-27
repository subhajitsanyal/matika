package com.carelog.discovery

import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import com.carelog.core.config.AppSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Discovers the CareLog Mac Mini on the local network using mDNS (NSD).
 *
 * Listens for `_carelog._tcp` services and exposes the discovered
 * base URL as a StateFlow. Handles service found, resolved, and lost
 * events, with automatic retry on service loss.
 */
@Singleton
class MacMiniDiscovery @Inject constructor(
    private val nsdManager: NsdManager,
    private val appSettings: AppSettings
) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _macMiniUrl = MutableStateFlow<String?>(null)
    /** The discovered Mac Mini base URL (e.g., "http://192.168.1.50:8000"), or null. */
    val macMiniUrl: StateFlow<String?> = _macMiniUrl.asStateFlow()

    private val _discoveryState = MutableStateFlow(DiscoveryState.IDLE)
    val discoveryState: StateFlow<DiscoveryState> = _discoveryState.asStateFlow()

    /** Version and device info parsed from mDNS TXT records. */
    private val _deviceInfo = MutableStateFlow<MacMiniDeviceInfo?>(null)
    val deviceInfo: StateFlow<MacMiniDeviceInfo?> = _deviceInfo.asStateFlow()

    @Volatile
    private var isDiscovering = false

    private var discoveryListener: NsdManager.DiscoveryListener? = null

    companion object {
        private const val TAG = "MacMiniDiscovery"
        private const val SERVICE_TYPE = "_carelog._tcp."
        private const val RETRY_DELAY_MS = 5000L
        private const val FALLBACK_DELAY_MS = 6000L
        private const val FALLBACK_URL = "http://10.0.0.200:8000"
    }

    /**
     * Start mDNS service discovery. Safe to call multiple times;
     * will not restart if already discovering.
     */
    fun startDiscovery() {
        if (isDiscovering) {
            Log.d(TAG, "Discovery already active, skipping start")
            return
        }

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                Log.i(TAG, "mDNS discovery started for $serviceType")
                isDiscovering = true
                _discoveryState.value = DiscoveryState.DISCOVERING
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                Log.i(TAG, "Service found: ${serviceInfo.serviceName}")
                resolveService(serviceInfo)
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                Log.w(TAG, "Service lost: ${serviceInfo.serviceName}")
                _macMiniUrl.value = null
                _deviceInfo.value = null
                _discoveryState.value = DiscoveryState.LOST
                scope.launch {
                    appSettings.setMacMiniBaseUrl(null)
                }
                scheduleRetry()
            }

            override fun onDiscoveryStopped(serviceType: String) {
                Log.i(TAG, "mDNS discovery stopped")
                isDiscovering = false
                _discoveryState.value = DiscoveryState.IDLE
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Discovery start failed: errorCode=$errorCode")
                isDiscovering = false
                _discoveryState.value = DiscoveryState.ERROR
                scheduleRetry()
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Discovery stop failed: errorCode=$errorCode")
                isDiscovering = false
            }
        }

        discoveryListener = listener

        try {
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start NSD discovery", e)
            _discoveryState.value = DiscoveryState.ERROR
            scheduleRetry()
        }

        // If mDNS doesn't resolve quickly, try the fallback IP
        scheduleFallback()
    }

    private fun scheduleFallback() {
        scope.launch {
            delay(FALLBACK_DELAY_MS)
            if (_macMiniUrl.value == null) {
                Log.i(TAG, "mDNS not resolved, trying fallback: $FALLBACK_URL")
                try {
                    val url = java.net.URL("$FALLBACK_URL/health")
                    val conn = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        (url.openConnection() as java.net.HttpURLConnection).apply {
                            connectTimeout = 3000
                            readTimeout = 3000
                            requestMethod = "GET"
                        }
                    }
                    if (conn.responseCode == 200) {
                        Log.i(TAG, "Fallback URL reachable, using $FALLBACK_URL")
                        _macMiniUrl.value = FALLBACK_URL
                        _discoveryState.value = DiscoveryState.RESOLVED
                        appSettings.setMacMiniBaseUrl(FALLBACK_URL)
                    }
                    conn.disconnect()
                } catch (e: Exception) {
                    Log.w(TAG, "Fallback URL not reachable: ${e.message}")
                }
            }
        }
    }

    /**
     * Stop mDNS service discovery and clean up.
     */
    fun stopDiscovery() {
        if (!isDiscovering) return
        try {
            discoveryListener?.let { nsdManager.stopServiceDiscovery(it) }
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping discovery", e)
        }
        isDiscovering = false
        discoveryListener = null
        _discoveryState.value = DiscoveryState.IDLE
    }

    @Suppress("DEPRECATION")
    private fun resolveService(serviceInfo: NsdServiceInfo) {
        nsdManager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Service resolve failed: errorCode=$errorCode")
            }

            override fun onServiceResolved(resolvedInfo: NsdServiceInfo) {
                val host = resolvedInfo.host?.hostAddress
                val port = resolvedInfo.port
                if (host != null) {
                    val baseUrl = "http://$host:$port"
                    Log.i(TAG, "Mac Mini resolved: $baseUrl")
                    _macMiniUrl.value = baseUrl
                    _discoveryState.value = DiscoveryState.RESOLVED

                    // Parse TXT records for version and device info
                    val txtRecords = parseTxtRecords(resolvedInfo)
                    _deviceInfo.value = MacMiniDeviceInfo(
                        host = host,
                        port = port,
                        version = txtRecords["version"],
                        deviceName = txtRecords["device"] ?: resolvedInfo.serviceName
                    )

                    scope.launch {
                        appSettings.setMacMiniBaseUrl(baseUrl)
                    }
                } else {
                    Log.w(TAG, "Resolved service but host is null")
                }
            }
        })
    }

    private fun parseTxtRecords(serviceInfo: NsdServiceInfo): Map<String, String> {
        val records = mutableMapOf<String, String>()
        try {
            val attributes = serviceInfo.attributes
            for ((key, value) in attributes) {
                records[key] = value?.let { String(it, Charsets.UTF_8) } ?: ""
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse TXT records", e)
        }
        return records
    }

    private fun scheduleRetry() {
        scope.launch {
            delay(RETRY_DELAY_MS)
            if (!isDiscovering && _discoveryState.value != DiscoveryState.RESOLVED) {
                Log.i(TAG, "Retrying mDNS discovery")
                startDiscovery()
            }
        }
    }
}

/**
 * State of mDNS service discovery.
 */
enum class DiscoveryState {
    IDLE,
    DISCOVERING,
    RESOLVED,
    LOST,
    ERROR
}

/**
 * Device information parsed from the Mac Mini mDNS TXT records.
 */
data class MacMiniDeviceInfo(
    val host: String,
    val port: Int,
    val version: String?,
    val deviceName: String
)

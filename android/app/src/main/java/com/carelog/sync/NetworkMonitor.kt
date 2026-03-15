package com.carelog.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Network connectivity monitor.
 *
 * Detects WiFi connectivity changes and emits connectivity state via Flow.
 * Respects user's data saver settings.
 */
@Singleton
class NetworkMonitor @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val connectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    /**
     * Current network status.
     */
    val networkStatus: Flow<NetworkStatus> = callbackFlow {
        val networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                val status = getNetworkStatus(network)
                trySend(status)
            }

            override fun onLost(network: Network) {
                trySend(NetworkStatus.Disconnected)
            }

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities
            ) {
                val status = getNetworkStatus(networkCapabilities)
                trySend(status)
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        connectivityManager.registerNetworkCallback(request, networkCallback)

        // Emit initial state
        val initialStatus = getCurrentNetworkStatus()
        trySend(initialStatus)

        awaitClose {
            connectivityManager.unregisterNetworkCallback(networkCallback)
        }
    }.distinctUntilChanged()

    /**
     * Flow that emits true when WiFi becomes available.
     */
    val wifiAvailable: Flow<Boolean> = callbackFlow {
        val networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (isWifi(network)) {
                    trySend(true)
                }
            }

            override fun onLost(network: Network) {
                trySend(false)
            }

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities
            ) {
                val hasWifi = networkCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                trySend(hasWifi)
            }
        }

        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        connectivityManager.registerNetworkCallback(request, networkCallback)

        // Emit initial state
        trySend(isCurrentlyOnWifi())

        awaitClose {
            connectivityManager.unregisterNetworkCallback(networkCallback)
        }
    }.distinctUntilChanged()

    /**
     * Check if currently connected to any network.
     */
    fun isConnected(): Boolean {
        val activeNetwork = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(activeNetwork) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /**
     * Check if currently connected to WiFi.
     */
    fun isCurrentlyOnWifi(): Boolean {
        val activeNetwork = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(activeNetwork) ?: return false
        return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    /**
     * Check if data saver is enabled.
     */
    fun isDataSaverEnabled(): Boolean {
        return connectivityManager.restrictBackgroundStatus ==
                ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
    }

    private fun isWifi(network: Network): Boolean {
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    private fun getNetworkStatus(network: Network): NetworkStatus {
        val capabilities = connectivityManager.getNetworkCapabilities(network)
            ?: return NetworkStatus.Disconnected
        return getNetworkStatus(capabilities)
    }

    private fun getNetworkStatus(capabilities: NetworkCapabilities): NetworkStatus {
        val hasInternet = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        if (!hasInternet) return NetworkStatus.Disconnected

        return when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkStatus.WiFi
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetworkStatus.Cellular
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NetworkStatus.Ethernet
            else -> NetworkStatus.Other
        }
    }

    private fun getCurrentNetworkStatus(): NetworkStatus {
        val activeNetwork = connectivityManager.activeNetwork ?: return NetworkStatus.Disconnected
        val capabilities = connectivityManager.getNetworkCapabilities(activeNetwork)
            ?: return NetworkStatus.Disconnected
        return getNetworkStatus(capabilities)
    }
}

/**
 * Network connection status.
 */
sealed class NetworkStatus {
    data object WiFi : NetworkStatus()
    data object Cellular : NetworkStatus()
    data object Ethernet : NetworkStatus()
    data object Other : NetworkStatus()
    data object Disconnected : NetworkStatus()

    val isConnected: Boolean
        get() = this !is Disconnected

    val isUnmetered: Boolean
        get() = this is WiFi || this is Ethernet
}

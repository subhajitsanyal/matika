package com.carelog.ui.sync

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.fhir.repository.LocalFhirRepository
import com.carelog.sync.NetworkMonitor
import com.carelog.sync.NetworkStatus
import com.carelog.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import javax.inject.Inject

/**
 * ViewModel for sync status indicator.
 */
@HiltViewModel
class SyncStatusViewModel @Inject constructor(
    private val localFhirRepository: LocalFhirRepository,
    private val networkMonitor: NetworkMonitor,
    private val syncManager: SyncManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(SyncStatusUiState())
    val uiState: StateFlow<SyncStatusUiState> = _uiState.asStateFlow()

    init {
        observeNetworkStatus()
        observePendingCounts()
        observeLastSyncTime()
    }

    private fun observeNetworkStatus() {
        viewModelScope.launch {
            networkMonitor.networkStatus.collect { status ->
                _uiState.update {
                    it.copy(
                        isConnected = status.isConnected,
                        isWifi = status is NetworkStatus.WiFi,
                        status = calculateSyncState(
                            isConnected = status.isConnected,
                            pendingCount = it.pendingCount,
                            failedCount = it.failedCount,
                            isSyncing = it.isSyncing
                        )
                    )
                }
            }
        }
    }

    private fun observePendingCounts() {
        viewModelScope.launch {
            combine(
                localFhirRepository.getPendingObservationCount(),
                localFhirRepository.getPendingDocumentCount(),
                localFhirRepository.getFailedObservationCount(),
                localFhirRepository.getFailedDocumentCount()
            ) { pendingObs: Int, pendingDocs: Int, failedObs: Int, failedDocs: Int ->
                PendingCounts(
                    observations = pendingObs,
                    documents = pendingDocs,
                    failedObservations = failedObs,
                    failedDocuments = failedDocs
                )
            }.collect { counts ->
                _uiState.update {
                    it.copy(
                        pendingObservations = counts.observations,
                        pendingDocuments = counts.documents,
                        pendingCount = counts.observations + counts.documents,
                        failedCount = counts.failedObservations + counts.failedDocuments,
                        status = calculateSyncState(
                            isConnected = it.isConnected,
                            pendingCount = counts.observations + counts.documents,
                            failedCount = counts.failedObservations + counts.failedDocuments,
                            isSyncing = it.isSyncing
                        )
                    )
                }
            }
        }
    }

    private fun observeLastSyncTime() {
        viewModelScope.launch {
            localFhirRepository.getLastSyncTime().collect { timestamp: Long? ->
                _uiState.update { state ->
                    state.copy(lastSyncTime = timestamp?.let { ts -> formatTimestamp(ts) })
                }
            }
        }
    }

    private fun calculateSyncState(
        isConnected: Boolean,
        pendingCount: Int,
        failedCount: Int,
        isSyncing: Boolean
    ): SyncState {
        return when {
            !isConnected -> SyncState.OFFLINE
            isSyncing -> SyncState.SYNCING
            failedCount > 0 -> SyncState.ERROR
            pendingCount > 0 -> SyncState.PENDING
            else -> SyncState.SYNCED
        }
    }

    private fun formatTimestamp(timestamp: Long): String {
        val instant = Instant.ofEpochMilli(timestamp)
        val localDateTime = instant.atZone(ZoneId.systemDefault()).toLocalDateTime()
        val formatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT)
        return localDateTime.format(formatter)
    }

    fun triggerManualSync() {
        viewModelScope.launch {
            _uiState.update { it.copy(isSyncing = true) }
            syncManager.triggerSync()
            // The sync worker will update the state when complete
            // For now, just reset after a delay
            kotlinx.coroutines.delay(2000)
            _uiState.update { it.copy(isSyncing = false) }
        }
    }
}

/**
 * UI state for sync status.
 */
data class SyncStatusUiState(
    val status: SyncState = SyncState.SYNCED,
    val pendingCount: Int = 0,
    val pendingObservations: Int = 0,
    val pendingDocuments: Int = 0,
    val failedCount: Int = 0,
    val isConnected: Boolean = true,
    val isWifi: Boolean = false,
    val isSyncing: Boolean = false,
    val lastSyncTime: String? = null
)

private data class PendingCounts(
    val observations: Int,
    val documents: Int,
    val failedObservations: Int,
    val failedDocuments: Int
)

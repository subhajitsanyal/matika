package com.carelog.dashboard

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.discovery.HealthCheckService
import com.carelog.discovery.ModelHealthStatus
import com.carelog.network.AlertItem
import com.carelog.network.CloudApiService
import com.carelog.network.PatientListItem
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * UI state for the caregiver dashboard.
 */
data class CaregiverDashboardUiState(
    val patients: List<PatientListItem> = emptyList(),
    val alerts: List<AlertItem> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val errorMessage: String? = null,
    val expandedPatientId: String? = null
)

/**
 * ViewModel for the caregiver home/dashboard screen.
 *
 * Fetches linked patients list and their alerts from the cloud API.
 * Supports pull-to-refresh.
 */
@HiltViewModel
class CaregiverDashboardViewModel @Inject constructor(
    private val cloudApiService: CloudApiService,
    private val healthCheckService: HealthCheckService
) : ViewModel() {

    companion object {
        private const val TAG = "CaregiverDashboardVM"
    }

    private val _uiState = MutableStateFlow(CaregiverDashboardUiState())
    val uiState: StateFlow<CaregiverDashboardUiState> = _uiState.asStateFlow()

    val healthStatus: StateFlow<ModelHealthStatus> = healthCheckService.healthStatus
        .stateIn(viewModelScope, SharingStarted.Eagerly, ModelHealthStatus.OFFLINE)

    init {
        loadData()
    }

    /**
     * Initial data load.
     */
    fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }

            try {
                val patientsResponse = cloudApiService.getPatients()
                val patients = patientsResponse.patients

                // Fetch alerts for all patients
                val allAlerts = mutableListOf<AlertItem>()
                for (patient in patients) {
                    try {
                        val alertsResponse = cloudApiService.getAlerts(patient.patient_id)
                        allAlerts.addAll(alertsResponse.alerts)
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to fetch alerts for patient ${patient.patient_id}", e)
                    }
                }

                _uiState.update {
                    it.copy(
                        patients = patients,
                        alerts = allAlerts.sortedByDescending { alert -> alert.timestamp },
                        isLoading = false
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load dashboard data", e)
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = "Failed to load data. Pull to refresh."
                    )
                }
            }
        }
    }

    /**
     * Silent refresh — re-fetches patients + alerts without flipping the
     * pull-to-refresh spinner. Called from [CaregiverHomeScreen] when a
     * child screen (Add-Patient form OR voice onboarding) signals via
     * the `patient_added` SavedStateHandle key that the patient list
     * went stale.
     */
    fun refresh() {
        loadData()
    }

    /**
     * Pull-to-refresh handler.
     */
    fun onRefresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true, errorMessage = null) }

            try {
                val patientsResponse = cloudApiService.getPatients()
                val patients = patientsResponse.patients

                val allAlerts = mutableListOf<AlertItem>()
                for (patient in patients) {
                    try {
                        val alertsResponse = cloudApiService.getAlerts(patient.patient_id)
                        allAlerts.addAll(alertsResponse.alerts)
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to fetch alerts for patient ${patient.patient_id}", e)
                    }
                }

                _uiState.update {
                    it.copy(
                        patients = patients,
                        alerts = allAlerts.sortedByDescending { alert -> alert.timestamp },
                        isRefreshing = false
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Refresh failed", e)
                _uiState.update {
                    it.copy(
                        isRefreshing = false,
                        errorMessage = "Refresh failed. Please try again."
                    )
                }
            }
        }
    }

    /**
     * Toggle patient card expansion.
     */
    fun togglePatientExpanded(patientId: String) {
        _uiState.update {
            it.copy(
                expandedPatientId = if (it.expandedPatientId == patientId) null else patientId
            )
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }
}

package com.carelog.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.auth.AuthRepository
import com.carelog.fhir.client.ObservationType
import com.carelog.fhir.repository.LocalFhirRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for patient dashboard.
 */
@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val localFhirRepository: LocalFhirRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    init {
        loadDashboardData()
        observePendingSyncCount()
    }

    private fun loadDashboardData() {
        viewModelScope.launch {
            // Load patient info
            val user = authRepository.getCurrentUser()
            _uiState.update { it.copy(patientName = user?.name) }

            // Load last values for each vital type
            user?.linkedPatientId?.let { patientId ->
                loadLastValues(patientId)
            }
        }
    }

    private suspend fun loadLastValues(patientId: String) {
        val lastValues = mutableMapOf<VitalType, String>()

        // Blood Pressure
        localFhirRepository.getLatestObservation(patientId, ObservationType.BLOOD_PRESSURE)?.let { obs ->
            obs.components?.let { components ->
                val systolic = components.find { it.type == ObservationType.SYSTOLIC_BP }?.value?.toInt()
                val diastolic = components.find { it.type == ObservationType.DIASTOLIC_BP }?.value?.toInt()
                if (systolic != null && diastolic != null) {
                    lastValues[VitalType.BLOOD_PRESSURE] = "$systolic/$diastolic mmHg"
                }
            }
        }

        // Glucose
        localFhirRepository.getLatestObservation(patientId, ObservationType.BLOOD_GLUCOSE)?.let { obs ->
            obs.value?.let { value ->
                lastValues[VitalType.GLUCOSE] = "${value.toInt()} mg/dL"
            }
        }

        // Temperature
        localFhirRepository.getLatestObservation(patientId, ObservationType.BODY_TEMPERATURE)?.let { obs ->
            obs.value?.let { value ->
                lastValues[VitalType.TEMPERATURE] = String.format("%.1f°F", value)
            }
        }

        // Weight
        localFhirRepository.getLatestObservation(patientId, ObservationType.BODY_WEIGHT)?.let { obs ->
            obs.value?.let { value ->
                lastValues[VitalType.WEIGHT] = String.format("%.1f kg", value)
            }
        }

        // Pulse
        localFhirRepository.getLatestObservation(patientId, ObservationType.HEART_RATE)?.let { obs ->
            obs.value?.let { value ->
                lastValues[VitalType.PULSE] = "${value.toInt()} bpm"
            }
        }

        // SpO2
        localFhirRepository.getLatestObservation(patientId, ObservationType.OXYGEN_SATURATION)?.let { obs ->
            obs.value?.let { value ->
                lastValues[VitalType.SPO2] = "${value.toInt()}%"
            }
        }

        _uiState.update { it.copy(lastValues = lastValues) }
    }

    private fun observePendingSyncCount() {
        viewModelScope.launch {
            localFhirRepository.getPendingObservationCount()
                .combine(localFhirRepository.getPendingDocumentCount()) { obsCount, docCount ->
                    obsCount + docCount
                }
                .collect { count ->
                    _uiState.update { it.copy(pendingSyncCount = count) }
                }
        }
    }

    fun dismissReminder() {
        _uiState.update { it.copy(missedReminder = null) }
    }

    fun setMissedReminder(vitalType: VitalType) {
        _uiState.update { it.copy(missedReminder = vitalType) }
    }

    fun refreshData() {
        loadDashboardData()
    }
}

/**
 * UI state for dashboard.
 */
data class DashboardUiState(
    val patientName: String? = null,
    val lastValues: Map<VitalType, String> = emptyMap(),
    val pendingSyncCount: Int = 0,
    val missedReminder: VitalType? = null,
    val isLoading: Boolean = false
)

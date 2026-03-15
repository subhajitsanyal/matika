package com.carelog.ui.history

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.auth.AuthRepository
import com.carelog.fhir.client.ObservationType
import com.carelog.fhir.local.entities.SyncStatus
import com.carelog.fhir.repository.LocalFhirRepository
import com.carelog.ui.dashboard.VitalType
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject

/**
 * ViewModel for history screen.
 */
@HiltViewModel
class HistoryViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val localFhirRepository: LocalFhirRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(HistoryUiState())
    val uiState: StateFlow<HistoryUiState> = _uiState.asStateFlow()

    init {
        loadHistory()
    }

    fun selectVitalType(type: VitalType?) {
        _uiState.update { it.copy(selectedVitalType = type) }
        loadHistory()
    }

    fun toggleDateFilter() {
        _uiState.update { it.copy(showDateFilter = !it.showDateFilter) }
    }

    fun setStartDate(date: LocalDate) {
        _uiState.update { it.copy(startDate = date) }
        loadHistory()
    }

    fun setEndDate(date: LocalDate) {
        _uiState.update { it.copy(endDate = date) }
        loadHistory()
    }

    fun clearDateFilter() {
        _uiState.update { it.copy(startDate = null, endDate = null) }
        loadHistory()
    }

    private fun loadHistory() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            try {
                val user = authRepository.getCurrentUser()
                val patientId = user?.linkedPatientId

                if (patientId == null) {
                    _uiState.update { it.copy(isLoading = false, entries = emptyList()) }
                    return@launch
                }

                val state = _uiState.value

                // Get observations based on filter
                val observationType = state.selectedVitalType?.toObservationType()
                val observationsFlow = if (observationType != null) {
                    localFhirRepository.getObservationsByType(patientId, observationType)
                } else {
                    localFhirRepository.getObservationsForPatient(patientId)
                }

                // Collect the first emission from the flow
                val observations = observationsFlow.first()

                // Filter by date range if set
                val filteredObservations = observations.filter { obs: com.carelog.fhir.models.FhirObservation ->
                    val obsDate = Instant.parse(obs.effectiveDateTime)
                        .atZone(ZoneId.systemDefault())
                        .toLocalDate()

                    val afterStart = state.startDate?.let { obsDate >= it } ?: true
                    val beforeEnd = state.endDate?.let { obsDate <= it } ?: true

                    afterStart && beforeEnd
                }

                // Convert to history entries
                val entries = filteredObservations.map { obs: com.carelog.fhir.models.FhirObservation ->
                    HistoryEntry(
                        id = obs.id ?: "",
                        vitalType = obs.type.toVitalType(),
                        displayValue = formatDisplayValue(obs.type, obs.value, obs.unit, obs.components),
                        timestamp = Instant.parse(obs.effectiveDateTime),
                        performerName = null,
                        syncStatus = SyncStatus.SYNCED
                    )
                }.sortedByDescending { it.timestamp }

                _uiState.update { it.copy(isLoading = false, entries = entries) }

            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, entries = emptyList()) }
            }
        }
    }

    private fun formatDisplayValue(
        type: ObservationType,
        value: Double?,
        unit: String?,
        components: List<com.carelog.fhir.models.ObservationComponent>?
    ): String {
        return when (type) {
            ObservationType.BLOOD_PRESSURE -> {
                val systolic = components?.find { it.type == ObservationType.SYSTOLIC_BP }?.value?.toInt()
                val diastolic = components?.find { it.type == ObservationType.DIASTOLIC_BP }?.value?.toInt()
                if (systolic != null && diastolic != null) {
                    "$systolic/$diastolic mmHg"
                } else {
                    "-- mmHg"
                }
            }
            ObservationType.BLOOD_GLUCOSE -> "${value?.toInt() ?: "--"} mg/dL"
            ObservationType.BODY_TEMPERATURE -> {
                val fahrenheit = value?.let { it * 9 / 5 + 32 }
                String.format("%.1f°F", fahrenheit ?: 0.0)
            }
            ObservationType.BODY_WEIGHT -> String.format("%.1f kg", value ?: 0.0)
            ObservationType.HEART_RATE -> "${value?.toInt() ?: "--"} bpm"
            ObservationType.OXYGEN_SATURATION -> "${value?.toInt() ?: "--"}%"
            else -> "${value ?: "--"} ${unit ?: ""}"
        }
    }
}

/**
 * Extension to convert VitalType to ObservationType.
 */
private fun VitalType.toObservationType(): ObservationType? {
    return when (this) {
        VitalType.BLOOD_PRESSURE -> ObservationType.BLOOD_PRESSURE
        VitalType.GLUCOSE -> ObservationType.BLOOD_GLUCOSE
        VitalType.TEMPERATURE -> ObservationType.BODY_TEMPERATURE
        VitalType.WEIGHT -> ObservationType.BODY_WEIGHT
        VitalType.PULSE -> ObservationType.HEART_RATE
        VitalType.SPO2 -> ObservationType.OXYGEN_SATURATION
        else -> null
    }
}

/**
 * Extension to convert ObservationType to VitalType.
 */
private fun ObservationType.toVitalType(): VitalType {
    return when (this) {
        ObservationType.BLOOD_PRESSURE -> VitalType.BLOOD_PRESSURE
        ObservationType.SYSTOLIC_BP -> VitalType.BLOOD_PRESSURE
        ObservationType.DIASTOLIC_BP -> VitalType.BLOOD_PRESSURE
        ObservationType.BLOOD_GLUCOSE -> VitalType.GLUCOSE
        ObservationType.BODY_TEMPERATURE -> VitalType.TEMPERATURE
        ObservationType.BODY_WEIGHT -> VitalType.WEIGHT
        ObservationType.HEART_RATE -> VitalType.PULSE
        ObservationType.OXYGEN_SATURATION -> VitalType.SPO2
    }
}

/**
 * UI state for history screen.
 */
data class HistoryUiState(
    val entries: List<HistoryEntry> = emptyList(),
    val selectedVitalType: VitalType? = null,
    val showDateFilter: Boolean = false,
    val startDate: LocalDate? = null,
    val endDate: LocalDate? = null,
    val isLoading: Boolean = false
)

/**
 * Single history entry model.
 */
data class HistoryEntry(
    val id: String,
    val vitalType: VitalType,
    val displayValue: String,
    val timestamp: Instant,
    val performerName: String?,
    val syncStatus: SyncStatus
)

package com.carelog.ui.relative

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.api.*
import com.carelog.auth.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.inject.Inject

/**
 * ViewModel for the Trends screen.
 */
@HiltViewModel
class TrendsViewModel @Inject constructor(
    private val apiService: RelativeApiService,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(TrendsUiState())
    val uiState: StateFlow<TrendsUiState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    fun setDateRange(range: DateRange) {
        _uiState.update { it.copy(selectedDateRange = range) }
        loadData()
    }

    fun setVitalType(type: VitalType) {
        _uiState.update { it.copy(selectedVitalType = type) }
        loadData()
    }

    private fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            try {
                val patientId = authRepository.fetchLinkedPatientId()
                    ?: throw Exception("No patient linked to this account")

                val endDate = Instant.now()
                val startDate = endDate.minus(
                    _uiState.value.selectedDateRange.days.toLong(),
                    ChronoUnit.DAYS
                )

                // Fetch observations
                val observations = apiService.getObservations(
                    patientId = patientId,
                    vitalType = _uiState.value.selectedVitalType,
                    startDate = startDate,
                    endDate = endDate
                )

                // F26 — fetch threshold from v2 parameter_configs (the
                // table that drives evaluate-thresholds-batch). Map the
                // selected VitalType enum to the matching parameter_name.
                // BP gets the SYSTOLIC threshold for the chart line —
                // diastolic is logged separately and the trend chart
                // only renders one breach band per view.
                val threshold = try {
                    val thresholds = apiService.getParameterThresholds(patientId)
                    val targetParameter = vitalTypeToParameterName(_uiState.value.selectedVitalType)
                    thresholds.find { it.parameterName == targetParameter }
                        ?.let { pt ->
                            // Adapt to the legacy VitalThreshold shape the chart consumes.
                            com.carelog.api.VitalThreshold(
                                vitalType = _uiState.value.selectedVitalType,
                                minValue = pt.minValue,
                                maxValue = pt.maxValue,
                                unit = pt.unit,
                                setByDoctor = pt.setByDoctor,
                                doctorName = null,
                            )
                        }
                } catch (e: Exception) {
                    null // Thresholds are optional for the chart
                }

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        observations = observations.sortedBy { obs -> obs.timestamp },
                        threshold = threshold
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isLoading = false, error = e.message)
                }
            }
        }
    }
}

// F26 — map Android's VitalType enum to the schema's vital_type enum
// strings. BP picks systolic by convention (diastolic threshold is
// rendered as a second band only in screens that explicitly request it).
private fun vitalTypeToParameterName(vitalType: com.carelog.api.VitalType): String =
    when (vitalType) {
        com.carelog.api.VitalType.BLOOD_PRESSURE -> "blood_pressure_systolic"
        com.carelog.api.VitalType.GLUCOSE -> "glucose"
        com.carelog.api.VitalType.TEMPERATURE -> "temperature"
        com.carelog.api.VitalType.WEIGHT -> "weight"
        com.carelog.api.VitalType.PULSE -> "pulse"
        com.carelog.api.VitalType.SPO2 -> "spo2"
    }

/**
 * UI state for the Trends screen.
 */
data class TrendsUiState(
    val isLoading: Boolean = false,
    val selectedDateRange: DateRange = DateRange.WEEK,
    val selectedVitalType: VitalType = VitalType.BLOOD_PRESSURE,
    val observations: List<VitalObservation> = emptyList(),
    val threshold: VitalThreshold? = null,
    val error: String? = null
)

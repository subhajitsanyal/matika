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

                // Fetch threshold for the selected vital (non-blocking — don't fail if thresholds API is unavailable)
                val threshold = try {
                    val thresholds = apiService.getThresholds(patientId)
                    thresholds.find { it.vitalType == _uiState.value.selectedVitalType }
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

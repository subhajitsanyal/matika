package com.carelog.ui.relative

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.api.PatientSummary
import com.carelog.api.RelativeApiService
import com.carelog.auth.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the Relative Dashboard.
 */
@HiltViewModel
class RelativeDashboardViewModel @Inject constructor(
    private val apiService: RelativeApiService,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(RelativeDashboardUiState())
    val uiState: StateFlow<RelativeDashboardUiState> = _uiState.asStateFlow()

    init {
        loadPatientSummary()
    }

    fun refresh() {
        loadPatientSummary()
    }

    private fun loadPatientSummary() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                val user = authRepository.currentUser.value
                val patientId = user?.linkedPatientId

                if (patientId == null) {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = "No patient linked to this account"
                        )
                    }
                    return@launch
                }

                val summary = apiService.getPatientSummary(patientId)

                if (summary != null) {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            patientSummary = summary,
                            error = null
                        )
                    }
                } else {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = "Failed to load patient data"
                        )
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = e.message ?: "An error occurred"
                    )
                }
            }
        }
    }
}

/**
 * UI state for the Relative Dashboard.
 */
data class RelativeDashboardUiState(
    val isLoading: Boolean = false,
    val patientSummary: PatientSummary? = null,
    val error: String? = null
)

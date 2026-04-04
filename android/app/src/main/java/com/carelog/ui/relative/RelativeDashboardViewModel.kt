package com.carelog.ui.relative

import android.util.Log
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
                // Fetch linked patient ID directly from Cognito (not from cache)
                val patientId = authRepository.fetchLinkedPatientId()
                // Also check currentUser for comparison
                val cachedUser = authRepository.currentUser.value
                val debugInfo = "fetchLinkedPatientId=$patientId, cachedUser.linked=${cachedUser?.linkedPatientId}, cachedUser.email=${cachedUser?.email}"
                Log.d("RelativeDashboard", debugInfo)

                if (patientId == null) {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            noPatientRegistered = true
                        )
                    }
                    return@launch
                }

                val summary = apiService.getPatientSummary(patientId)
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        patientSummary = summary,
                        error = null
                    )
                }
            } catch (e: Exception) {
                Log.e("RelativeDashboard", "Error loading patient summary", e)
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = "Exception: ${e.javaClass.simpleName}: ${e.message}"
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
    val noPatientRegistered: Boolean = false,
    val error: String? = null
)

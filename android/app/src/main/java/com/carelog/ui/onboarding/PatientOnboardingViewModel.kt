package com.carelog.ui.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.auth.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for patient onboarding screen.
 */
@HiltViewModel
class PatientOnboardingViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val patientRepository: PatientRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<PatientOnboardingUiState>(PatientOnboardingUiState.Idle)
    val uiState: StateFlow<PatientOnboardingUiState> = _uiState.asStateFlow()

    /**
     * Create a new patient account.
     */
    fun createPatient(
        name: String,
        dateOfBirth: String?,
        gender: String?,
        bloodType: String?,
        medicalConditions: List<String>,
        allergies: List<String>,
        medications: List<String>,
        emergencyContactName: String?,
        emergencyContactPhone: String?
    ) {
        viewModelScope.launch {
            _uiState.value = PatientOnboardingUiState.Loading

            try {
                // Get current user's access token
                val token = authRepository.getAccessToken()
                    ?: throw Exception("Not authenticated")

                // Create patient via API
                val patientId = patientRepository.createPatient(
                    token = token,
                    request = CreatePatientRequest(
                        name = name,
                        dateOfBirth = dateOfBirth,
                        gender = gender,
                        bloodType = bloodType,
                        medicalConditions = medicalConditions,
                        allergies = allergies,
                        medications = medications,
                        emergencyContactName = emergencyContactName,
                        emergencyContactPhone = emergencyContactPhone
                    )
                )

                _uiState.value = PatientOnboardingUiState.Success(patientId)
            } catch (e: Exception) {
                _uiState.value = PatientOnboardingUiState.Error(
                    e.message ?: "Failed to create patient"
                )
            }
        }
    }
}

/**
 * Request model for patient creation.
 */
data class CreatePatientRequest(
    val name: String,
    val dateOfBirth: String?,
    val gender: String?,
    val bloodType: String?,
    val medicalConditions: List<String>,
    val allergies: List<String>,
    val medications: List<String>,
    val emergencyContactName: String?,
    val emergencyContactPhone: String?
)

/**
 * Repository for patient operations.
 */
interface PatientRepository {
    suspend fun createPatient(token: String, request: CreatePatientRequest): String
}

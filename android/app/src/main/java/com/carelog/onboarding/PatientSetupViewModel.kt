package com.carelog.onboarding

import android.util.Log
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.auth.AuthRepository
import com.carelog.network.CloudApiService
import com.carelog.network.CreatePatientRequest
import com.carelog.network.EmergencyContact
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the patient profile confirmation screen.
 *
 * Receives the extracted profile from the onboarding conversation,
 * allows manual edits, and submits to the cloud API to create the
 * patient account.
 */
@HiltViewModel
class PatientSetupViewModel @Inject constructor(
    private val cloudApiService: CloudApiService,
    private val authRepository: AuthRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    companion object {
        private const val TAG = "PatientSetupVM"
    }

    private val _uiState = MutableStateFlow(PatientSetupUiState())
    val uiState: StateFlow<PatientSetupUiState> = _uiState.asStateFlow()

    /**
     * Initialize with the extracted profile from the onboarding conversation.
     */
    fun setProfile(profile: ExtractedPatientProfile) {
        _uiState.update { it.copy(profile = profile) }
    }

    /**
     * Update a field in the profile.
     */
    fun updateName(name: String) {
        _uiState.update { it.copy(profile = it.profile.copy(name = name)) }
    }

    fun updateAge(age: Int?) {
        _uiState.update { it.copy(profile = it.profile.copy(age = age)) }
    }

    fun updateDateOfBirth(dob: String?) {
        _uiState.update { it.copy(profile = it.profile.copy(dateOfBirth = dob)) }
    }

    fun updateGender(gender: String?) {
        _uiState.update { it.copy(profile = it.profile.copy(gender = gender)) }
    }

    fun updateConditions(conditions: List<String>) {
        _uiState.update { it.copy(profile = it.profile.copy(conditions = conditions)) }
    }

    fun updateMedications(medications: List<String>) {
        _uiState.update { it.copy(profile = it.profile.copy(medications = medications)) }
    }

    fun updateAllergies(allergies: List<String>) {
        _uiState.update { it.copy(profile = it.profile.copy(allergies = allergies)) }
    }

    fun updateEmergencyContactName(name: String) {
        _uiState.update { it.copy(profile = it.profile.copy(emergencyContactName = name)) }
    }

    fun updateEmergencyContactPhone(phone: String) {
        _uiState.update { it.copy(profile = it.profile.copy(emergencyContactPhone = phone)) }
    }

    fun updatePrimaryDoctor(doctor: String?) {
        _uiState.update { it.copy(profile = it.profile.copy(primaryDoctor = doctor)) }
    }

    /**
     * Confirm and create the patient account.
     */
    fun confirmAndCreatePatient() {
        val profile = _uiState.value.profile
        if (profile.name.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Patient name is required.") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, errorMessage = null) }

            try {
                val emergencyContact = if (!profile.emergencyContactName.isNullOrBlank()) {
                    EmergencyContact(
                        name = profile.emergencyContactName,
                        phone = profile.emergencyContactPhone ?: "",
                        relationship = profile.emergencyContactRelationship
                    )
                } else null

                val response = cloudApiService.createPatient(
                    CreatePatientRequest(
                        name = profile.name,
                        age = profile.age,
                        date_of_birth = profile.dateOfBirth,
                        gender = profile.gender,
                        conditions = profile.conditions,
                        medications = profile.medications,
                        allergies = profile.allergies,
                        emergency_contact = emergencyContact,
                        primary_doctor = profile.primaryDoctor
                    )
                )

                // Update the caregiver's linked patient ID
                authRepository.updateLinkedPatientId(response.patient_id)

                _uiState.update {
                    it.copy(
                        isSubmitting = false,
                        patientId = response.patient_id,
                        temporaryPassword = response.temporary_password
                    )
                }

                Log.i(TAG, "Patient created successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to create patient", e)
                _uiState.update {
                    it.copy(
                        isSubmitting = false,
                        errorMessage = "Failed to create patient. Please try again."
                    )
                }
            }
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }
}

package com.carelog.ui.vitals

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.auth.AuthRepository
import com.carelog.fhir.client.ObservationType
import com.carelog.fhir.models.FhirObservation
import com.carelog.fhir.models.ObservationComponent
import com.carelog.fhir.repository.LocalFhirRepository
import com.carelog.voice.VoiceAcknowledgementPlayer
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID
import javax.inject.Inject

/**
 * ViewModel for blood pressure logging screen.
 */
@HiltViewModel
class BloodPressureViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val localFhirRepository: LocalFhirRepository,
    private val voicePlayer: VoiceAcknowledgementPlayer
) : ViewModel() {

    private val _uiState = MutableStateFlow(BloodPressureUiState())
    val uiState: StateFlow<BloodPressureUiState> = _uiState.asStateFlow()

    fun updateSystolic(value: String) {
        _uiState.update { state ->
            val systolicInt = value.toIntOrNull()
            val error = validateSystolic(systolicInt)
            state.copy(
                systolic = value,
                systolicError = error,
                canSave = canSave(systolicInt, state.diastolic.toIntOrNull())
            )
        }
    }

    fun updateDiastolic(value: String) {
        _uiState.update { state ->
            val diastolicInt = value.toIntOrNull()
            val error = validateDiastolic(diastolicInt)
            state.copy(
                diastolic = value,
                diastolicError = error,
                canSave = canSave(state.systolic.toIntOrNull(), diastolicInt)
            )
        }
    }

    private fun validateSystolic(value: Int?): String? {
        return when {
            value == null -> null
            value < 60 -> "Too low (min 60)"
            value > 300 -> "Too high (max 300)"
            else -> null
        }
    }

    private fun validateDiastolic(value: Int?): String? {
        return when {
            value == null -> null
            value < 30 -> "Too low (min 30)"
            value > 200 -> "Too high (max 200)"
            else -> null
        }
    }

    private fun canSave(systolic: Int?, diastolic: Int?): Boolean {
        if (systolic == null || diastolic == null) return false
        if (validateSystolic(systolic) != null) return false
        if (validateDiastolic(diastolic) != null) return false
        if (systolic <= diastolic) return false
        return true
    }

    fun saveReading(onSuccess: () -> Unit) {
        val state = _uiState.value
        val systolic = state.systolic.toIntOrNull() ?: return
        val diastolic = state.diastolic.toIntOrNull() ?: return

        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, saveError = null) }

            try {
                val user = authRepository.getCurrentUser()
                val patientId = user?.linkedPatientId ?: user?.userId ?: "local"

                // Create blood pressure observation with components
                val observation = FhirObservation(
                    id = UUID.randomUUID().toString(),
                    patientId = patientId,
                    type = ObservationType.BLOOD_PRESSURE,
                    value = null, // BP uses components instead
                    unit = "mmHg",
                    effectiveDateTime = Instant.now().toString(),
                    performerId = user?.userId,
                    components = listOf(
                        ObservationComponent(
                            type = ObservationType.SYSTOLIC_BP,
                            value = systolic.toDouble(),
                            unit = "mmHg"
                        ),
                        ObservationComponent(
                            type = ObservationType.DIASTOLIC_BP,
                            value = diastolic.toDouble(),
                            unit = "mmHg"
                        )
                    )
                )

                // Save to local store (adds to sync queue)
                localFhirRepository.saveObservation(observation)

                // Play voice acknowledgement
                try { voicePlayer.playSuccess(ObservationType.BLOOD_PRESSURE) } catch (_: Exception) {}

                _uiState.update { it.copy(isSaving = false, saved = true) }

            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isSaving = false,
                        saveError = e.message ?: "Failed to save"
                    )
                }
                voicePlayer.playFailure()
            }
        }
    }
}

/**
 * UI state for blood pressure screen.
 */
data class BloodPressureUiState(
    val systolic: String = "",
    val diastolic: String = "",
    val systolicError: String? = null,
    val diastolicError: String? = null,
    val canSave: Boolean = false,
    val isSaving: Boolean = false,
    val saved: Boolean = false,
    val saveError: String? = null
)

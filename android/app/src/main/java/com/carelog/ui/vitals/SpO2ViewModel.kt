package com.carelog.ui.vitals

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.auth.AuthRepository
import com.carelog.fhir.client.ObservationType
import com.carelog.fhir.models.FhirObservation
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
 * ViewModel for SpO2 (oxygen saturation) logging screen.
 */
@HiltViewModel
class SpO2ViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val localFhirRepository: LocalFhirRepository,
    private val voicePlayer: VoiceAcknowledgementPlayer
) : ViewModel() {

    private val _uiState = MutableStateFlow(SpO2UiState())
    val uiState: StateFlow<SpO2UiState> = _uiState.asStateFlow()

    fun updateValue(value: String) {
        _uiState.update { state ->
            val intValue = value.toIntOrNull()
            val error = validateValue(intValue)
            val showWarning = intValue != null && intValue in 90..94
            state.copy(
                value = value,
                valueError = error,
                showLowWarning = showWarning,
                canSave = error == null && intValue != null
            )
        }
    }

    private fun validateValue(value: Int?): String? {
        if (value == null) return null

        return when {
            value < 70 -> "Too low (min 70%)"
            value > 100 -> "Cannot exceed 100%"
            else -> null
        }
    }

    fun saveReading(onSuccess: () -> Unit) {
        val state = _uiState.value
        val value = state.value.toIntOrNull() ?: return

        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, saveError = null) }

            try {
                val user = authRepository.getCurrentUser()
                val patientId = user?.linkedPatientId ?: throw IllegalStateException("No patient ID")

                // Create SpO2 observation
                val observation = FhirObservation(
                    id = UUID.randomUUID().toString(),
                    patientId = patientId,
                    type = ObservationType.OXYGEN_SATURATION,
                    value = value.toDouble(),
                    unit = "%",
                    effectiveDateTime = Instant.now().toString(),
                    performerId = user?.userId
                )

                // Save to local store (adds to sync queue)
                localFhirRepository.saveObservation(observation)

                // Play voice acknowledgement
                voicePlayer.playSuccess(ObservationType.OXYGEN_SATURATION)

                _uiState.update { it.copy(isSaving = false) }
                onSuccess()

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
 * UI state for SpO2 screen.
 */
data class SpO2UiState(
    val value: String = "",
    val valueError: String? = null,
    val showLowWarning: Boolean = false,
    val canSave: Boolean = false,
    val isSaving: Boolean = false,
    val saveError: String? = null
)

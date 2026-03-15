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
 * ViewModel for temperature logging screen.
 */
@HiltViewModel
class TemperatureViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val localFhirRepository: LocalFhirRepository,
    private val voicePlayer: VoiceAcknowledgementPlayer
) : ViewModel() {

    private val _uiState = MutableStateFlow(TemperatureUiState())
    val uiState: StateFlow<TemperatureUiState> = _uiState.asStateFlow()

    fun updateValue(value: String) {
        _uiState.update { state ->
            val doubleValue = value.toDoubleOrNull()
            val error = validateValue(doubleValue, state.unit)
            state.copy(
                value = value,
                valueError = error,
                canSave = error == null && doubleValue != null
            )
        }
    }

    fun updateUnit(unit: String) {
        _uiState.update { state ->
            // Convert value if switching units
            val currentValue = state.value.toDoubleOrNull()
            val newValue = if (currentValue != null) {
                if (unit == "\u00B0C" && state.unit == "\u00B0F") {
                    // Convert F to C
                    String.format("%.1f", (currentValue - 32) * 5 / 9)
                } else if (unit == "\u00B0F" && state.unit == "\u00B0C") {
                    // Convert C to F
                    String.format("%.1f", currentValue * 9 / 5 + 32)
                } else {
                    state.value
                }
            } else {
                ""
            }

            val doubleValue = newValue.toDoubleOrNull()
            val error = validateValue(doubleValue, unit)

            state.copy(
                unit = unit,
                value = newValue,
                valueError = error,
                canSave = error == null && doubleValue != null
            )
        }
    }

    private fun validateValue(value: Double?, unit: String): String? {
        if (value == null) return null

        return when (unit) {
            "\u00B0F" -> when {
                value < 90 -> "Too low (min 90\u00B0F)"
                value > 110 -> "Too high (max 110\u00B0F)"
                else -> null
            }
            "\u00B0C" -> when {
                value < 32 -> "Too low (min 32\u00B0C)"
                value > 43 -> "Too high (max 43\u00B0C)"
                else -> null
            }
            else -> null
        }
    }

    fun saveReading(onSuccess: () -> Unit) {
        val state = _uiState.value
        val value = state.value.toDoubleOrNull() ?: return

        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, saveError = null) }

            try {
                val user = authRepository.getCurrentUser()
                val patientId = user?.linkedPatientId ?: throw IllegalStateException("No patient ID")

                // Store in Celsius (standard FHIR unit)
                val valueInCelsius = if (state.unit == "\u00B0F") {
                    (value - 32) * 5 / 9
                } else {
                    value
                }

                // Create temperature observation
                val observation = FhirObservation(
                    id = UUID.randomUUID().toString(),
                    patientId = patientId,
                    type = ObservationType.BODY_TEMPERATURE,
                    value = valueInCelsius,
                    unit = "Cel",
                    effectiveDateTime = Instant.now().toString(),
                    performerId = user?.userId
                )

                // Save to local store (adds to sync queue)
                localFhirRepository.saveObservation(observation)

                // Play voice acknowledgement
                voicePlayer.playSuccess(ObservationType.BODY_TEMPERATURE)

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
 * UI state for temperature screen.
 */
data class TemperatureUiState(
    val value: String = "",
    val unit: String = "\u00B0F",
    val valueError: String? = null,
    val canSave: Boolean = false,
    val isSaving: Boolean = false,
    val saveError: String? = null
)

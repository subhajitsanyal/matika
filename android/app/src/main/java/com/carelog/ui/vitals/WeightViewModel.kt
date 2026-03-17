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
 * ViewModel for weight logging screen.
 */
@HiltViewModel
class WeightViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val localFhirRepository: LocalFhirRepository,
    private val voicePlayer: VoiceAcknowledgementPlayer
) : ViewModel() {

    private val _uiState = MutableStateFlow(WeightUiState())
    val uiState: StateFlow<WeightUiState> = _uiState.asStateFlow()

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
                if (unit == "lbs" && state.unit == "kg") {
                    // Convert kg to lbs
                    String.format("%.1f", currentValue * 2.20462)
                } else if (unit == "kg" && state.unit == "lbs") {
                    // Convert lbs to kg
                    String.format("%.1f", currentValue / 2.20462)
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
            "kg" -> when {
                value < 20 -> "Too low (min 20 kg)"
                value > 300 -> "Too high (max 300 kg)"
                else -> null
            }
            "lbs" -> when {
                value < 44 -> "Too low (min 44 lbs)"
                value > 660 -> "Too high (max 660 lbs)"
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

                // Store in kg (standard FHIR unit)
                val valueInKg = if (state.unit == "lbs") {
                    value / 2.20462
                } else {
                    value
                }

                // Create weight observation
                val observation = FhirObservation(
                    id = UUID.randomUUID().toString(),
                    patientId = patientId,
                    type = ObservationType.BODY_WEIGHT,
                    value = valueInKg,
                    unit = "kg",
                    effectiveDateTime = Instant.now().toString(),
                    performerId = user?.userId
                )

                // Save to local store (adds to sync queue)
                localFhirRepository.saveObservation(observation)

                // Play voice acknowledgement
                try { voicePlayer.playSuccess(ObservationType.BODY_WEIGHT) } catch (_: Exception) {}

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
 * UI state for weight screen.
 */
data class WeightUiState(
    val value: String = "",
    val unit: String = "kg",
    val valueError: String? = null,
    val canSave: Boolean = false,
    val isSaving: Boolean = false,
    val saved: Boolean = false,
    val saveError: String? = null
)

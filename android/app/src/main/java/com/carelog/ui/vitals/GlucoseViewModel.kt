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
 * ViewModel for glucose logging screen.
 */
@HiltViewModel
class GlucoseViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val localFhirRepository: LocalFhirRepository,
    private val voicePlayer: VoiceAcknowledgementPlayer
) : ViewModel() {

    private val _uiState = MutableStateFlow(GlucoseUiState())
    val uiState: StateFlow<GlucoseUiState> = _uiState.asStateFlow()

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
                if (unit == "mmol/L" && state.unit == "mg/dL") {
                    // Convert mg/dL to mmol/L
                    String.format("%.1f", currentValue / 18.0)
                } else if (unit == "mg/dL" && state.unit == "mmol/L") {
                    // Convert mmol/L to mg/dL
                    String.format("%.0f", currentValue * 18.0)
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

    fun updateMealTiming(timing: MealTiming) {
        _uiState.update { it.copy(mealTiming = timing) }
    }

    private fun validateValue(value: Double?, unit: String): String? {
        if (value == null) return null

        return when (unit) {
            "mg/dL" -> when {
                value < 20 -> "Too low (min 20)"
                value > 600 -> "Too high (max 600)"
                else -> null
            }
            "mmol/L" -> when {
                value < 1.1 -> "Too low (min 1.1)"
                value > 33.3 -> "Too high (max 33.3)"
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

                // Convert to mg/dL for storage (standard FHIR unit)
                val valueInMgDl = if (state.unit == "mmol/L") {
                    value * 18.0
                } else {
                    value
                }

                // Create glucose observation
                val observation = FhirObservation(
                    id = UUID.randomUUID().toString(),
                    patientId = patientId,
                    type = ObservationType.BLOOD_GLUCOSE,
                    value = valueInMgDl,
                    unit = "mg/dL",
                    effectiveDateTime = Instant.now().toString(),
                    performerId = user?.userId,
                    note = state.mealTiming?.displayName
                )

                // Save to local store (adds to sync queue)
                localFhirRepository.saveObservation(observation)

                // Play voice acknowledgement
                try { voicePlayer.playSuccess(ObservationType.BLOOD_GLUCOSE) } catch (_: Exception) {}

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
 * UI state for glucose screen.
 */
data class GlucoseUiState(
    val value: String = "",
    val unit: String = "mg/dL",
    val mealTiming: MealTiming? = null,
    val valueError: String? = null,
    val canSave: Boolean = false,
    val isSaving: Boolean = false,
    val saved: Boolean = false,
    val saveError: String? = null
)

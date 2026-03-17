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
 * ViewModel for pulse/heart rate logging screen.
 */
@HiltViewModel
class PulseViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val localFhirRepository: LocalFhirRepository,
    private val voicePlayer: VoiceAcknowledgementPlayer
) : ViewModel() {

    private val _uiState = MutableStateFlow(PulseUiState())
    val uiState: StateFlow<PulseUiState> = _uiState.asStateFlow()

    fun updateValue(value: String) {
        _uiState.update { state ->
            val intValue = value.toIntOrNull()
            val error = validateValue(intValue)
            state.copy(
                value = value,
                valueError = error,
                canSave = error == null && intValue != null
            )
        }
    }

    private fun validateValue(value: Int?): String? {
        if (value == null) return null

        return when {
            value < 30 -> "Too low (min 30 bpm)"
            value > 250 -> "Too high (max 250 bpm)"
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

                // Create heart rate observation
                val observation = FhirObservation(
                    id = UUID.randomUUID().toString(),
                    patientId = patientId,
                    type = ObservationType.HEART_RATE,
                    value = value.toDouble(),
                    unit = "/min",
                    effectiveDateTime = Instant.now().toString(),
                    performerId = user?.userId
                )

                // Save to local store (adds to sync queue)
                localFhirRepository.saveObservation(observation)

                // Play voice acknowledgement
                try { voicePlayer.playSuccess(ObservationType.HEART_RATE) } catch (_: Exception) {}

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
 * UI state for pulse screen.
 */
data class PulseUiState(
    val value: String = "",
    val valueError: String? = null,
    val canSave: Boolean = false,
    val isSaving: Boolean = false,
    val saved: Boolean = false,
    val saveError: String? = null
)

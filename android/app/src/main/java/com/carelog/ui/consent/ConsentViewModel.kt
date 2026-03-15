package com.carelog.ui.consent

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for consent screen.
 */
@HiltViewModel
class ConsentViewModel @Inject constructor(
    private val consentRepository: ConsentRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ConsentUiState())
    val uiState: StateFlow<ConsentUiState> = _uiState.asStateFlow()

    init {
        loadConsentText()
    }

    private fun loadConsentText() {
        viewModelScope.launch {
            try {
                _uiState.update { it.copy(isLoading = true, error = null) }

                val consent = consentRepository.getConsentText()

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        consentText = consent.text,
                        consentVersion = consent.version,
                        consentHash = consent.hash
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = e.message ?: "Failed to load consent text"
                    )
                }
            }
        }
    }

    fun setTermsAccepted(accepted: Boolean) {
        _uiState.update { it.copy(termsAccepted = accepted) }
    }

    fun acceptConsent() {
        viewModelScope.launch {
            try {
                _uiState.update { it.copy(isSubmitting = true, error = null) }

                val state = _uiState.value
                consentRepository.recordConsent(
                    version = state.consentVersion,
                    textHash = state.consentHash
                )

                _uiState.update {
                    it.copy(
                        isSubmitting = false,
                        consentAccepted = true
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isSubmitting = false,
                        error = e.message ?: "Failed to record consent"
                    )
                }
            }
        }
    }
}

/**
 * Consent data model.
 */
data class ConsentData(
    val version: String,
    val text: String,
    val hash: String,
    val lastUpdated: String
)

/**
 * Repository for consent operations.
 */
interface ConsentRepository {
    suspend fun getConsentText(): ConsentData
    suspend fun getConsentStatus(): ConsentStatus
    suspend fun recordConsent(version: String, textHash: String)
    suspend fun withdrawConsent(reason: String? = null)
}

data class ConsentStatus(
    val hasConsent: Boolean,
    val consentVersion: String?,
    val acceptedAt: String?,
    val currentVersion: String,
    val needsUpdate: Boolean
)

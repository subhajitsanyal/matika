package com.carelog.ui.auth

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
 * ViewModel for the verification screen.
 */
@HiltViewModel
class VerificationViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<VerificationUiState>(VerificationUiState.Idle)
    val uiState: StateFlow<VerificationUiState> = _uiState.asStateFlow()

    /**
     * Confirm sign up with verification code.
     */
    fun confirmSignUp(email: String, code: String) {
        viewModelScope.launch {
            _uiState.value = VerificationUiState.Loading

            val result = authRepository.confirmSignUp(email, code)

            result.fold(
                onSuccess = {
                    _uiState.value = VerificationUiState.Success
                },
                onFailure = { error ->
                    _uiState.value = VerificationUiState.Error(
                        error.message ?: "Verification failed"
                    )
                }
            )
        }
    }

    /**
     * Resend verification code.
     */
    fun resendCode(email: String) {
        viewModelScope.launch {
            _uiState.value = VerificationUiState.Loading

            // Note: Amplify handles resend through signUp flow
            // This would need to be implemented in AuthRepository
            _uiState.value = VerificationUiState.CodeResent
        }
    }
}

package com.carelog.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.auth.AuthRepository
import com.carelog.auth.SignInOutcome
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the login screen.
 */
@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<LoginUiState>(LoginUiState.Idle)
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    /**
     * Attempt to log in with email and password.
     */
    fun login(email: String, password: String) {
        viewModelScope.launch {
            _uiState.value = LoginUiState.Loading

            val result = authRepository.signIn(email, password)

            result.fold(
                onSuccess = { outcome ->
                    _uiState.value = when (outcome) {
                        is SignInOutcome.Authenticated -> LoginUiState.Success
                        // EDGE-V2-04 — admin-created user's first sign-in
                        // returns NEW_PASSWORD_REQUIRED. The screen routes
                        // to NewPasswordScreen which calls confirmNewPassword.
                        is SignInOutcome.NewPasswordRequired ->
                            LoginUiState.NewPasswordRequired(outcome.email)
                    }
                },
                onFailure = { error ->
                    _uiState.value = LoginUiState.Error(
                        error.message ?: "Login failed"
                    )
                }
            )
        }
    }

    /**
     * Reset the UI state.
     */
    fun resetState() {
        _uiState.value = LoginUiState.Idle
    }
}

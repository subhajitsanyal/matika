package com.carelog.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.auth.AuthRepository
import com.carelog.auth.PersonaType
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * UI state for registration screen.
 */
sealed class RegisterUiState {
    object Idle : RegisterUiState()
    object Loading : RegisterUiState()
    object Success : RegisterUiState()
    data class NeedsConfirmation(val email: String) : RegisterUiState()
    data class Error(val message: String) : RegisterUiState()
}

/**
 * ViewModel for the registration screen.
 */
@HiltViewModel
class RegisterViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<RegisterUiState>(RegisterUiState.Idle)
    val uiState: StateFlow<RegisterUiState> = _uiState.asStateFlow()

    /**
     * Register a new user.
     */
    @Suppress("UNUSED_PARAMETER")
    fun register(
        email: String,
        password: String,
        name: String,
        phone: String?,
        personaType: PersonaType
    ) {
        viewModelScope.launch {
            _uiState.value = RegisterUiState.Loading

            val result = authRepository.signUp(
                email = email,
                password = password,
                name = name,
                personaType = personaType
            )

            result.fold(
                onSuccess = { signUpResult ->
                    if (signUpResult.isSignUpComplete) {
                        _uiState.value = RegisterUiState.Success
                    } else {
                        // User needs to confirm email
                        _uiState.value = RegisterUiState.NeedsConfirmation(email)
                    }
                },
                onFailure = { error ->
                    _uiState.value = RegisterUiState.Error(
                        error.message ?: "Registration failed"
                    )
                }
            )
        }
    }

    /**
     * Reset the UI state.
     */
    fun resetState() {
        _uiState.value = RegisterUiState.Idle
    }
}

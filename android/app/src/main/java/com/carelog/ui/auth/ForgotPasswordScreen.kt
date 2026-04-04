package com.carelog.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
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
 * Forgot password screen.
 *
 * Two-step flow:
 * 1. Enter email to receive a reset code
 * 2. Enter the code + new password to complete the reset
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForgotPasswordScreen(
    onNavigateBack: () -> Unit,
    onPasswordResetSuccess: () -> Unit,
    viewModel: ForgotPasswordViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }

    LaunchedEffect(uiState) {
        if (uiState is ForgotPasswordUiState.ResetComplete) {
            onPasswordResetSuccess()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Reset Password") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = Icons.Default.Lock,
                contentDescription = null,
                modifier = Modifier.size(80.dp),
                tint = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(24.dp))

            when (uiState) {
                is ForgotPasswordUiState.Idle,
                is ForgotPasswordUiState.SendingCode,
                is ForgotPasswordUiState.Error -> {
                    // Step 1: Enter email
                    Text(
                        text = "Forgot your password?",
                        style = MaterialTheme.typography.headlineSmall
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = "Enter your email address and we'll send you a code to reset your password.",
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(modifier = Modifier.height(32.dp))

                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        label = { Text("Email") },
                        leadingIcon = { Icon(Icons.Default.Email, contentDescription = null) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("forgot_password_email"),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Email,
                            imeAction = ImeAction.Done
                        ),
                        keyboardActions = KeyboardActions(
                            onDone = {
                                if (email.isNotBlank()) {
                                    viewModel.sendResetCode(email)
                                }
                            }
                        )
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // Error message
                    if (uiState is ForgotPasswordUiState.Error) {
                        Text(
                            text = (uiState as ForgotPasswordUiState.Error).message,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.testTag("forgot_password_error")
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                    }

                    Button(
                        onClick = { viewModel.sendResetCode(email) },
                        enabled = email.isNotBlank() && uiState !is ForgotPasswordUiState.SendingCode,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp)
                            .testTag("forgot_password_send_code")
                    ) {
                        if (uiState is ForgotPasswordUiState.SendingCode) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                        } else {
                            Text("Send Reset Code", style = MaterialTheme.typography.titleMedium)
                        }
                    }
                }

                is ForgotPasswordUiState.CodeSent,
                is ForgotPasswordUiState.Confirming,
                is ForgotPasswordUiState.ConfirmError -> {
                    // Step 2: Enter code + new password
                    Text(
                        text = "Enter reset code",
                        style = MaterialTheme.typography.headlineSmall
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = "We've sent a reset code to\n$email",
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(modifier = Modifier.height(32.dp))

                    OutlinedTextField(
                        value = code,
                        onValueChange = { if (it.length <= 6) code = it },
                        label = { Text("Reset Code") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("forgot_password_code"),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Number,
                            imeAction = ImeAction.Next
                        )
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    OutlinedTextField(
                        value = newPassword,
                        onValueChange = { newPassword = it },
                        label = { Text("New Password") },
                        leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null) },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth().testTag("forgot_password_new_password"),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done
                        ),
                        keyboardActions = KeyboardActions(
                            onDone = {
                                if (code.length == 6 && newPassword.length >= 8) {
                                    viewModel.confirmReset(email, code, newPassword)
                                }
                            }
                        )
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // Error message
                    if (uiState is ForgotPasswordUiState.ConfirmError) {
                        Text(
                            text = (uiState as ForgotPasswordUiState.ConfirmError).message,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.testTag("forgot_password_confirm_error")
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                    }

                    Button(
                        onClick = { viewModel.confirmReset(email, code, newPassword) },
                        enabled = code.length == 6 && newPassword.length >= 8 &&
                                uiState !is ForgotPasswordUiState.Confirming,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp)
                            .testTag("forgot_password_confirm")
                    ) {
                        if (uiState is ForgotPasswordUiState.Confirming) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                        } else {
                            Text("Reset Password", style = MaterialTheme.typography.titleMedium)
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    TextButton(
                        onClick = { viewModel.sendResetCode(email) },
                        enabled = uiState !is ForgotPasswordUiState.Confirming
                    ) {
                        Text("Resend code")
                    }
                }

                is ForgotPasswordUiState.ResetComplete -> {
                    // Handled by LaunchedEffect above
                }
            }
        }
    }
}

/**
 * UI state for forgot password screen.
 */
sealed class ForgotPasswordUiState {
    object Idle : ForgotPasswordUiState()
    object SendingCode : ForgotPasswordUiState()
    object CodeSent : ForgotPasswordUiState()
    object Confirming : ForgotPasswordUiState()
    object ResetComplete : ForgotPasswordUiState()
    data class Error(val message: String) : ForgotPasswordUiState()
    data class ConfirmError(val message: String) : ForgotPasswordUiState()
}

/**
 * ViewModel for forgot password flow.
 */
@HiltViewModel
class ForgotPasswordViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<ForgotPasswordUiState>(ForgotPasswordUiState.Idle)
    val uiState: StateFlow<ForgotPasswordUiState> = _uiState.asStateFlow()

    /**
     * Send a reset code to the given email.
     */
    fun sendResetCode(email: String) {
        viewModelScope.launch {
            _uiState.value = ForgotPasswordUiState.SendingCode

            val result = authRepository.resetPassword(email)

            result.fold(
                onSuccess = {
                    _uiState.value = ForgotPasswordUiState.CodeSent
                },
                onFailure = { error ->
                    _uiState.value = ForgotPasswordUiState.Error(
                        error.message ?: "Failed to send reset code"
                    )
                }
            )
        }
    }

    /**
     * Confirm password reset with code and new password.
     */
    fun confirmReset(email: String, code: String, newPassword: String) {
        viewModelScope.launch {
            _uiState.value = ForgotPasswordUiState.Confirming

            val result = authRepository.confirmResetPassword(email, code, newPassword)

            result.fold(
                onSuccess = {
                    _uiState.value = ForgotPasswordUiState.ResetComplete
                },
                onFailure = { error ->
                    _uiState.value = ForgotPasswordUiState.ConfirmError(
                        error.message ?: "Failed to reset password"
                    )
                }
            )
        }
    }
}

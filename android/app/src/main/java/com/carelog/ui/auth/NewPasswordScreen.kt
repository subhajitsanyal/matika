package com.carelog.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
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
 * EDGE-V2-04 — set a new password to resolve Cognito's
 * NEW_PASSWORD_REQUIRED challenge for an admin-created user.
 *
 * Reached only after [LoginScreen] sees [LoginUiState.NewPasswordRequired].
 * Calls [AuthRepository.confirmNewPassword] which submits the new password
 * to the same Cognito sign-in transaction; on success the AuthState flips
 * to Authenticated and the caller routes back through SPLASH.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewPasswordScreen(
    email: String,
    onCancel: () -> Unit,
    onPasswordChanged: () -> Unit,
    viewModel: NewPasswordViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val focusManager = LocalFocusManager.current

    var newPassword by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }

    val isValid = newPassword.length >= 8 && newPassword == confirmPassword

    LaunchedEffect(uiState) {
        if (uiState is NewPasswordUiState.Success) {
            onPasswordChanged()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Set New Password") },
                navigationIcon = {
                    IconButton(onClick = onCancel) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Choose a new password",
                style = MaterialTheme.typography.headlineSmall
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Your account ($email) was set up with a temporary " +
                    "password. Pick a new one to finish signing in.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("new_password_email_hint")
            )

            Spacer(modifier = Modifier.height(24.dp))

            OutlinedTextField(
                value = newPassword,
                onValueChange = { newPassword = it },
                label = { Text("New Password") },
                leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null) },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("new_password_input"),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Next
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(androidx.compose.ui.focus.FocusDirection.Down) }
                ),
                supportingText = {
                    Text("At least 8 characters with uppercase, lowercase, number, and symbol")
                }
            )

            Spacer(modifier = Modifier.height(16.dp))

            OutlinedTextField(
                value = confirmPassword,
                onValueChange = { confirmPassword = it },
                label = { Text("Confirm New Password") },
                leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null) },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                isError = confirmPassword.isNotEmpty() && newPassword != confirmPassword,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("new_password_confirm_input"),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(
                    onDone = {
                        focusManager.clearFocus()
                        if (isValid) viewModel.confirmNewPassword(newPassword)
                    }
                ),
                supportingText = {
                    if (confirmPassword.isNotEmpty() && newPassword != confirmPassword) {
                        Text("Passwords do not match", color = MaterialTheme.colorScheme.error)
                    }
                }
            )

            Spacer(modifier = Modifier.height(24.dp))

            if (uiState is NewPasswordUiState.Error) {
                Text(
                    text = (uiState as NewPasswordUiState.Error).message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag("new_password_error")
                )
                Spacer(modifier = Modifier.height(16.dp))
            }

            Button(
                onClick = { viewModel.confirmNewPassword(newPassword) },
                enabled = isValid && uiState !is NewPasswordUiState.Loading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .testTag("new_password_submit")
            ) {
                if (uiState is NewPasswordUiState.Loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Text("Set Password and Sign In", style = MaterialTheme.typography.titleMedium)
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

sealed class NewPasswordUiState {
    object Idle : NewPasswordUiState()
    object Loading : NewPasswordUiState()
    object Success : NewPasswordUiState()
    data class Error(val message: String) : NewPasswordUiState()
}

@HiltViewModel
class NewPasswordViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<NewPasswordUiState>(NewPasswordUiState.Idle)
    val uiState: StateFlow<NewPasswordUiState> = _uiState.asStateFlow()

    fun confirmNewPassword(newPassword: String) {
        viewModelScope.launch {
            _uiState.value = NewPasswordUiState.Loading
            val result = authRepository.confirmNewPassword(newPassword)
            _uiState.value = result.fold(
                onSuccess = { NewPasswordUiState.Success },
                onFailure = { error ->
                    NewPasswordUiState.Error(error.message ?: "Failed to set new password")
                }
            )
        }
    }
}

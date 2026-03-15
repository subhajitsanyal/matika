package com.carelog.ui.attendant

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.auth.AttendantInfo
import com.carelog.auth.AttendantSessionManager
import com.carelog.ui.theme.CareLogColors
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Attendant login screen for logging in on a patient's device.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttendantLoginScreen(
    onNavigateBack: () -> Unit,
    onLoginSuccess: () -> Unit,
    viewModel: AttendantLoginViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val focusManager = LocalFocusManager.current

    var passwordVisible by remember { mutableStateOf(false) }

    // Handle login success
    LaunchedEffect(uiState.loginSuccess) {
        if (uiState.loginSuccess) {
            onLoginSuccess()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Attendant Login") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Info text
            Text(
                text = "Log in with your attendant credentials to record vitals on behalf of the patient.",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Email field
            OutlinedTextField(
                value = uiState.email,
                onValueChange = { viewModel.updateEmail(it) },
                label = { Text("Email") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) }
                ),
                enabled = !uiState.isLoading
            )

            // Password field
            OutlinedTextField(
                value = uiState.password,
                onValueChange = { viewModel.updatePassword(it) },
                label = { Text("Password") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                visualTransformation = if (passwordVisible) {
                    VisualTransformation.None
                } else {
                    PasswordVisualTransformation()
                },
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(
                    onDone = {
                        focusManager.clearFocus()
                        viewModel.login()
                    }
                ),
                trailingIcon = {
                    IconButton(onClick = { passwordVisible = !passwordVisible }) {
                        Icon(
                            imageVector = if (passwordVisible) {
                                Icons.Default.VisibilityOff
                            } else {
                                Icons.Default.Visibility
                            },
                            contentDescription = if (passwordVisible) "Hide password" else "Show password"
                        )
                    }
                },
                enabled = !uiState.isLoading
            )

            // Error message
            if (uiState.error != null) {
                Text(
                    text = uiState.error!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Login button
            Button(
                onClick = { viewModel.login() },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                enabled = uiState.email.isNotBlank() &&
                        uiState.password.isNotBlank() &&
                        !uiState.isLoading,
                colors = ButtonDefaults.buttonColors(
                    containerColor = CareLogColors.Primary
                )
            ) {
                if (uiState.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Text("Log In as Attendant")
                }
            }

            Spacer(modifier = Modifier.weight(1f))

            // Session info
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = MaterialTheme.shapes.medium
            ) {
                Text(
                    text = "Your session will be active for 8 hours. You can switch back to patient mode at any time.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp),
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}

/**
 * ViewModel for attendant login.
 */
@HiltViewModel
class AttendantLoginViewModel @Inject constructor(
    private val attendantSessionManager: AttendantSessionManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(AttendantLoginUiState())
    val uiState: StateFlow<AttendantLoginUiState> = _uiState.asStateFlow()

    fun updateEmail(email: String) {
        _uiState.update { it.copy(email = email, error = null) }
    }

    fun updatePassword(password: String) {
        _uiState.update { it.copy(password = password, error = null) }
    }

    fun login() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = attendantSessionManager.loginAsAttendant(
                email = _uiState.value.email,
                password = _uiState.value.password
            )

            if (result.isSuccess) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        loginSuccess = true,
                        attendantInfo = result.getOrNull()
                    )
                }
            } else {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = result.exceptionOrNull()?.message ?: "Login failed"
                    )
                }
            }
        }
    }
}

/**
 * UI state for attendant login.
 */
data class AttendantLoginUiState(
    val email: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val loginSuccess: Boolean = false,
    val attendantInfo: AttendantInfo? = null
)

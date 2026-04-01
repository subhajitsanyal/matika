package com.carelog.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.auth.PersonaType

/**
 * Registration screen for new relatives (caregivers).
 *
 * This is the entry point for onboarding - relatives create their
 * own account first, then onboard a patient.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegisterScreen(
    onNavigateToLogin: () -> Unit,
    onRegistrationSuccess: () -> Unit,
    onNavigateToVerification: (String) -> Unit,
    viewModel: RegisterViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val focusManager = LocalFocusManager.current

    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var acceptedTerms by remember { mutableStateOf(false) }


    val isFormValid = name.isNotBlank() &&
            email.isNotBlank() &&
            password.length >= 8 &&
            password == confirmPassword &&
            acceptedTerms

    LaunchedEffect(uiState) {
        when (uiState) {
            is RegisterUiState.Success -> onRegistrationSuccess()
            is RegisterUiState.NeedsConfirmation -> {
                onNavigateToVerification((uiState as RegisterUiState.NeedsConfirmation).email)
            }
            else -> {}
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Create Account") },
                navigationIcon = {
                    IconButton(onClick = onNavigateToLogin) {
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
                .padding(horizontal = 24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            // Header
            Text(
                text = "Join CareLog as a Caregiver",
                style = MaterialTheme.typography.headlineSmall
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Create your account to start monitoring your loved one's health. You can add patients, attendants, and doctors from Settings.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Name field
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Full Name") },
                leadingIcon = { Icon(Icons.Default.Person, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("register_name"),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Text,
                    imeAction = ImeAction.Next
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) }
                )
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Email field
            OutlinedTextField(
                value = email,
                onValueChange = { email = it.lowercase().trim() },
                label = { Text("Email") },
                leadingIcon = { Icon(Icons.Default.Email, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("register_email"),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) }
                )
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Phone field (optional)
            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it },
                label = { Text("Phone Number (Optional)") },
                leadingIcon = { Icon(Icons.Default.Phone, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("register_phone"),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Phone,
                    imeAction = ImeAction.Next
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) }
                )
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Password field
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null) },
                trailingIcon = {
                    IconButton(onClick = { passwordVisible = !passwordVisible }) {
                        Icon(
                            if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                            contentDescription = if (passwordVisible) "Hide password" else "Show password"
                        )
                    }
                },
                singleLine = true,
                visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth().testTag("register_password"),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Next
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) }
                ),
                supportingText = {
                    Text("At least 8 characters with uppercase, lowercase, number, and symbol")
                }
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Confirm Password field
            OutlinedTextField(
                value = confirmPassword,
                onValueChange = { confirmPassword = it },
                label = { Text("Confirm Password") },
                leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null) },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth().testTag("register_confirm_password"),
                isError = confirmPassword.isNotEmpty() && password != confirmPassword,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(
                    onDone = { focusManager.clearFocus() }
                ),
                supportingText = {
                    if (confirmPassword.isNotEmpty() && password != confirmPassword) {
                        Text("Passwords do not match", color = MaterialTheme.colorScheme.error)
                    }
                }
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Terms acceptance
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Checkbox(
                    checked = acceptedTerms,
                    onCheckedChange = { acceptedTerms = it },
                    modifier = Modifier.testTag("register_terms_checkbox")
                )
                Text(
                    text = "I agree to the Terms of Service and Privacy Policy",
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Error message
            if (uiState is RegisterUiState.Error) {
                Text(
                    text = (uiState as RegisterUiState.Error).message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag("register_error")
                )
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Register button
            Button(
                onClick = {
                    viewModel.register(
                        email = email,
                        password = password,
                        name = name,
                        phone = phone.ifBlank { null },
                        personaType = PersonaType.RELATIVE
                    )
                },
                enabled = isFormValid && uiState !is RegisterUiState.Loading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .testTag("register_button")
            ) {
                if (uiState is RegisterUiState.Loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Text("Create Account", style = MaterialTheme.typography.titleMedium)
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Login link
            TextButton(onClick = onNavigateToLogin) {
                Text("Already have an account? Sign in")
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

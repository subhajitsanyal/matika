package com.carelog.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Email verification screen.
 *
 * User enters the verification code sent to their email.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VerificationScreen(
    email: String,
    onNavigateBack: () -> Unit,
    onVerificationSuccess: () -> Unit,
    viewModel: VerificationViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    var code by remember { mutableStateOf("") }

    LaunchedEffect(uiState) {
        if (uiState is VerificationUiState.Success) {
            onVerificationSuccess()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Verify Email") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
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
                imageVector = Icons.Default.Email,
                contentDescription = null,
                modifier = Modifier.size(80.dp),
                tint = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = "Check your email",
                style = MaterialTheme.typography.headlineSmall
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "We've sent a verification code to\n$email",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Verification code input
            OutlinedTextField(
                value = code,
                onValueChange = { if (it.length <= 6) code = it },
                label = { Text("Verification Code") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Number,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(
                    onDone = {
                        if (code.length == 6) {
                            viewModel.confirmSignUp(email, code)
                        }
                    }
                )
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Error message
            if (uiState is VerificationUiState.Error) {
                Text(
                    text = (uiState as VerificationUiState.Error).message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Verify button
            Button(
                onClick = { viewModel.confirmSignUp(email, code) },
                enabled = code.length == 6 && uiState !is VerificationUiState.Loading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
            ) {
                if (uiState is VerificationUiState.Loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Text("Verify", style = MaterialTheme.typography.titleMedium)
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Resend code button
            TextButton(
                onClick = { viewModel.resendCode(email) },
                enabled = uiState !is VerificationUiState.Loading
            ) {
                Text("Resend verification code")
            }
        }
    }
}

/**
 * UI state for verification screen.
 */
sealed class VerificationUiState {
    object Idle : VerificationUiState()
    object Loading : VerificationUiState()
    object Success : VerificationUiState()
    object CodeResent : VerificationUiState()
    data class Error(val message: String) : VerificationUiState()
}

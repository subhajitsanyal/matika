package com.carelog.ui.consent

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.ui.theme.CareLogColors

/**
 * DPDP Consent screen shown during onboarding.
 * User must accept to proceed with registration.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConsentScreen(
    onConsentAccepted: () -> Unit,
    onCancel: () -> Unit,
    viewModel: ConsentViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val scrollState = rememberScrollState()

    LaunchedEffect(uiState.consentAccepted) {
        if (uiState.consentAccepted) {
            onConsentAccepted()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Privacy Consent") },
                navigationIcon = {
                    IconButton(onClick = onCancel) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "Cancel"
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
        ) {
            // Scrollable consent text
            Box(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 16.dp)
            ) {
                Column(
                    modifier = Modifier.verticalScroll(scrollState)
                ) {
                    if (uiState.isLoading) {
                        Box(
                            modifier = Modifier.fillMaxWidth(),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator()
                        }
                    } else {
                        Text(
                            text = "CareLog Privacy Consent",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold
                        )

                        Spacer(modifier = Modifier.height(8.dp))

                        Text(
                            text = "Version ${uiState.consentVersion}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )

                        Spacer(modifier = Modifier.height(16.dp))

                        Text(
                            text = uiState.consentText,
                            style = MaterialTheme.typography.bodyMedium
                        )

                        Spacer(modifier = Modifier.height(24.dp))
                    }
                }
            }

            // Error message
            uiState.error?.let { error ->
                Text(
                    text = error,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp)
                )
                Spacer(modifier = Modifier.height(8.dp))
            }

            // Consent checkbox and button
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Checkbox(
                        checked = uiState.termsAccepted,
                        onCheckedChange = { viewModel.setTermsAccepted(it) },
                        enabled = !uiState.isLoading && !uiState.isSubmitting
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "I have read, understood, and agree to the privacy consent and data processing terms above.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                Button(
                    onClick = { viewModel.acceptConsent() },
                    enabled = uiState.termsAccepted && !uiState.isSubmitting,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = CareLogColors.Primary
                    )
                ) {
                    if (uiState.isSubmitting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    } else {
                        Text("Accept and Continue")
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                TextButton(
                    onClick = onCancel,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Cancel Registration")
                }
            }
        }
    }
}

/**
 * Consent ViewModel state.
 */
data class ConsentUiState(
    val isLoading: Boolean = true,
    val isSubmitting: Boolean = false,
    val consentText: String = "",
    val consentVersion: String = "",
    val consentHash: String = "",
    val termsAccepted: Boolean = false,
    val consentAccepted: Boolean = false,
    val error: String? = null
)

package com.carelog.ui.vitals

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.ui.theme.CareLogColors

/**
 * Pulse/Heart rate logging screen.
 *
 * Single numeric input (bpm).
 * LOINC code: 8867-4
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PulseScreen(
    onNavigateBack: () -> Unit,
    viewModel: PulseViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Heart Rate") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CareLogColors.Pulse,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            Spacer(modifier = Modifier.height(64.dp))

            // Pulse value input
            LargeNumericInput(
                value = uiState.value,
                onValueChange = { viewModel.updateValue(it) },
                placeholder = "72",
                unit = "bpm",
                allowDecimal = false,
                maxDigits = 3,
                isError = uiState.valueError != null,
                errorMessage = uiState.valueError,
                accentColor = CareLogColors.Pulse
            )

            // Info text
            Text(
                text = "Normal resting heart rate: 60-100 bpm",
                style = MaterialTheme.typography.bodyMedium,
                color = CareLogColors.OnSurfaceVariant
            )

            Spacer(modifier = Modifier.weight(1f))

            // Save button
            Button(
                onClick = { viewModel.saveReading {} },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(72.dp),
                enabled = uiState.canSave && !uiState.isSaving,
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = CareLogColors.Pulse
                )
            ) {
                if (uiState.isSaving) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = Color.White,
                        strokeWidth = 2.dp
                    )
                } else {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        modifier = Modifier.size(28.dp)
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = "Save",
                        style = MaterialTheme.typography.titleLarge
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }

    // Success acknowledgement overlay
    SaveAcknowledgement(
        visible = uiState.saved,
        vitalName = "Heart Rate",
        onDismiss = onNavigateBack
    )
}

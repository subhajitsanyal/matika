package com.carelog.ui.vitals

import androidx.compose.foundation.background
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.ui.theme.CareLogColors

/**
 * SpO2 (Oxygen Saturation) logging screen.
 *
 * Single numeric input (percentage).
 * LOINC code: 2708-6
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpO2Screen(
    onNavigateBack: () -> Unit,
    viewModel: SpO2ViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Oxygen Level") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CareLogColors.SpO2,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.surface)
                .padding(paddingValues)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            Spacer(modifier = Modifier.height(64.dp))

            // SpO2 value input
            LargeNumericInput(
                value = uiState.value,
                onValueChange = { viewModel.updateValue(it) },
                placeholder = "98",
                unit = "%",
                allowDecimal = false,
                maxDigits = 3,
                isError = uiState.valueError != null,
                errorMessage = uiState.valueError,
                accentColor = CareLogColors.SpO2
            )

            // Info text
            Text(
                text = "Normal oxygen saturation: 95-100%",
                style = MaterialTheme.typography.bodyMedium,
                color = CareLogColors.OnSurfaceVariant
            )

            // Warning for low values
            if (uiState.showLowWarning) {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = CareLogColors.Warning.copy(alpha = 0.15f)
                    )
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Low oxygen levels may require medical attention",
                            style = MaterialTheme.typography.bodyMedium,
                            color = CareLogColors.Warning
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.weight(1f))

            // Save button
            Button(
                onClick = { viewModel.saveReading {} },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(72.dp)
                    .testTag("spo2_save_button"),
                enabled = uiState.canSave && !uiState.isSaving,
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = CareLogColors.SpO2
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

    // Show error dialog
    uiState.saveError?.let { error ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Save Failed") },
            text = { Text(error) },
            confirmButton = {
                TextButton(onClick = onNavigateBack) { Text("OK") }
            }
        )
    }

    // Success acknowledgement overlay
    SaveAcknowledgement(
        visible = uiState.saved,
        vitalName = "Oxygen Level",
        onDismiss = onNavigateBack
    )
}

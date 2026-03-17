package com.carelog.ui.vitals

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.ui.theme.CareLogColors

/**
 * Blood pressure logging screen.
 *
 * Full-screen, single-action UI with two large numeric inputs (systolic/diastolic).
 * LOINC codes: Systolic 8480-6, Diastolic 8462-4
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BloodPressureScreen(
    onNavigateBack: () -> Unit,
    viewModel: BloodPressureViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Blood Pressure") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CareLogColors.BloodPressure,
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
            Spacer(modifier = Modifier.height(32.dp))

            // Systolic input
            BloodPressureInput(
                label = "Systolic",
                value = uiState.systolic,
                onValueChange = { viewModel.updateSystolic(it) },
                placeholder = "120",
                unit = "mmHg",
                isError = uiState.systolicError != null,
                errorMessage = uiState.systolicError
            )

            // Divider with slash
            Text(
                text = "/",
                style = MaterialTheme.typography.displayMedium,
                color = CareLogColors.OnSurfaceVariant
            )

            // Diastolic input
            BloodPressureInput(
                label = "Diastolic",
                value = uiState.diastolic,
                onValueChange = { viewModel.updateDiastolic(it) },
                placeholder = "80",
                unit = "mmHg",
                isError = uiState.diastolicError != null,
                errorMessage = uiState.diastolicError
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
                    containerColor = CareLogColors.BloodPressure
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

    // Show error snackbar
    if (uiState.saveError != null) {
        LaunchedEffect(uiState.saveError) {
            // Error handling - could show snackbar
        }
    }

    // Success acknowledgement overlay
    SaveAcknowledgement(
        visible = uiState.saved,
        vitalName = "Blood Pressure",
        onDismiss = onNavigateBack
    )
}

/**
 * Large numeric input for blood pressure values.
 */
@Composable
fun BloodPressureInput(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    unit: String,
    isError: Boolean = false,
    errorMessage: String? = null
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.titleMedium,
            color = CareLogColors.OnSurfaceVariant
        )

        Spacer(modifier = Modifier.height(8.dp))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            OutlinedTextField(
                value = value,
                onValueChange = { newValue ->
                    // Only allow numeric input up to 3 digits
                    if (newValue.all { it.isDigit() } && newValue.length <= 3) {
                        onValueChange(newValue)
                    }
                },
                modifier = Modifier.width(140.dp),
                textStyle = MaterialTheme.typography.displayMedium.copy(
                    textAlign = TextAlign.Center
                ),
                placeholder = {
                    Text(
                        text = placeholder,
                        style = MaterialTheme.typography.displayMedium,
                        color = CareLogColors.OnSurfaceVariant.copy(alpha = 0.4f),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                isError = isError,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = CareLogColors.BloodPressure,
                    unfocusedBorderColor = CareLogColors.SurfaceVariant
                ),
                shape = RoundedCornerShape(12.dp)
            )

            Spacer(modifier = Modifier.width(12.dp))

            Text(
                text = unit,
                style = MaterialTheme.typography.titleMedium,
                color = CareLogColors.OnSurfaceVariant
            )
        }

        if (errorMessage != null) {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = CareLogColors.Error
            )
        }
    }
}

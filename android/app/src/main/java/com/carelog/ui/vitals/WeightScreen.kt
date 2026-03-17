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
 * Weight logging screen.
 *
 * Single numeric input with kg/lbs unit toggle.
 * LOINC code: 29463-7
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WeightScreen(
    onNavigateBack: () -> Unit,
    viewModel: WeightViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Weight") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CareLogColors.Weight,
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
            Spacer(modifier = Modifier.height(48.dp))

            // Unit toggle
            UnitToggle(
                options = listOf("kg", "lbs"),
                selectedOption = uiState.unit,
                onOptionSelected = { viewModel.updateUnit(it) },
                accentColor = CareLogColors.Weight
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Weight value input
            LargeNumericInput(
                value = uiState.value,
                onValueChange = { viewModel.updateValue(it) },
                placeholder = if (uiState.unit == "kg") "70.0" else "154.0",
                unit = uiState.unit,
                allowDecimal = true,
                maxDigits = 3,
                isError = uiState.valueError != null,
                errorMessage = uiState.valueError,
                accentColor = CareLogColors.Weight
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
                    containerColor = CareLogColors.Weight
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
        vitalName = "Weight",
        onDismiss = onNavigateBack
    )
}

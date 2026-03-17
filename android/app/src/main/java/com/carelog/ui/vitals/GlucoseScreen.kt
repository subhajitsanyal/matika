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
 * Glucose logging screen.
 *
 * Single numeric input with meal timing selector.
 * LOINC code: 2339-0
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GlucoseScreen(
    onNavigateBack: () -> Unit,
    viewModel: GlucoseViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Blood Glucose") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CareLogColors.Glucose,
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

            // Unit toggle
            UnitToggle(
                options = listOf("mg/dL", "mmol/L"),
                selectedOption = uiState.unit,
                onOptionSelected = { viewModel.updateUnit(it) },
                accentColor = CareLogColors.Glucose
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Glucose value input
            LargeNumericInput(
                value = uiState.value,
                onValueChange = { viewModel.updateValue(it) },
                placeholder = if (uiState.unit == "mg/dL") "100" else "5.5",
                unit = uiState.unit,
                allowDecimal = uiState.unit == "mmol/L",
                maxDigits = if (uiState.unit == "mg/dL") 3 else 2,
                isError = uiState.valueError != null,
                errorMessage = uiState.valueError,
                accentColor = CareLogColors.Glucose
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Meal timing selector
            MealTimingSelector(
                selectedTiming = uiState.mealTiming,
                onTimingSelected = { viewModel.updateMealTiming(it) },
                accentColor = CareLogColors.Glucose
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
                    containerColor = CareLogColors.Glucose
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
        vitalName = "Blood Glucose",
        onDismiss = onNavigateBack
    )
}

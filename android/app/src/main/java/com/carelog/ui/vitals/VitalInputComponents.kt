package com.carelog.ui.vitals

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.carelog.ui.theme.CareLogColors

/**
 * Large numeric input field for vital values.
 */
@Composable
fun LargeNumericInput(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    unit: String,
    modifier: Modifier = Modifier,
    label: String? = null,
    allowDecimal: Boolean = false,
    maxDigits: Int = 3,
    isError: Boolean = false,
    errorMessage: String? = null,
    accentColor: Color = CareLogColors.Primary
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        if (label != null) {
            Text(
                text = label,
                style = MaterialTheme.typography.titleMedium,
                color = CareLogColors.OnSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            OutlinedTextField(
                value = value,
                onValueChange = { newValue ->
                    val isValid = if (allowDecimal) {
                        // Allow digits and one decimal point
                        val parts = newValue.split(".")
                        when {
                            parts.size > 2 -> false
                            parts.size == 2 -> parts[0].all { it.isDigit() } &&
                                              parts[1].all { it.isDigit() } &&
                                              parts[0].length <= maxDigits &&
                                              parts[1].length <= 1
                            else -> newValue.all { it.isDigit() || it == '.' } &&
                                   newValue.count { it == '.' } <= 1 &&
                                   newValue.replace(".", "").length <= maxDigits
                        }
                    } else {
                        newValue.all { it.isDigit() } && newValue.length <= maxDigits
                    }

                    if (isValid) {
                        onValueChange(newValue)
                    }
                },
                modifier = Modifier.width(if (allowDecimal) 160.dp else 140.dp),
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
                keyboardOptions = KeyboardOptions(
                    keyboardType = if (allowDecimal) KeyboardType.Decimal else KeyboardType.Number
                ),
                singleLine = true,
                isError = isError,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = accentColor,
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

/**
 * Unit toggle buttons (e.g., kg/lbs, C/F).
 */
@Composable
fun UnitToggle(
    options: List<String>,
    selectedOption: String,
    onOptionSelected: (String) -> Unit,
    modifier: Modifier = Modifier,
    accentColor: Color = CareLogColors.Primary
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        options.forEach { option ->
            FilterChip(
                selected = option == selectedOption,
                onClick = { onOptionSelected(option) },
                label = {
                    Text(
                        text = option,
                        style = MaterialTheme.typography.labelLarge
                    )
                },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = accentColor,
                    selectedLabelColor = Color.White
                )
            )
        }
    }
}

/**
 * Meal timing selector for glucose readings.
 */
@Composable
fun MealTimingSelector(
    selectedTiming: MealTiming?,
    onTimingSelected: (MealTiming) -> Unit,
    modifier: Modifier = Modifier,
    accentColor: Color = CareLogColors.Primary
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "Meal Timing (Optional)",
            style = MaterialTheme.typography.titleSmall,
            color = CareLogColors.OnSurfaceVariant
        )

        Spacer(modifier = Modifier.height(8.dp))

        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            MealTiming.entries.forEach { timing ->
                FilterChip(
                    selected = timing == selectedTiming,
                    onClick = { onTimingSelected(timing) },
                    label = {
                        Text(
                            text = timing.displayName,
                            style = MaterialTheme.typography.labelMedium
                        )
                    },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = accentColor,
                        selectedLabelColor = Color.White
                    )
                )
            }
        }
    }
}

enum class MealTiming(val displayName: String) {
    FASTING("Fasting"),
    BEFORE_MEAL("Before Meal"),
    AFTER_MEAL("After Meal")
}

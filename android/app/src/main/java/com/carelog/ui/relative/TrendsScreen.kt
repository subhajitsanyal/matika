package com.carelog.ui.relative

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.api.*
import com.carelog.ui.theme.CareLogColors
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/**
 * Trends view showing time-series charts for vitals.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrendsScreen(
    onNavigateBack: () -> Unit,
    viewModel: TrendsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Trends") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CareLogColors.Primary,
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
        ) {
            // Date range selector
            DateRangeSelector(
                selectedRange = uiState.selectedDateRange,
                onRangeSelected = { viewModel.setDateRange(it) }
            )

            // Vital type tabs
            VitalTypeTabs(
                selectedType = uiState.selectedVitalType,
                onTypeSelected = { viewModel.setVitalType(it) }
            )

            // Chart content
            if (uiState.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (uiState.observations.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        "No data for this period",
                        color = CareLogColors.OnSurfaceVariant
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    // Chart
                    item {
                        VitalChart(
                            observations = uiState.observations,
                            vitalType = uiState.selectedVitalType,
                            threshold = uiState.threshold
                        )
                    }

                    // Recent observations list
                    item {
                        Text(
                            "Recent Readings",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    items(uiState.observations.take(10)) { observation ->
                        ObservationListItem(observation = observation)
                    }
                }
            }
        }
    }
}

@Composable
private fun DateRangeSelector(
    selectedRange: DateRange,
    onRangeSelected: (DateRange) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        DateRange.entries.forEach { range ->
            FilterChip(
                selected = selectedRange == range,
                onClick = { onRangeSelected(range) },
                label = { Text(range.label) }
            )
        }
    }
}

@Composable
private fun VitalTypeTabs(
    selectedType: VitalType,
    onTypeSelected: (VitalType) -> Unit
) {
    ScrollableTabRow(
        selectedTabIndex = VitalType.entries.indexOf(selectedType),
        modifier = Modifier.fillMaxWidth(),
        edgePadding = 8.dp
    ) {
        VitalType.entries.forEach { type ->
            Tab(
                selected = selectedType == type,
                onClick = { onTypeSelected(type) },
                text = { Text(getVitalDisplayName(type)) }
            )
        }
    }
}

@Composable
private fun VitalChart(
    observations: List<VitalObservation>,
    vitalType: VitalType,
    threshold: VitalThreshold?,
    modifier: Modifier = Modifier
) {
    val chartColor = getVitalColor(vitalType)

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            // Chart header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    getVitalDisplayName(vitalType),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium
                )

                // Stats
                observations.lastOrNull()?.let { latest ->
                    Text(
                        "Latest: ${formatObservationValue(latest)}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = CareLogColors.OnSurfaceVariant
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Line chart
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp)
            ) {
                if (observations.isNotEmpty()) {
                    LineChart(
                        data = observations.map { it.value.toFloat() },
                        color = chartColor,
                        minThreshold = threshold?.minValue?.toFloat(),
                        maxThreshold = threshold?.maxValue?.toFloat(),
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }

            // Threshold legend
            threshold?.let {
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    it.minValue?.let { min ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .background(CareLogColors.Warning)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                "Min: ${min.toInt()}",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                    it.maxValue?.let { max ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .background(CareLogColors.Error)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                "Max: ${max.toInt()}",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LineChart(
    data: List<Float>,
    color: Color,
    minThreshold: Float?,
    maxThreshold: Float?,
    modifier: Modifier = Modifier
) {
    Canvas(modifier = modifier) {
        if (data.isEmpty()) return@Canvas

        val minValue = data.minOrNull() ?: 0f
        val maxValue = data.maxOrNull() ?: 100f
        val valueRange = (maxValue - minValue).coerceAtLeast(1f)

        val pointSpacing = size.width / (data.size - 1).coerceAtLeast(1)
        val padding = 8f

        // Draw threshold lines
        minThreshold?.let { min ->
            val y = size.height - ((min - minValue) / valueRange * (size.height - padding * 2)) - padding
            drawLine(
                color = CareLogColors.Warning.copy(alpha = 0.5f),
                start = Offset(0f, y),
                end = Offset(size.width, y),
                strokeWidth = 2f
            )
        }

        maxThreshold?.let { max ->
            val y = size.height - ((max - minValue) / valueRange * (size.height - padding * 2)) - padding
            drawLine(
                color = CareLogColors.Error.copy(alpha = 0.5f),
                start = Offset(0f, y),
                end = Offset(size.width, y),
                strokeWidth = 2f
            )
        }

        // Draw line chart
        val path = Path()
        data.forEachIndexed { index, value ->
            val x = index * pointSpacing
            val y = size.height - ((value - minValue) / valueRange * (size.height - padding * 2)) - padding

            if (index == 0) {
                path.moveTo(x, y)
            } else {
                path.lineTo(x, y)
            }
        }

        drawPath(
            path = path,
            color = color,
            style = Stroke(width = 3f)
        )

        // Draw data points
        data.forEachIndexed { index, value ->
            val x = index * pointSpacing
            val y = size.height - ((value - minValue) / valueRange * (size.height - padding * 2)) - padding

            drawCircle(
                color = color,
                radius = 6f,
                center = Offset(x, y)
            )
            drawCircle(
                color = Color.White,
                radius = 3f,
                center = Offset(x, y)
            )
        }
    }
}

@Composable
private fun ObservationListItem(observation: VitalObservation) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    formatObservationValue(observation),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                    color = getStatusColor(observation.status)
                )
                Text(
                    observation.performerName ?: "Unknown",
                    style = MaterialTheme.typography.bodySmall,
                    color = CareLogColors.OnSurfaceVariant
                )
            }

            Column(horizontalAlignment = Alignment.End) {
                Text(
                    formatDate(observation.timestamp),
                    style = MaterialTheme.typography.bodySmall,
                    color = CareLogColors.OnSurfaceVariant
                )
                Text(
                    formatTime(observation.timestamp),
                    style = MaterialTheme.typography.bodySmall,
                    color = CareLogColors.OnSurfaceVariant
                )
            }
        }
    }
}

// Helper functions

enum class DateRange(val label: String, val days: Int) {
    WEEK("7 Days", 7),
    MONTH("30 Days", 30),
    QUARTER("90 Days", 90)
}

private fun getVitalDisplayName(type: VitalType): String {
    return when (type) {
        VitalType.BLOOD_PRESSURE -> "Blood Pressure"
        VitalType.GLUCOSE -> "Glucose"
        VitalType.TEMPERATURE -> "Temperature"
        VitalType.WEIGHT -> "Weight"
        VitalType.PULSE -> "Pulse"
        VitalType.SPO2 -> "SpO2"
    }
}

private fun getVitalColor(type: VitalType): Color {
    return when (type) {
        VitalType.BLOOD_PRESSURE -> CareLogColors.BloodPressure
        VitalType.GLUCOSE -> CareLogColors.Glucose
        VitalType.TEMPERATURE -> CareLogColors.Temperature
        VitalType.WEIGHT -> CareLogColors.Weight
        VitalType.PULSE -> CareLogColors.Pulse
        VitalType.SPO2 -> CareLogColors.SpO2
    }
}

private fun getStatusColor(status: ThresholdStatus): Color {
    return when (status) {
        ThresholdStatus.NORMAL -> CareLogColors.Success
        ThresholdStatus.LOW, ThresholdStatus.HIGH -> CareLogColors.Warning
        ThresholdStatus.CRITICAL -> CareLogColors.Error
    }
}

private fun formatObservationValue(observation: VitalObservation): String {
    return when (observation.vitalType) {
        VitalType.BLOOD_PRESSURE -> {
            val systolic = observation.value.toInt()
            val diastolic = observation.secondaryValue?.toInt() ?: 0
            "$systolic/$diastolic ${observation.unit}"
        }
        VitalType.TEMPERATURE, VitalType.WEIGHT -> {
            String.format("%.1f %s", observation.value, observation.unit)
        }
        else -> "${observation.value.toInt()} ${observation.unit}"
    }
}

private fun formatDate(instant: Instant): String {
    val formatter = DateTimeFormatter.ofPattern("MMM d")
        .withZone(ZoneId.systemDefault())
    return formatter.format(instant)
}

private fun formatTime(instant: Instant): String {
    val formatter = DateTimeFormatter.ofPattern("h:mm a")
        .withZone(ZoneId.systemDefault())
    return formatter.format(instant)
}

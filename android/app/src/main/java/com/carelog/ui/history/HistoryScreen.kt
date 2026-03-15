package com.carelog.ui.history

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.fhir.client.ObservationType
import com.carelog.fhir.local.entities.SyncStatus
import com.carelog.ui.dashboard.VitalType
import com.carelog.ui.theme.CareLogColors
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * Vital history list screen.
 *
 * Chronological list showing: value, timestamp, recorder identity, sync status.
 * Filterable by vital type and date range.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("UNUSED_PARAMETER")
@Composable
fun HistoryScreen(
    onNavigateBack: () -> Unit,
    viewModel: HistoryViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("History") },
                actions = {
                    // Date filter
                    IconButton(onClick = { viewModel.toggleDateFilter() }) {
                        Icon(Icons.Default.DateRange, contentDescription = "Filter by date")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Vital type filter tabs
            VitalTypeFilterTabs(
                selectedType = uiState.selectedVitalType,
                onTypeSelected = { viewModel.selectVitalType(it) }
            )

            // Date range filter (if expanded)
            if (uiState.showDateFilter) {
                DateRangeFilter(
                    startDate = uiState.startDate,
                    endDate = uiState.endDate,
                    onStartDateSelected = { viewModel.setStartDate(it) },
                    onEndDateSelected = { viewModel.setEndDate(it) },
                    onClearFilter = { viewModel.clearDateFilter() }
                )
            }

            // Loading indicator
            if (uiState.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (uiState.entries.isEmpty()) {
                // Empty state
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.History,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = CareLogColors.OnSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "No history yet",
                            style = MaterialTheme.typography.titleMedium,
                            color = CareLogColors.OnSurfaceVariant
                        )
                        Text(
                            text = "Start logging your vitals",
                            style = MaterialTheme.typography.bodyMedium,
                            color = CareLogColors.OnSurfaceVariant
                        )
                    }
                }
            } else {
                // History list
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(uiState.entries) { entry ->
                        HistoryEntryCard(entry = entry)
                    }
                }
            }
        }
    }
}

/**
 * Filter tabs for vital types.
 */
@Composable
fun VitalTypeFilterTabs(
    selectedType: VitalType?,
    onTypeSelected: (VitalType?) -> Unit
) {
    ScrollableTabRow(
        selectedTabIndex = selectedType?.let { VitalType.entries.indexOf(it) + 1 } ?: 0,
        edgePadding = 16.dp,
        divider = {}
    ) {
        // "All" tab
        FilterChip(
            selected = selectedType == null,
            onClick = { onTypeSelected(null) },
            label = { Text("All") },
            modifier = Modifier.padding(horizontal = 4.dp)
        )

        // Vital type tabs (excluding UPLOAD and CHAT)
        listOf(
            VitalType.BLOOD_PRESSURE,
            VitalType.GLUCOSE,
            VitalType.TEMPERATURE,
            VitalType.WEIGHT,
            VitalType.PULSE,
            VitalType.SPO2
        ).forEach { type ->
            FilterChip(
                selected = selectedType == type,
                onClick = { onTypeSelected(type) },
                label = { Text(type.displayName) },
                modifier = Modifier.padding(horizontal = 4.dp),
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = getVitalColor(type)
                )
            )
        }
    }
}

/**
 * Date range filter section.
 */
@Suppress("UNUSED_PARAMETER")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateRangeFilter(
    startDate: LocalDate?,
    endDate: LocalDate?,
    onStartDateSelected: (LocalDate) -> Unit,
    onEndDateSelected: (LocalDate) -> Unit,
    onClearFilter: () -> Unit
) {
    var showStartPicker by remember { mutableStateOf(false) }
    var showEndPicker by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Start date
            OutlinedButton(onClick = { showStartPicker = true }) {
                Text(
                    startDate?.format(DateTimeFormatter.ofPattern("MMM d, yyyy"))
                        ?: "Start Date"
                )
            }

            Text("to", color = CareLogColors.OnSurfaceVariant)

            // End date
            OutlinedButton(onClick = { showEndPicker = true }) {
                Text(
                    endDate?.format(DateTimeFormatter.ofPattern("MMM d, yyyy"))
                        ?: "End Date"
                )
            }

            // Clear button
            if (startDate != null || endDate != null) {
                IconButton(onClick = onClearFilter) {
                    Icon(Icons.Default.Clear, contentDescription = "Clear filter")
                }
            }
        }
    }

    // Date pickers would be implemented here
    // Using DatePickerDialog from Material3
}

/**
 * Single history entry card.
 */
@Composable
fun HistoryEntryCard(entry: HistoryEntry) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Vital type indicator
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(getVitalColor(entry.vitalType)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = getVitalIcon(entry.vitalType),
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(24.dp)
                )
            }

            Spacer(modifier = Modifier.width(16.dp))

            // Value and details
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = entry.displayValue,
                    style = MaterialTheme.typography.titleLarge
                )
                Text(
                    text = entry.vitalType.displayName,
                    style = MaterialTheme.typography.bodyMedium,
                    color = CareLogColors.OnSurfaceVariant
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = formatDateTime(entry.timestamp),
                        style = MaterialTheme.typography.bodySmall,
                        color = CareLogColors.OnSurfaceVariant
                    )
                    entry.performerName?.let { performer ->
                        Text(
                            text = " • $performer",
                            style = MaterialTheme.typography.bodySmall,
                            color = CareLogColors.OnSurfaceVariant
                        )
                    }
                }
            }

            // Sync status indicator
            SyncStatusIndicator(status = entry.syncStatus)
        }
    }
}

/**
 * Sync status indicator icon.
 */
@Composable
fun SyncStatusIndicator(status: SyncStatus) {
    val (icon, color, description) = when (status) {
        SyncStatus.SYNCED -> Triple(Icons.Default.CloudDone, CareLogColors.Success, "Synced")
        SyncStatus.PENDING -> Triple(Icons.Default.CloudUpload, CareLogColors.Warning, "Pending sync")
        SyncStatus.FAILED -> Triple(Icons.Default.CloudOff, CareLogColors.Error, "Sync failed")
        SyncStatus.MODIFIED -> Triple(Icons.Default.Sync, CareLogColors.Info, "Modified")
    }

    Icon(
        imageVector = icon,
        contentDescription = description,
        tint = color,
        modifier = Modifier.size(24.dp)
    )
}

// Helper functions
private fun getVitalColor(type: VitalType): Color {
    return when (type) {
        VitalType.BLOOD_PRESSURE -> CareLogColors.BloodPressure
        VitalType.GLUCOSE -> CareLogColors.Glucose
        VitalType.TEMPERATURE -> CareLogColors.Temperature
        VitalType.WEIGHT -> CareLogColors.Weight
        VitalType.PULSE -> CareLogColors.Pulse
        VitalType.SPO2 -> CareLogColors.SpO2
        else -> CareLogColors.Primary
    }
}

private fun getVitalIcon(type: VitalType) = when (type) {
    VitalType.BLOOD_PRESSURE -> Icons.Default.Favorite
    VitalType.GLUCOSE -> Icons.Default.Bloodtype
    VitalType.TEMPERATURE -> Icons.Default.Thermostat
    VitalType.WEIGHT -> Icons.Default.MonitorWeight
    VitalType.PULSE -> Icons.Default.MonitorHeart
    VitalType.SPO2 -> Icons.Default.Air
    else -> Icons.Default.HealthAndSafety
}

private fun formatDateTime(instant: Instant): String {
    val localDateTime = instant.atZone(ZoneId.systemDefault()).toLocalDateTime()
    val dateFormatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
    return localDateTime.format(dateFormatter)
}

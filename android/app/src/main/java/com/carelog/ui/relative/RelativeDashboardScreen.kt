package com.carelog.ui.relative

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.api.*
import com.carelog.ui.theme.CareLogColors
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Relative dashboard showing patient vitals summary.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RelativeDashboardScreen(
    onNavigateToTrends: () -> Unit,
    onNavigateToAlerts: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToCareTeam: () -> Unit,
    viewModel: RelativeDashboardViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("CareLog")
                        uiState.patientSummary?.let {
                            Text(
                                "Monitoring: ${it.patientName}",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                },
                actions = {
                    // Alert badge
                    BadgedBox(
                        badge = {
                            uiState.patientSummary?.unreadAlertCount?.let { count ->
                                if (count > 0) {
                                    Badge { Text(count.toString()) }
                                }
                            }
                        }
                    ) {
                        IconButton(onClick = onNavigateToAlerts) {
                            Icon(Icons.Default.Notifications, contentDescription = "Alerts")
                        }
                    }

                    IconButton(onClick = onNavigateToSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CareLogColors.Primary,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White
                )
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    icon = { Icon(Icons.Default.Home, contentDescription = "Home") },
                    label = { Text("Home") },
                    selected = true,
                    onClick = { }
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Default.ShowChart, contentDescription = "Trends") },
                    label = { Text("Trends") },
                    selected = false,
                    onClick = onNavigateToTrends
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Default.Group, contentDescription = "Care Team") },
                    label = { Text("Team") },
                    selected = false,
                    onClick = onNavigateToCareTeam
                )
            }
        }
    ) { paddingValues ->
        PullToRefreshBox(
            isRefreshing = uiState.isLoading,
            onRefresh = { viewModel.refresh() },
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                uiState.error != null -> {
                    ErrorContent(
                        message = uiState.error!!,
                        onRetry = { viewModel.refresh() }
                    )
                }
                uiState.patientSummary == null && !uiState.isLoading -> {
                    EmptyContent()
                }
                else -> {
                    DashboardContent(
                        summary = uiState.patientSummary,
                        onVitalClick = { /* Navigate to vital detail */ }
                    )
                }
            }
        }
    }
}

@Composable
private fun DashboardContent(
    summary: PatientSummary?,
    onVitalClick: (VitalType) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Last activity header
        summary?.lastActivityTime?.let { lastActivity ->
            item {
                LastActivityCard(lastActivity = lastActivity)
            }
        }

        // Vital summary cards
        summary?.latestVitals?.let { vitals ->
            items(VitalType.entries.toList()) { vitalType ->
                val vital = vitals[vitalType]
                VitalSummaryCard(
                    vitalType = vitalType,
                    vital = vital,
                    onClick = { onVitalClick(vitalType) }
                )
            }
        }
    }
}

@Composable
private fun LastActivityCard(lastActivity: Instant) {
    val timeSince = Duration.between(lastActivity, Instant.now())
    val timeAgoText = when {
        timeSince.toMinutes() < 1 -> "Just now"
        timeSince.toMinutes() < 60 -> "${timeSince.toMinutes()} min ago"
        timeSince.toHours() < 24 -> "${timeSince.toHours()} hours ago"
        else -> "${timeSince.toDays()} days ago"
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = CareLogColors.Primary.copy(alpha = 0.1f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.AccessTime,
                contentDescription = null,
                tint = CareLogColors.Primary
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column {
                Text(
                    "Last Activity",
                    style = MaterialTheme.typography.labelMedium,
                    color = CareLogColors.OnSurfaceVariant
                )
                Text(
                    timeAgoText,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}

@Composable
private fun VitalSummaryCard(
    vitalType: VitalType,
    vital: LatestVital?,
    onClick: () -> Unit
) {
    val vitalInfo = getVitalInfo(vitalType)
    val statusColor = vital?.status?.let { getStatusColor(it) } ?: CareLogColors.OnSurfaceVariant

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Icon
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(vitalInfo.color.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    vitalInfo.icon,
                    contentDescription = null,
                    modifier = Modifier.size(28.dp),
                    tint = vitalInfo.color
                )
            }

            Spacer(modifier = Modifier.width(16.dp))

            // Content
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    vitalInfo.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium
                )

                if (vital != null) {
                    Row(
                        verticalAlignment = Alignment.Bottom
                    ) {
                        Text(
                            formatVitalValue(vitalType, vital),
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold,
                            color = statusColor
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            vital.unit,
                            style = MaterialTheme.typography.bodyMedium,
                            color = CareLogColors.OnSurfaceVariant
                        )
                    }

                    Text(
                        formatTimestamp(vital.timestamp),
                        style = MaterialTheme.typography.bodySmall,
                        color = CareLogColors.OnSurfaceVariant
                    )
                } else {
                    Text(
                        "No data",
                        style = MaterialTheme.typography.bodyMedium,
                        color = CareLogColors.OnSurfaceVariant
                    )
                }
            }

            // Status indicator
            if (vital != null) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(statusColor)
                )
            }

            Spacer(modifier = Modifier.width(8.dp))

            Icon(
                Icons.Default.ChevronRight,
                contentDescription = "View details",
                tint = CareLogColors.OnSurfaceVariant
            )
        }
    }
}

@Composable
private fun ErrorContent(
    message: String,
    onRetry: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.Error,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = CareLogColors.Error
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            "Something went wrong",
            style = MaterialTheme.typography.titleLarge
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = CareLogColors.OnSurfaceVariant
        )
        Spacer(modifier = Modifier.height(24.dp))
        Button(onClick = onRetry) {
            Text("Retry")
        }
    }
}

@Composable
private fun EmptyContent() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.Person,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = CareLogColors.OnSurfaceVariant
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            "No patient data",
            style = MaterialTheme.typography.titleLarge
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            "Patient vital data will appear here once logged.",
            style = MaterialTheme.typography.bodyMedium,
            color = CareLogColors.OnSurfaceVariant
        )
    }
}

// Helper functions

private data class VitalInfo(
    val name: String,
    val icon: ImageVector,
    val color: Color
)

private fun getVitalInfo(vitalType: VitalType): VitalInfo {
    return when (vitalType) {
        VitalType.BLOOD_PRESSURE -> VitalInfo("Blood Pressure", Icons.Default.Favorite, CareLogColors.BloodPressure)
        VitalType.GLUCOSE -> VitalInfo("Glucose", Icons.Default.WaterDrop, CareLogColors.Glucose)
        VitalType.TEMPERATURE -> VitalInfo("Temperature", Icons.Default.Thermostat, CareLogColors.Temperature)
        VitalType.WEIGHT -> VitalInfo("Weight", Icons.Default.Scale, CareLogColors.Weight)
        VitalType.PULSE -> VitalInfo("Pulse", Icons.Default.MonitorHeart, CareLogColors.Pulse)
        VitalType.SPO2 -> VitalInfo("SpO2", Icons.Default.Air, CareLogColors.SpO2)
    }
}

private fun getStatusColor(status: ThresholdStatus): Color {
    return when (status) {
        ThresholdStatus.NORMAL -> CareLogColors.Success
        ThresholdStatus.LOW -> CareLogColors.Warning
        ThresholdStatus.HIGH -> CareLogColors.Warning
        ThresholdStatus.CRITICAL -> CareLogColors.Error
    }
}

private fun formatVitalValue(vitalType: VitalType, vital: LatestVital): String {
    return when (vitalType) {
        VitalType.BLOOD_PRESSURE -> {
            val systolic = vital.value.toInt()
            val diastolic = vital.secondaryValue?.toInt() ?: 0
            "$systolic/$diastolic"
        }
        VitalType.TEMPERATURE -> String.format("%.1f", vital.value)
        VitalType.WEIGHT -> String.format("%.1f", vital.value)
        else -> vital.value.toInt().toString()
    }
}

private fun formatTimestamp(timestamp: Instant): String {
    val formatter = DateTimeFormatter.ofPattern("MMM d, h:mm a")
        .withZone(ZoneId.systemDefault())
    return formatter.format(timestamp)
}

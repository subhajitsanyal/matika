package com.carelog.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.ui.theme.CareLogColors

/**
 * Patient dashboard screen.
 *
 * Large-button grid layout with 6 vitals + media upload + LLM placeholder.
 * Designed for accessibility with 72dp+ touch targets and high contrast.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    onNavigateToVital: (VitalType) -> Unit,
    onNavigateToUpload: () -> Unit,
    onNavigateToChat: () -> Unit,
    onNavigateToHistory: () -> Unit,
    onNavigateToSettings: () -> Unit,
    viewModel: DashboardViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedTab by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "CareLog",
                            style = MaterialTheme.typography.headlineSmall
                        )
                        uiState.patientName?.let {
                            Text(
                                text = it,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                actions = {
                    // Sync status indicator
                    if (uiState.pendingSyncCount > 0) {
                        Badge(
                            containerColor = CareLogColors.Warning
                        ) {
                            Text("${uiState.pendingSyncCount}")
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                }
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    icon = { Icon(Icons.Default.Home, contentDescription = "Home") },
                    label = { Text("Home") },
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 }
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Default.Timeline, contentDescription = "History") },
                    label = { Text("History") },
                    selected = selectedTab == 1,
                    onClick = {
                        selectedTab = 1
                        onNavigateToHistory()
                    }
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Default.Notifications, contentDescription = "Alerts") },
                    label = { Text("Alerts") },
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 }
                )
            }
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Missed reminder banner
            uiState.missedReminder?.let { reminder ->
                MissedReminderBanner(
                    vitalType = reminder,
                    onDismiss = { viewModel.dismissReminder() },
                    onLogNow = { onNavigateToVital(reminder) }
                )
            }

            // Vital buttons grid
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(dashboardItems) { item ->
                    VitalButton(
                        item = item,
                        lastValue = uiState.lastValues[item.vitalType],
                        onClick = {
                            when (item.vitalType) {
                                VitalType.UPLOAD -> onNavigateToUpload()
                                VitalType.CHAT -> onNavigateToChat()
                                else -> onNavigateToVital(item.vitalType)
                            }
                        }
                    )
                }
            }
        }
    }
}

/**
 * Missed reminder banner shown when a vital logging window has lapsed.
 */
@Composable
fun MissedReminderBanner(
    vitalType: VitalType,
    onDismiss: () -> Unit,
    onLogNow: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = CareLogColors.Warning.copy(alpha = 0.15f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Warning,
                contentDescription = null,
                tint = CareLogColors.Warning,
                modifier = Modifier.size(32.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Reminder",
                    style = MaterialTheme.typography.titleMedium,
                    color = CareLogColors.Warning
                )
                Text(
                    text = "Time to log your ${vitalType.displayName}",
                    style = MaterialTheme.typography.bodyMedium
                )
            }
            TextButton(onClick = onLogNow) {
                Text("Log Now", color = CareLogColors.Primary)
            }
            IconButton(onClick = onDismiss) {
                Icon(Icons.Default.Close, contentDescription = "Dismiss")
            }
        }
    }
}

/**
 * Large vital button for dashboard grid.
 * Minimum 72dp touch target for accessibility.
 */
@Composable
fun VitalButton(
    item: DashboardItem,
    lastValue: String?,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = item.backgroundColor.copy(alpha = 0.12f)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Icon
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(item.backgroundColor),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = item.icon,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(36.dp)
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Label
            Text(
                text = item.label,
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurface
            )

            // Last value (if available)
            lastValue?.let {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * Dashboard item configuration.
 */
data class DashboardItem(
    val vitalType: VitalType,
    val label: String,
    val icon: ImageVector,
    val backgroundColor: Color
)

/**
 * Types of vitals and actions on the dashboard.
 */
enum class VitalType(val displayName: String) {
    BLOOD_PRESSURE("Blood Pressure"),
    GLUCOSE("Blood Glucose"),
    TEMPERATURE("Temperature"),
    WEIGHT("Weight"),
    PULSE("Heart Rate"),
    SPO2("Oxygen"),
    UPLOAD("Upload"),
    CHAT("Chat")
}

/**
 * Dashboard items configuration.
 */
private val dashboardItems = listOf(
    DashboardItem(
        vitalType = VitalType.BLOOD_PRESSURE,
        label = "Blood\nPressure",
        icon = Icons.Default.Favorite,
        backgroundColor = CareLogColors.BloodPressure
    ),
    DashboardItem(
        vitalType = VitalType.GLUCOSE,
        label = "Blood\nGlucose",
        icon = Icons.Default.Bloodtype,
        backgroundColor = CareLogColors.Glucose
    ),
    DashboardItem(
        vitalType = VitalType.TEMPERATURE,
        label = "Temperature",
        icon = Icons.Default.Thermostat,
        backgroundColor = CareLogColors.Temperature
    ),
    DashboardItem(
        vitalType = VitalType.WEIGHT,
        label = "Weight",
        icon = Icons.Default.MonitorWeight,
        backgroundColor = CareLogColors.Weight
    ),
    DashboardItem(
        vitalType = VitalType.PULSE,
        label = "Heart Rate",
        icon = Icons.Default.MonitorHeart,
        backgroundColor = CareLogColors.Pulse
    ),
    DashboardItem(
        vitalType = VitalType.SPO2,
        label = "Oxygen\nLevel",
        icon = Icons.Default.Air,
        backgroundColor = CareLogColors.SpO2
    ),
    DashboardItem(
        vitalType = VitalType.UPLOAD,
        label = "Upload\nMedia",
        icon = Icons.Default.Upload,
        backgroundColor = CareLogColors.Upload
    ),
    DashboardItem(
        vitalType = VitalType.CHAT,
        label = "Health\nChat",
        icon = Icons.Default.Chat,
        backgroundColor = CareLogColors.Chat
    )
)

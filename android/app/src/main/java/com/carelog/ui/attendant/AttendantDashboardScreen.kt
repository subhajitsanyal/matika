package com.carelog.ui.attendant

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.NoteAdd
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import com.carelog.auth.AttendantInfo
import com.carelog.auth.AttendantSessionManager
import com.carelog.ui.theme.CareLogColors
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/**
 * Attendant dashboard screen with identity context banner.
 * Same UX as patient dashboard but shows who is logged in.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttendantDashboardScreen(
    onNavigateToBloodPressure: () -> Unit,
    onNavigateToGlucose: () -> Unit,
    onNavigateToTemperature: () -> Unit,
    onNavigateToWeight: () -> Unit,
    onNavigateToPulse: () -> Unit,
    onNavigateToSpO2: () -> Unit,
    onNavigateToUpload: () -> Unit,
    onNavigateToNotes: () -> Unit,
    onNavigateToHistory: () -> Unit,
    onSwitchToPatient: () -> Unit,
    viewModel: AttendantDashboardViewModel = hiltViewModel()
) {
    val attendantInfo by viewModel.currentAttendant.collectAsState()
    var showSwitchDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Log Vitals") },
                actions = {
                    IconButton(onClick = onNavigateToHistory) {
                        Icon(Icons.Default.History, contentDescription = "History")
                    }
                    IconButton(onClick = { showSwitchDialog = true }) {
                        Icon(Icons.Default.SwitchAccount, contentDescription = "Switch to Patient")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Attendant identity banner
            AttendantBanner(
                attendantName = attendantInfo?.name ?: "Attendant",
                onSwitchClick = { showSwitchDialog = true }
            )

            // Vital buttons grid
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.weight(1f)
            ) {
                items(vitalButtons) { button ->
                    VitalButton(
                        title = button.title,
                        icon = button.icon,
                        color = button.color,
                        onClick = {
                            when (button.type) {
                                VitalType.BLOOD_PRESSURE -> onNavigateToBloodPressure()
                                VitalType.GLUCOSE -> onNavigateToGlucose()
                                VitalType.TEMPERATURE -> onNavigateToTemperature()
                                VitalType.WEIGHT -> onNavigateToWeight()
                                VitalType.PULSE -> onNavigateToPulse()
                                VitalType.SPO2 -> onNavigateToSpO2()
                            }
                        }
                    )
                }

                // Upload button
                item {
                    VitalButton(
                        title = "Upload",
                        icon = Icons.Default.Upload,
                        color = CareLogColors.Primary,
                        onClick = onNavigateToUpload
                    )
                }

                // Notes button (attendant-specific)
                item {
                    VitalButton(
                        title = "Add Note",
                        icon = Icons.AutoMirrored.Filled.NoteAdd,
                        color = CareLogColors.Secondary,
                        onClick = onNavigateToNotes
                    )
                }
            }
        }
    }

    // Switch to patient confirmation dialog
    if (showSwitchDialog) {
        AlertDialog(
            onDismissRequest = { showSwitchDialog = false },
            title = { Text("Switch to Patient Mode") },
            text = {
                Text("Are you sure you want to switch back to patient mode? You can log in again as attendant later.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.logoutAttendant()
                        showSwitchDialog = false
                        onSwitchToPatient()
                    }
                ) {
                    Text("Switch")
                }
            },
            dismissButton = {
                TextButton(onClick = { showSwitchDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun AttendantBanner(
    attendantName: String,
    onSwitchClick: () -> Unit
) {
    Surface(
        color = CareLogColors.Primary.copy(alpha = 0.1f),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Badge,
                    contentDescription = null,
                    tint = CareLogColors.Primary
                )
                Column {
                    Text(
                        text = "Logged in as Attendant",
                        style = MaterialTheme.typography.labelSmall,
                        color = CareLogColors.Primary
                    )
                    Text(
                        text = attendantName,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            TextButton(onClick = onSwitchClick) {
                Text("Switch to Patient")
            }
        }
    }
}

@Composable
private fun VitalButton(
    title: String,
    icon: ImageVector,
    color: Color,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick),
        color = color.copy(alpha = 0.1f),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = color
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center
            )
        }
    }
}

private enum class VitalType {
    BLOOD_PRESSURE, GLUCOSE, TEMPERATURE, WEIGHT, PULSE, SPO2
}

private data class VitalButtonData(
    val type: VitalType,
    val title: String,
    val icon: ImageVector,
    val color: Color
)

private val vitalButtons = listOf(
    VitalButtonData(VitalType.BLOOD_PRESSURE, "Blood Pressure", Icons.Default.Favorite, CareLogColors.BloodPressure),
    VitalButtonData(VitalType.GLUCOSE, "Glucose", Icons.Default.Bloodtype, CareLogColors.Glucose),
    VitalButtonData(VitalType.TEMPERATURE, "Temperature", Icons.Default.Thermostat, CareLogColors.Temperature),
    VitalButtonData(VitalType.WEIGHT, "Weight", Icons.Default.Scale, CareLogColors.Weight),
    VitalButtonData(VitalType.PULSE, "Pulse", Icons.Default.MonitorHeart, CareLogColors.Pulse),
    VitalButtonData(VitalType.SPO2, "SpO2", Icons.Default.Air, CareLogColors.SpO2),
)

/**
 * ViewModel for attendant dashboard.
 */
@HiltViewModel
class AttendantDashboardViewModel @Inject constructor(
    private val attendantSessionManager: AttendantSessionManager
) : ViewModel() {

    val currentAttendant: StateFlow<AttendantInfo?> = attendantSessionManager.currentAttendant

    fun logoutAttendant() {
        attendantSessionManager.logoutAttendant()
    }
}

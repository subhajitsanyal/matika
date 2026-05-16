package com.carelog.dashboard.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Air
import androidx.compose.material.icons.filled.Bloodtype
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MonitorHeart
import androidx.compose.material.icons.filled.MonitorWeight
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Thermostat
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import com.carelog.discovery.OverallStatus
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.navigation.NavController
import com.carelog.discovery.HealthCheckService
import com.carelog.discovery.ModelHealthStatus
import com.carelog.ui.NavResults
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

/**
 * Summary of the last completed conversation session.
 */
data class LastSessionSummary(
    val date: String,
    val valuesCaptured: Int,
    val totalParameters: Int,
    val status: String
)

/**
 * Patient home screen with model status banner, last session card,
 * and "Start Conversation" button.
 *
 * Features:
 * - Pull-to-refresh for health status updates
 * - Last session summary card with captured values
 * - Animated status transitions
 * - Graceful degradation messages
 * - Full accessibility support
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientHomeScreen(
    onStartConversation: () -> Unit = {},
    onNavigateToSettings: () -> Unit = {},
    onNavigateToBloodPressure: () -> Unit = {},
    onNavigateToGlucose: () -> Unit = {},
    onNavigateToTemperature: () -> Unit = {},
    onNavigateToWeight: () -> Unit = {},
    onNavigateToPulse: () -> Unit = {},
    onNavigateToSpO2: () -> Unit = {},
    /**
     * PR-3 nav-result bridge: when a manual-vital screen (currently
     * BP only — Pulse/SpO2/Sugar/Temperature/Weight follow-up) finishes
     * a save, it writes a `vital_saved=<label>` to this screen's
     * SavedStateHandle just before popping. Optional so previews and
     * tests still compile.
     */
    navController: NavController? = null,
    modifier: Modifier = Modifier,
    viewModel: PatientHomeViewModel = hiltViewModel()
) {
    val healthStatus by viewModel.healthStatus.collectAsState()
    val lastSession by viewModel.lastSessionSummary.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()

    val degradation = computeDegradationState(healthStatus)
    val isOffline = healthStatus.overallStatus == OverallStatus.OFFLINE

    val snackbarHostState = remember { SnackbarHostState() }

    // PR-3 — vital_saved nav-result bridge. When a manual-vital screen
    // pops back with a saved value, surface it as a Snackbar then clear
    // the key so a rotation/recompose doesn't re-show the same message.
    val savedStateHandle = navController?.currentBackStackEntry?.savedStateHandle
    val vitalSaved by (savedStateHandle?.getStateFlow<String?>(NavResults.VITAL_SAVED, null)
        ?: remember { kotlinx.coroutines.flow.MutableStateFlow<String?>(null) })
        .collectAsState()
    LaunchedEffect(vitalSaved) {
        vitalSaved?.let { label ->
            snackbarHostState.showSnackbar("Saved $label")
            savedStateHandle?.set<String?>(NavResults.VITAL_SAVED, null)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("CareLog") },
                actions = {
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { viewModel.onRefresh() },
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            Column(
                modifier = modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.Top,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Model status banner at top (only when not offline)
                if (!isOffline) {
                    ModelStatusBanner(healthStatus = healthStatus)
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Welcome message
                Text(
                    text = "Welcome",
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.semantics { heading() }
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = if (isOffline) {
                        "Set up your CareLog device in Settings to start voice check-ins"
                    } else {
                        "Tap below to start your daily health check-in"
                    },
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )

                if (isOffline) {
                    Spacer(modifier = Modifier.height(16.dp))
                    OutlinedButton(onClick = onNavigateToSettings) {
                        Icon(Icons.Default.Settings, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.size(8.dp))
                        Text("Open Settings")
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Last session summary card
                AnimatedVisibility(
                    visible = lastSession != null,
                    enter = expandVertically() + fadeIn(),
                    exit = shrinkVertically() + fadeOut()
                ) {
                    lastSession?.let { session ->
                        LastSessionCard(
                            summary = session,
                            modifier = Modifier.padding(bottom = 16.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(32.dp))

                // Start Conversation button with animated color
                val buttonColor by animateColorAsState(
                    targetValue = if (degradation.canConverse) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant
                    },
                    label = "button_color"
                )

                Button(
                    onClick = onStartConversation,
                    enabled = degradation.canConverse,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(72.dp)
                        .testTag("patient_home_start_conversation")
                        .semantics {
                            contentDescription = if (degradation.canConverse) {
                                "Start conversation. Begin your daily health check-in."
                            } else {
                                "Conversation unavailable. CareLog device services are not ready."
                            }
                        },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = buttonColor,
                        disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant
                    )
                ) {
                    Icon(
                        imageVector = Icons.Filled.Mic,
                        contentDescription = null,
                        modifier = Modifier.size(28.dp)
                    )
                    Spacer(modifier = Modifier.size(12.dp))
                    Text(
                        text = if (degradation.canConverse) {
                            "Start Conversation"
                        } else {
                            "Conversation Unavailable"
                        },
                        style = MaterialTheme.typography.titleMedium
                    )
                }

                // Hint text when in text-only mode
                AnimatedVisibility(
                    visible = degradation.canConverse && !degradation.ttsAvailable,
                    enter = fadeIn(),
                    exit = fadeOut()
                ) {
                    Text(
                        text = "Voice playback unavailable \u2014 text responses only",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }

                // Vision unavailable hint
                AnimatedVisibility(
                    visible = degradation.canConverse && !degradation.visionAvailable,
                    enter = fadeIn(),
                    exit = fadeOut()
                ) {
                    Text(
                        text = "Photo reading unavailable",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }

                Spacer(modifier = Modifier.height(32.dp))

                // F4 — manual-entry tiles for the six v1 vital screens.
                // Conversation-first remains the primary CTA; the tiles
                // are a secondary path for patients who prefer typed
                // entry or are offline. testTags `vital_tile_<param>`
                // are the entry points for PT-V2-15..20 + EDGE-V2-14.
                ManualVitalsGrid(
                    onNavigateToBloodPressure = onNavigateToBloodPressure,
                    onNavigateToGlucose = onNavigateToGlucose,
                    onNavigateToTemperature = onNavigateToTemperature,
                    onNavigateToWeight = onNavigateToWeight,
                    onNavigateToPulse = onNavigateToPulse,
                    onNavigateToSpO2 = onNavigateToSpO2,
                )

                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun ManualVitalsGrid(
    onNavigateToBloodPressure: () -> Unit,
    onNavigateToGlucose: () -> Unit,
    onNavigateToTemperature: () -> Unit,
    onNavigateToWeight: () -> Unit,
    onNavigateToPulse: () -> Unit,
    onNavigateToSpO2: () -> Unit,
) {
    Text(
        text = "Or log manually",
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 4.dp, bottom = 12.dp),
    )

    // Three rows × two tiles. Pairs chosen to keep related vitals
    // adjacent: BP/Glucose (everyday), Temperature/Weight (slower
    // cadence), Pulse/SpO2 (cardio-resp pair).
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        VitalTile(
            label = "BP",
            icon = Icons.Filled.MonitorHeart,
            testTagId = "vital_tile_blood_pressure",
            onClick = onNavigateToBloodPressure,
            modifier = Modifier.weight(1f),
        )
        VitalTile(
            label = "Sugar",
            icon = Icons.Filled.Bloodtype,
            testTagId = "vital_tile_glucose",
            onClick = onNavigateToGlucose,
            modifier = Modifier.weight(1f),
        )
    }

    Spacer(modifier = Modifier.height(12.dp))

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        VitalTile(
            label = "Temperature",
            icon = Icons.Filled.Thermostat,
            testTagId = "vital_tile_temperature",
            onClick = onNavigateToTemperature,
            modifier = Modifier.weight(1f),
        )
        VitalTile(
            label = "Weight",
            icon = Icons.Filled.MonitorWeight,
            testTagId = "vital_tile_weight",
            onClick = onNavigateToWeight,
            modifier = Modifier.weight(1f),
        )
    }

    Spacer(modifier = Modifier.height(12.dp))

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        VitalTile(
            label = "Pulse",
            icon = Icons.Filled.FavoriteBorder,
            testTagId = "vital_tile_pulse",
            onClick = onNavigateToPulse,
            modifier = Modifier.weight(1f),
        )
        VitalTile(
            label = "SpO2",
            icon = Icons.Filled.Air,
            testTagId = "vital_tile_spo2",
            onClick = onNavigateToSpO2,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun VitalTile(
    label: String,
    icon: ImageVector,
    testTagId: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        onClick = onClick,
        modifier = modifier
            .height(96.dp)
            .testTag(testTagId)
            .semantics { contentDescription = "Log $label manually" },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(12.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(28.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/**
 * Card showing a summary of the last completed conversation session.
 *
 * Displays the date, number of values captured vs total parameters,
 * and the session completion status.
 */
@Composable
private fun LastSessionCard(
    summary: LastSessionSummary,
    modifier: Modifier = Modifier
) {
    val isComplete = summary.valuesCaptured == summary.totalParameters
    val statusColor = if (isComplete) Color(0xFF4CAF50) else Color(0xFFFFC107)

    Card(
        modifier = modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = "Last session on ${summary.date}. " +
                    "${summary.valuesCaptured} of ${summary.totalParameters} values captured. " +
                    "Status: ${summary.status}."
            },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Text(
                text = "Last Session",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface
            )

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Filled.Schedule,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp)
                )
                Text(
                    text = summary.date,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.height(8.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Filled.CheckCircle,
                        contentDescription = null,
                        tint = statusColor,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "${summary.valuesCaptured}/${summary.totalParameters} values captured",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }

                Text(
                    text = summary.status,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = statusColor
                )
            }
        }
    }
}

@HiltViewModel
class PatientHomeViewModel @Inject constructor(
    private val healthCheckService: HealthCheckService
) : ViewModel() {
    val healthStatus = healthCheckService.healthStatus

    private val _lastSessionSummary = MutableStateFlow<LastSessionSummary?>(null)
    val lastSessionSummary: StateFlow<LastSessionSummary?> = _lastSessionSummary.asStateFlow()

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    /**
     * Refresh health status and last session data.
     */
    fun onRefresh() {
        _isRefreshing.value = true
        // Health check service auto-polls; just trigger a re-evaluation
        // In a real implementation this would also fetch the last session from the API
        _isRefreshing.value = false
    }

    /**
     * Update the last session summary after a session completes.
     */
    fun updateLastSession(summary: LastSessionSummary) {
        _lastSessionSummary.value = summary
    }
}

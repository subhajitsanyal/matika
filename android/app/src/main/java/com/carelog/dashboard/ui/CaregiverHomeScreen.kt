package com.carelog.dashboard.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ShowChart
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Warning
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.dashboard.CaregiverDashboardViewModel
import com.carelog.network.PatientListItem

/**
 * Caregiver home screen with model status banner, patient cards,
 * and navigation to onboarding, logs, and alerts.
 *
 * Features:
 * - Alert badge count on patient cards with color-coded urgency
 * - Smooth spring-based expand/collapse animations
 * - Pull-to-refresh for patient list and health status
 * - Full accessibility support with descriptive labels
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CaregiverHomeScreen(
    onNavigateToOnboarding: () -> Unit = {},
    /**
     * F23 — voice patient onboarding FAB callback. The route's session
     * id is minted by the navigator before this composable invokes the
     * callback, so all this side has to do is fire it.
     */
    onNavigateToPatientVoiceOnboarding: () -> Unit = {},
    onNavigateToPatientLogs: (patientId: String) -> Unit = {},
    onNavigateToAlerts: (patientId: String) -> Unit = {},
    onNavigateToSettings: () -> Unit = {},
    onNavigateToThresholds: () -> Unit = {},
    onNavigateToTrends: () -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: CaregiverDashboardViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.errorMessage) {
        uiState.errorMessage?.let { message ->
            snackbarHostState.showSnackbar(message)
            viewModel.dismissError()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "CareLog",
                        modifier = Modifier.semantics { heading() }
                    )
                },
                actions = {
                    IconButton(
                        onClick = onNavigateToSettings,
                        modifier = Modifier.semantics {
                            contentDescription = "Open settings"
                        }
                    ) {
                        Icon(Icons.Default.Settings, contentDescription = null)
                    }
                }
            )
        },
        floatingActionButton = {
            // F23 — two FABs stacked vertically. Voice-driven onboarding
            // sits on top (primary v2 path for caregivers); the existing
            // form-based onboarding sits beneath it. Tests target each
            // testTag directly so reordering is safe.
            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                ExtendedFloatingActionButton(
                    onClick = onNavigateToPatientVoiceOnboarding,
                    icon = {
                        Icon(Icons.Default.Mic, contentDescription = null)
                    },
                    text = { Text("Add Patient via Conversation") },
                    modifier = Modifier
                        .testTag("add_patient_voice_fab")
                        .semantics {
                            contentDescription = "Add a new patient through a voice conversation"
                        }
                )
                ExtendedFloatingActionButton(
                    onClick = onNavigateToOnboarding,
                    icon = {
                        Icon(Icons.Default.PersonAdd, contentDescription = null)
                    },
                    text = { Text("Add Patient") },
                    modifier = Modifier
                        .testTag("onboard_patient_fab")
                        .semantics {
                            contentDescription = "Onboard a new patient"
                        }
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        modifier = modifier
    ) { paddingValues ->
        PullToRefreshBox(
            isRefreshing = uiState.isRefreshing,
            onRefresh = { viewModel.onRefresh() },
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item(key = "header") {
                    Text(
                        text = "Your Patients",
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier
                            .padding(top = 8.dp)
                            .semantics { heading() }
                    )
                }

                // Loading indicator
                if (uiState.isLoading && uiState.patients.isEmpty()) {
                    item(key = "loading") {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(200.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                }

                // Empty state
                if (!uiState.isLoading && uiState.patients.isEmpty()) {
                    item(key = "empty") {
                        EmptyPatientsCard(onOnboard = onNavigateToOnboarding)
                    }
                }

                // Patient cards
                items(uiState.patients, key = { it.patient_id }) { patient ->
                    val isExpanded = uiState.expandedPatientId == patient.patient_id
                    val patientAlerts = uiState.alerts.filter { it.patient_id == patient.patient_id }
                    val hasThresholdBreach = patientAlerts.any { it.type == "threshold_breach" }
                    val hasMissedCheckin = patientAlerts.any { it.type == "missed_checkin" }

                    PatientCard(
                        patient = patient,
                        alertCount = patientAlerts.size,
                        hasThresholdBreach = hasThresholdBreach,
                        hasMissedCheckin = hasMissedCheckin,
                        isExpanded = isExpanded,
                        onToggleExpand = { viewModel.togglePatientExpanded(patient.patient_id) },
                        onViewLogs = { onNavigateToPatientLogs(patient.patient_id) },
                        onViewAlerts = { onNavigateToAlerts(patient.patient_id) }
                    )
                }

                // F4 — Manage section. Two orphan v1 screens
                // (Thresholds / Trends) wired to entry points here so
                // CG-V2-12 and CG-V2-17 are reachable. F26b: reminders
                // are voice-only in v2.0 (configured during the
                // caregiver_onboarding protocol conversation, persisted
                // to parameter_configs.frequency_days/daily_deadline
                // via protocol_persister UPSERT), so no Reminders card.
                // testTags `caregiver_thresholds` / `caregiver_trends`
                // match the pre-existing journey-doc expectations.
                // The screens self-resolve patientId via
                // authRepository.fetchLinkedPatientId(), so no patientId
                // threading needed from here.
                item(key = "manage_header") {
                    Spacer(modifier = Modifier.height(24.dp))
                    Text(
                        text = "Manage",
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier
                            .padding(top = 8.dp, bottom = 4.dp)
                            .semantics { heading() },
                    )
                }

                item(key = "manage_grid") {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        ManageCard(
                            label = "Thresholds",
                            icon = Icons.Filled.Tune,
                            testTagId = "caregiver_thresholds",
                            onClick = onNavigateToThresholds,
                            modifier = Modifier.weight(1f),
                        )
                        ManageCard(
                            label = "Trends",
                            icon = Icons.AutoMirrored.Filled.ShowChart,
                            testTagId = "caregiver_trends",
                            onClick = onNavigateToTrends,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }

                // Bottom spacer for FAB
                item(key = "spacer") {
                    Spacer(modifier = Modifier.height(80.dp))
                }
            }
        }
    }
}

@Composable
private fun ManageCard(
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
            .semantics { contentDescription = "Manage $label" },
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
 * Card displaying a patient's status summary with color-coded urgency.
 *
 * - Red border/badge: threshold breach alert
 * - Orange border/badge: missed check-in alert
 * - Default: no alerts
 *
 * Tap to expand for details and action buttons with spring animation.
 */
@Composable
private fun PatientCard(
    patient: PatientListItem,
    alertCount: Int,
    hasThresholdBreach: Boolean,
    hasMissedCheckin: Boolean,
    isExpanded: Boolean,
    onToggleExpand: () -> Unit,
    onViewLogs: () -> Unit,
    onViewAlerts: () -> Unit,
    modifier: Modifier = Modifier
) {
    // Color-coded urgency
    val urgencyColor = when {
        hasThresholdBreach -> Color(0xFFF44336) // Red for threshold breach
        hasMissedCheckin -> Color(0xFFFF9800)    // Orange for missed check-in
        else -> null
    }

    val cardDescription = buildString {
        append("Patient: ${patient.name}")
        patient.age?.let { append(", age $it") }
        if (alertCount > 0) {
            append(". $alertCount alert${if (alertCount > 1) "s" else ""}")
            if (hasThresholdBreach) append(", including threshold breach")
            if (hasMissedCheckin) append(", including missed check-in")
        }
        if (isExpanded) append(". Expanded.")
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onToggleExpand)
            .animateContentSize(
                animationSpec = spring(
                    dampingRatio = Spring.DampingRatioMediumBouncy,
                    stiffness = Spring.StiffnessMedium
                )
            )
            .testTag("patient_card_${patient.patient_id}")
            .semantics { contentDescription = cardDescription },
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        border = urgencyColor?.let { BorderStroke(2.dp, it.copy(alpha = 0.5f)) }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = patient.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )

                    patient.age?.let { age ->
                        Text(
                            text = "Age: $age",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // Alert badge with urgency color
                if (alertCount > 0) {
                    val badgeColor = urgencyColor ?: Color(0xFFF44336)
                    Badge(
                        containerColor = badgeColor,
                        contentColor = Color.White,
                        modifier = Modifier.semantics {
                            contentDescription = "$alertCount alert${if (alertCount > 1) "s" else ""}"
                        }
                    ) {
                        Text(
                            text = alertCount.toString(),
                            modifier = Modifier.padding(horizontal = 4.dp)
                        )
                    }

                    Spacer(modifier = Modifier.width(8.dp))
                }

                Icon(
                    imageVector = if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = if (isExpanded) "Collapse details" else "Expand details",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // Last check-in info
            patient.last_check_in?.let { lastCheckIn ->
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Last check-in: $lastCheckIn",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // Conditions chips
            if (patient.conditions.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    patient.conditions.take(3).forEach { condition ->
                        SuggestionChip(
                            onClick = {},
                            label = {
                                Text(
                                    text = condition,
                                    style = MaterialTheme.typography.labelSmall
                                )
                            }
                        )
                    }
                    if (patient.conditions.size > 3) {
                        SuggestionChip(
                            onClick = {},
                            label = {
                                Text(
                                    text = "+${patient.conditions.size - 3} more",
                                    style = MaterialTheme.typography.labelSmall
                                )
                            }
                        )
                    }
                }
            }

            // Expanded content with smooth animation
            AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically(
                    animationSpec = spring(
                        dampingRatio = Spring.DampingRatioMediumBouncy,
                        stiffness = Spring.StiffnessMedium
                    )
                ),
                exit = shrinkVertically(
                    animationSpec = spring(
                        dampingRatio = Spring.DampingRatioNoBouncy,
                        stiffness = Spring.StiffnessMedium
                    )
                )
            ) {
                Column(
                    modifier = Modifier.padding(top = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    HorizontalDivider()

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = onViewLogs,
                            modifier = Modifier
                                .weight(1f)
                                .height(48.dp)
                                .semantics {
                                    contentDescription = "View health logs for ${patient.name}"
                                }
                        ) {
                            Icon(
                                Icons.Default.History,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("View Logs")
                        }

                        OutlinedButton(
                            onClick = onViewAlerts,
                            modifier = Modifier
                                .weight(1f)
                                .height(48.dp)
                                .semantics {
                                    contentDescription = "View alerts for ${patient.name}" +
                                        if (alertCount > 0) ", $alertCount active" else ""
                                }
                        ) {
                            Icon(
                                Icons.Default.Warning,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Alerts")
                            if (alertCount > 0) {
                                Spacer(modifier = Modifier.width(4.dp))
                                val badgeColor = urgencyColor ?: Color(0xFFF44336)
                                Badge(
                                    containerColor = badgeColor,
                                    contentColor = Color.White
                                ) {
                                    Text(alertCount.toString())
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Empty state shown when no patients are linked.
 */
@Composable
private fun EmptyPatientsCard(
    onOnboard: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = "No patients yet. Tap the button to onboard your first patient."
            },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Icon(
                imageVector = Icons.Default.PersonAdd,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Text(
                text = "No patients yet",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Text(
                text = "Tap the button below to onboard your first patient through a guided conversation.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
            )

            Button(
                onClick = onOnboard,
                modifier = Modifier.height(48.dp)
            ) {
                Icon(Icons.Default.PersonAdd, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Onboard Patient")
            }
        }
    }
}

package com.carelog.dashboard.ui

import android.util.Log
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.network.AlertItem
import com.carelog.network.CloudApiService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * UI state for alert list screen.
 */
data class AlertListUiState(
    val alerts: List<AlertItem> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null
)

/**
 * ViewModel for the alert list screen.
 */
@HiltViewModel
class AlertListViewModel @Inject constructor(
    private val cloudApiService: CloudApiService,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    companion object {
        private const val TAG = "AlertListVM"
    }

    private val patientId: String = savedStateHandle.get<String>("patientId") ?: ""

    private val _uiState = MutableStateFlow(AlertListUiState())
    val uiState: StateFlow<AlertListUiState> = _uiState.asStateFlow()

    init {
        loadAlerts()
    }

    fun loadAlerts() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                val response = cloudApiService.getAlerts(patientId)
                _uiState.update {
                    it.copy(
                        alerts = response.alerts.sortedByDescending { alert -> alert.timestamp },
                        isLoading = false
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load alerts", e)
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = "Failed to load alerts."
                    )
                }
            }
        }
    }

    fun acknowledgeAlert(alertId: String) {
        viewModelScope.launch {
            try {
                cloudApiService.acknowledgeAlert(patientId, alertId)
                // Update local state
                _uiState.update { state ->
                    state.copy(
                        alerts = state.alerts.map { alert ->
                            if (alert.alert_id == alertId) alert.copy(acknowledged = true) else alert
                        }
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to acknowledge alert", e)
            }
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }
}

/**
 * Screen listing alerts for a patient.
 *
 * Shows threshold breaches (red) and missed measurements (orange).
 * Alerts can be acknowledged.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AlertListScreen(
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: AlertListViewModel = hiltViewModel()
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
                title = { Text("Alerts") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        modifier = modifier.testTag("alert_list")
    ) { paddingValues ->
        if (uiState.isLoading && uiState.alerts.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else if (uiState.alerts.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Default.CheckCircle,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = Color(0xFF4CAF50)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "No alerts",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(uiState.alerts, key = { it.alert_id }) { alert ->
                    AlertCard(
                        alert = alert,
                        onAcknowledge = { viewModel.acknowledgeAlert(alert.alert_id) }
                    )
                }
            }
        }
    }
}

@Composable
private fun AlertCard(
    alert: AlertItem,
    onAcknowledge: () -> Unit,
    modifier: Modifier = Modifier
) {
    val isThresholdBreach = alert.type == "threshold_breach"
    val indicatorColor = if (isThresholdBreach) Color(0xFFF44336) else Color(0xFFFF9800)
    val severityColor = when (alert.severity) {
        "critical" -> Color(0xFFF44336)
        "warning" -> Color(0xFFFF9800)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    val typeIcon = if (isThresholdBreach) Icons.Default.Warning else Icons.Default.Schedule

    Card(
        modifier = modifier
            .fillMaxWidth()
            .testTag("alert_card_${alert.alert_id}"),
        colors = CardDefaults.cardColors(
            containerColor = if (alert.acknowledged) {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            } else {
                indicatorColor.copy(alpha = 0.08f)
            }
        ),
        elevation = CardDefaults.cardElevation(
            defaultElevation = if (alert.acknowledged) 0.dp else 2.dp
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Type icon
            Icon(
                imageVector = typeIcon,
                contentDescription = if (isThresholdBreach) "Threshold breach" else "Missed measurement",
                tint = indicatorColor,
                modifier = Modifier.size(24.dp)
            )

            Column(modifier = Modifier.weight(1f)) {
                // Parameter name. Falls back when the backend row has no
                // vital_type (missed_measurement rows carry the name in
                // `message` instead — see alert-crud.getAlerts).
                Text(
                    text = alert.parameter
                        ?: if (isThresholdBreach) "Threshold breach" else "Missed measurement",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = if (alert.acknowledged) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    }
                )

                Spacer(modifier = Modifier.height(2.dp))

                // Alert detail
                if (isThresholdBreach) {
                    val valueText = alert.value?.let { v ->
                        val formatted = if (v == v.toLong().toDouble()) v.toLong().toString() else "%.1f".format(v)
                        "$formatted ${alert.unit ?: ""}"
                    } ?: "Unknown"

                    val thresholdText = buildString {
                        alert.threshold_min?.let { append("Min: $it") }
                        if (alert.threshold_min != null && alert.threshold_max != null) append(" | ")
                        alert.threshold_max?.let { append("Max: $it") }
                    }

                    Text(
                        text = "Value: $valueText",
                        style = MaterialTheme.typography.bodySmall,
                        color = indicatorColor,
                        fontWeight = FontWeight.Medium
                    )
                    if (thresholdText.isNotBlank()) {
                        Text(
                            text = "Threshold: $thresholdText",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    // Missed measurement
                    alert.days_overdue?.let { days ->
                        Text(
                            text = "$days day${if (days != 1) "s" else ""} overdue",
                            style = MaterialTheme.typography.bodySmall,
                            color = indicatorColor,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                // Timestamp and severity
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = alert.timestamp,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    SuggestionChip(
                        onClick = {},
                        label = {
                            Text(
                                text = alert.severity,
                                style = MaterialTheme.typography.labelSmall,
                                color = severityColor
                            )
                        }
                    )
                }
            }

            // Acknowledge button
            if (!alert.acknowledged) {
                IconButton(
                    onClick = onAcknowledge,
                    modifier = Modifier.size(48.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Check,
                        contentDescription = "Acknowledge alert",
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
            } else {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = "Acknowledged",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                    modifier = Modifier.size(24.dp)
                )
            }
        }
    }
}

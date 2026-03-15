package com.carelog.ui.relative

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.api.*
import com.carelog.auth.AuthRepository
import com.carelog.ui.theme.CareLogColors
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject

/**
 * Alert inbox screen showing all alerts for the linked patient.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AlertInboxScreen(
    onNavigateBack: () -> Unit,
    viewModel: AlertInboxViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Alerts")
                        if (uiState.unreadCount > 0) {
                            Text(
                                text = "${uiState.unreadCount} unread",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                },
                actions = {
                    if (uiState.unreadCount > 0) {
                        TextButton(onClick = { viewModel.markAllAsRead() }) {
                            Text("Mark all read")
                        }
                    }

                    // Filter toggle
                    IconButton(onClick = { viewModel.toggleFilter() }) {
                        Icon(
                            imageVector = if (uiState.showUnreadOnly) {
                                Icons.Default.FilterAlt
                            } else {
                                Icons.Default.FilterAltOff
                            },
                            contentDescription = "Filter",
                            tint = if (uiState.showUnreadOnly) {
                                CareLogColors.Primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            }
                        )
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                uiState.isLoading && uiState.alerts.isEmpty() -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                uiState.error != null && uiState.alerts.isEmpty() -> {
                    ErrorContent(
                        message = uiState.error!!,
                        onRetry = { viewModel.loadAlerts() },
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                uiState.alerts.isEmpty() -> {
                    EmptyAlertsView(
                        showUnreadOnly = uiState.showUnreadOnly,
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(
                            items = uiState.alerts,
                            key = { it.id }
                        ) { alert ->
                            AlertCard(
                                alert = alert,
                                onMarkAsRead = { viewModel.markAsRead(alert.id) },
                                onDelete = { viewModel.deleteAlert(alert.id) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AlertCard(
    alert: Alert,
    onMarkAsRead: () -> Unit,
    onDelete: () -> Unit
) {
    var showMenu by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { if (!alert.read) onMarkAsRead() },
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (alert.read) {
                MaterialTheme.colorScheme.surface
            } else {
                CareLogColors.Primary.copy(alpha = 0.05f)
            }
        ),
        elevation = CardDefaults.cardElevation(
            defaultElevation = if (alert.read) 1.dp else 2.dp
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.Top
        ) {
            // Alert type icon
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(getAlertColor(alert.alertType).copy(alpha = 0.1f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = getAlertIcon(alert.alertType),
                    contentDescription = null,
                    tint = getAlertColor(alert.alertType),
                    modifier = Modifier.size(24.dp)
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            // Content
            Column(
                modifier = Modifier.weight(1f)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = getAlertTitle(alert),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = if (alert.read) FontWeight.Normal else FontWeight.SemiBold
                        )

                        Spacer(modifier = Modifier.height(4.dp))

                        Text(
                            text = alert.message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    // Unread indicator
                    if (!alert.read) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(CareLogColors.Primary)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = formatTimestamp(alert.timestamp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Box {
                        IconButton(
                            onClick = { showMenu = true },
                            modifier = Modifier.size(24.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.MoreVert,
                                contentDescription = "More options",
                                modifier = Modifier.size(16.dp)
                            )
                        }

                        DropdownMenu(
                            expanded = showMenu,
                            onDismissRequest = { showMenu = false }
                        ) {
                            if (!alert.read) {
                                DropdownMenuItem(
                                    text = { Text("Mark as read") },
                                    onClick = {
                                        onMarkAsRead()
                                        showMenu = false
                                    },
                                    leadingIcon = {
                                        Icon(
                                            imageVector = Icons.Default.Done,
                                            contentDescription = null
                                        )
                                    }
                                )
                            }
                            DropdownMenuItem(
                                text = { Text("Delete") },
                                onClick = {
                                    onDelete()
                                    showMenu = false
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.Delete,
                                        contentDescription = null
                                    )
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyAlertsView(
    showUnreadOnly: Boolean,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Icon(
            imageVector = Icons.Default.NotificationsOff,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )

        Text(
            text = if (showUnreadOnly) "No unread alerts" else "No alerts yet",
            style = MaterialTheme.typography.titleMedium
        )

        Text(
            text = if (showUnreadOnly) {
                "All alerts have been read"
            } else {
                "Alerts will appear here when vital readings are outside thresholds or reminders are missed"
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center
        )
    }
}

@Composable
private fun ErrorContent(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.error
        )
        Button(onClick = onRetry) {
            Text("Retry")
        }
    }
}

private fun getAlertColor(alertType: AlertType): Color {
    return when (alertType) {
        AlertType.THRESHOLD_BREACH -> CareLogColors.Error
        AlertType.REMINDER_LAPSE -> CareLogColors.Warning
        AlertType.SYSTEM -> CareLogColors.Primary
    }
}

private fun getAlertIcon(alertType: AlertType): androidx.compose.ui.graphics.vector.ImageVector {
    return when (alertType) {
        AlertType.THRESHOLD_BREACH -> Icons.Default.Warning
        AlertType.REMINDER_LAPSE -> Icons.Default.Schedule
        AlertType.SYSTEM -> Icons.Default.Info
    }
}

private fun getAlertTitle(alert: Alert): String {
    return when (alert.alertType) {
        AlertType.THRESHOLD_BREACH -> {
            alert.vitalType?.displayName?.let { "$it Alert" } ?: "Threshold Alert"
        }
        AlertType.REMINDER_LAPSE -> {
            alert.vitalType?.displayName?.let { "$it Reminder" } ?: "Reminder Lapse"
        }
        AlertType.SYSTEM -> "System Notification"
    }
}

private fun formatTimestamp(instant: Instant): String {
    val formatter = DateTimeFormatter
        .ofPattern("MMM d, h:mm a")
        .withZone(ZoneId.systemDefault())
    return formatter.format(instant)
}

/**
 * ViewModel for alert inbox.
 */
@HiltViewModel
class AlertInboxViewModel @Inject constructor(
    private val apiService: RelativeApiService,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AlertInboxUiState())
    val uiState: StateFlow<AlertInboxUiState> = _uiState.asStateFlow()

    init {
        loadAlerts()
    }

    fun loadAlerts() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                val user = authRepository.currentUser.value
                val patientId = user?.linkedPatientId ?: return@launch

                val alerts = apiService.getAlerts(
                    patientId = patientId,
                    unreadOnly = _uiState.value.showUnreadOnly
                )

                val unreadCount = alerts.count { !it.read }

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        alerts = alerts,
                        unreadCount = unreadCount,
                        patientId = patientId
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isLoading = false, error = e.message ?: "Failed to load alerts")
                }
            }
        }
    }

    fun toggleFilter() {
        _uiState.update { it.copy(showUnreadOnly = !it.showUnreadOnly) }
        loadAlerts()
    }

    fun markAsRead(alertId: String) {
        viewModelScope.launch {
            try {
                apiService.markAlertAsRead(alertId)

                // Update local state
                _uiState.update { state ->
                    val updatedAlerts = state.alerts.map { alert ->
                        if (alert.id == alertId) alert.copy(read = true) else alert
                    }
                    state.copy(
                        alerts = updatedAlerts,
                        unreadCount = updatedAlerts.count { !it.read }
                    )
                }
            } catch (e: Exception) {
                // Silently fail, user can retry
            }
        }
    }

    fun markAllAsRead() {
        viewModelScope.launch {
            val patientId = _uiState.value.patientId ?: return@launch

            try {
                // Mark all alerts as read
                _uiState.value.alerts.filter { !it.read }.forEach { alert ->
                    apiService.markAlertAsRead(alert.id)
                }

                // Update local state
                _uiState.update { state ->
                    state.copy(
                        alerts = state.alerts.map { it.copy(read = true) },
                        unreadCount = 0
                    )
                }
            } catch (e: Exception) {
                // Refresh to sync state
                loadAlerts()
            }
        }
    }

    fun deleteAlert(alertId: String) {
        viewModelScope.launch {
            // Optimistically remove from list
            _uiState.update { state ->
                state.copy(
                    alerts = state.alerts.filter { it.id != alertId }
                )
            }

            // Note: Would call delete API here when implemented
        }
    }
}

/**
 * UI state for alert inbox.
 */
data class AlertInboxUiState(
    val isLoading: Boolean = false,
    val alerts: List<Alert> = emptyList(),
    val unreadCount: Int = 0,
    val showUnreadOnly: Boolean = false,
    val patientId: String? = null,
    val error: String? = null
)

// Extension to create a copy of Alert with updated read status
private fun Alert.copy(read: Boolean): Alert {
    return Alert(
        id = this.id,
        alertType = this.alertType,
        vitalType = this.vitalType,
        value = this.value,
        message = this.message,
        timestamp = this.timestamp,
        read = read
    )
}

package com.carelog.ui.relative

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
import javax.inject.Inject

/**
 * Reminder configuration screen for relatives to set vital logging reminders.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReminderConfigScreen(
    onNavigateBack: () -> Unit,
    viewModel: ReminderConfigViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Reminder Settings") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
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
                uiState.isLoading -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                uiState.error != null -> {
                    ErrorContent(
                        message = uiState.error!!,
                        onRetry = { viewModel.loadReminders() },
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        item {
                            Text(
                                text = "Set how often you want to be reminded if vitals haven't been logged. You'll receive notifications when the time window passes.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(bottom = 8.dp)
                            )
                        }

                        items(uiState.reminders) { reminder ->
                            ReminderCard(
                                reminder = reminder,
                                onUpdateReminder = { windowHours, gracePeriod, enabled ->
                                    viewModel.updateReminder(
                                        reminder.vitalType,
                                        windowHours,
                                        gracePeriod,
                                        enabled
                                    )
                                }
                            )
                        }
                    }
                }
            }
        }
    }

    // Show success message
    if (uiState.saveSuccess) {
        LaunchedEffect(Unit) {
            kotlinx.coroutines.delay(2000)
            viewModel.clearSuccess()
        }

        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.BottomCenter
        ) {
            Surface(
                color = CareLogColors.Success,
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.padding(16.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Check,
                        contentDescription = null,
                        tint = Color.White
                    )
                    Text(
                        text = "Reminder saved successfully",
                        color = Color.White
                    )
                }
            }
        }
    }
}

@Composable
private fun ReminderCard(
    reminder: ReminderConfig,
    onUpdateReminder: (Int, Int, Boolean) -> Unit
) {
    var windowHours by remember(reminder) { mutableIntStateOf(reminder.windowHours) }
    var gracePeriod by remember(reminder) { mutableIntStateOf(reminder.gracePeriodMinutes) }
    var enabled by remember(reminder) { mutableStateOf(reminder.enabled) }
    var isEditing by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (enabled) {
                MaterialTheme.colorScheme.surface
            } else {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            }
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header with toggle
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(getVitalColor(reminder.vitalType).copy(alpha = 0.1f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Notifications,
                            contentDescription = null,
                            tint = getVitalColor(reminder.vitalType),
                            modifier = Modifier.size(24.dp)
                        )
                    }

                    Column {
                        Text(
                            text = reminder.vitalType.displayName,
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            text = if (enabled) "Enabled" else "Disabled",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (enabled) CareLogColors.Success else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Switch(
                    checked = enabled,
                    onCheckedChange = {
                        enabled = it
                        isEditing = true
                    },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = CareLogColors.Primary,
                        checkedTrackColor = CareLogColors.Primary.copy(alpha = 0.5f)
                    )
                )
            }

            if (enabled) {
                // Window hours selector
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Remind me if not logged within:",
                        style = MaterialTheme.typography.bodyMedium
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        WindowOption(
                            label = "8h",
                            hours = 8,
                            selected = windowHours == 8,
                            onSelect = {
                                windowHours = 8
                                isEditing = true
                            }
                        )
                        WindowOption(
                            label = "12h",
                            hours = 12,
                            selected = windowHours == 12,
                            onSelect = {
                                windowHours = 12
                                isEditing = true
                            }
                        )
                        WindowOption(
                            label = "24h",
                            hours = 24,
                            selected = windowHours == 24,
                            onSelect = {
                                windowHours = 24
                                isEditing = true
                            }
                        )
                        WindowOption(
                            label = "48h",
                            hours = 48,
                            selected = windowHours == 48,
                            onSelect = {
                                windowHours = 48
                                isEditing = true
                            }
                        )
                        WindowOption(
                            label = "1wk",
                            hours = 168,
                            selected = windowHours == 168,
                            onSelect = {
                                windowHours = 168
                                isEditing = true
                            }
                        )
                    }
                }

                // Grace period slider
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "Grace period:",
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Text(
                            text = formatGracePeriod(gracePeriod),
                            style = MaterialTheme.typography.bodyMedium,
                            color = CareLogColors.Primary
                        )
                    }

                    Slider(
                        value = gracePeriod.toFloat(),
                        onValueChange = {
                            gracePeriod = it.toInt()
                            isEditing = true
                        },
                        valueRange = 0f..120f,
                        steps = 3,
                        colors = SliderDefaults.colors(
                            thumbColor = CareLogColors.Primary,
                            activeTrackColor = CareLogColors.Primary
                        )
                    )

                    Text(
                        text = "Extra time before sending the reminder",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // Save button
            if (isEditing) {
                Button(
                    onClick = {
                        onUpdateReminder(windowHours, gracePeriod, enabled)
                        isEditing = false
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = CareLogColors.Primary
                    )
                ) {
                    Text("Save Changes")
                }
            }
        }
    }
}

@Suppress("UNUSED_PARAMETER")
@Composable
private fun RowScope.WindowOption(
    label: String,
    hours: Int,
    selected: Boolean,
    onSelect: () -> Unit
) {
    FilterChip(
        selected = selected,
        onClick = onSelect,
        label = { Text(label) },
        modifier = Modifier.weight(1f),
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = CareLogColors.Primary,
            selectedLabelColor = Color.White
        )
    )
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

private fun formatGracePeriod(minutes: Int): String {
    return when {
        minutes == 0 -> "No grace period"
        minutes < 60 -> "$minutes minutes"
        minutes == 60 -> "1 hour"
        else -> "${minutes / 60} hours"
    }
}

private fun getVitalColor(vitalType: VitalType): Color {
    return when (vitalType) {
        VitalType.BLOOD_PRESSURE -> CareLogColors.BloodPressure
        VitalType.GLUCOSE -> CareLogColors.Glucose
        VitalType.TEMPERATURE -> CareLogColors.Temperature
        VitalType.WEIGHT -> CareLogColors.Weight
        VitalType.PULSE -> CareLogColors.Pulse
        VitalType.SPO2 -> CareLogColors.SpO2
    }
}

/**
 * ViewModel for reminder configuration.
 */
@HiltViewModel
class ReminderConfigViewModel @Inject constructor(
    private val apiService: RelativeApiService,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ReminderConfigUiState())
    val uiState: StateFlow<ReminderConfigUiState> = _uiState.asStateFlow()

    init {
        loadReminders()
    }

    fun loadReminders() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                val user = authRepository.currentUser.value
                val patientId = user?.linkedPatientId ?: return@launch

                val reminders = apiService.getReminderConfig(patientId)

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        reminders = reminders,
                        patientId = patientId
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isLoading = false, error = e.message ?: "Failed to load reminders")
                }
            }
        }
    }

    fun updateReminder(
        vitalType: VitalType,
        windowHours: Int,
        gracePeriodMinutes: Int,
        enabled: Boolean
    ) {
        viewModelScope.launch {
            val patientId = _uiState.value.patientId ?: return@launch

            try {
                val success = apiService.updateReminderConfig(
                    patientId = patientId,
                    vitalType = vitalType,
                    windowHours = windowHours,
                    gracePeriodMinutes = gracePeriodMinutes,
                    enabled = enabled
                )

                if (success) {
                    _uiState.update { it.copy(saveSuccess = true) }
                    loadReminders()
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(error = e.message ?: "Failed to save reminder")
                }
            }
        }
    }

    fun clearSuccess() {
        _uiState.update { it.copy(saveSuccess = false) }
    }
}

/**
 * UI state for reminder configuration.
 */
data class ReminderConfigUiState(
    val isLoading: Boolean = false,
    val reminders: List<ReminderConfig> = emptyList(),
    val patientId: String? = null,
    val saveSuccess: Boolean = false,
    val error: String? = null
)

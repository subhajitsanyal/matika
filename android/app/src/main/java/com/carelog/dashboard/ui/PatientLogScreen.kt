package com.carelog.dashboard.ui

import android.util.Log
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
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
import com.carelog.network.CloudApiService
import com.carelog.network.InteractionItem
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * UI state for patient log screen.
 */
data class PatientLogUiState(
    val interactions: List<InteractionItem> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val expandedSessionId: String? = null,
    val hasMore: Boolean = true
)

/**
 * ViewModel for the patient log screen.
 */
@HiltViewModel
class PatientLogViewModel @Inject constructor(
    private val cloudApiService: CloudApiService,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    companion object {
        private const val TAG = "PatientLogVM"
        private const val PAGE_SIZE = 20
    }

    private val patientId: String = savedStateHandle.get<String>("patientId") ?: ""

    private val _uiState = MutableStateFlow(PatientLogUiState())
    val uiState: StateFlow<PatientLogUiState> = _uiState.asStateFlow()

    init {
        loadInteractions()
    }

    fun loadInteractions() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                val response = cloudApiService.getInteractions(
                    patientId = patientId,
                    limit = PAGE_SIZE,
                    offset = 0
                )
                _uiState.update {
                    it.copy(
                        interactions = response.interactions,
                        isLoading = false,
                        hasMore = response.interactions.size >= PAGE_SIZE
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load interactions", e)
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = "Failed to load logs."
                    )
                }
            }
        }
    }

    fun loadMore() {
        if (_uiState.value.isLoading || !_uiState.value.hasMore) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val response = cloudApiService.getInteractions(
                    patientId = patientId,
                    limit = PAGE_SIZE,
                    offset = _uiState.value.interactions.size
                )
                _uiState.update {
                    it.copy(
                        interactions = it.interactions + response.interactions,
                        isLoading = false,
                        hasMore = response.interactions.size >= PAGE_SIZE
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load more interactions", e)
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun toggleSessionExpanded(sessionId: String) {
        _uiState.update {
            it.copy(expandedSessionId = if (it.expandedSessionId == sessionId) null else sessionId)
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }
}

/**
 * Screen showing past interaction sessions for a patient.
 *
 * Lists sessions with date, type, status, and duration.
 * Tap a session to see confirmed values from that session.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientLogScreen(
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PatientLogViewModel = hiltViewModel()
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
                title = { Text("Patient Logs") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        modifier = modifier.testTag("patient_log_screen")
    ) { paddingValues ->
        if (uiState.isLoading && uiState.interactions.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else if (uiState.interactions.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Default.History,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "No interaction logs yet",
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
                items(uiState.interactions, key = { it.session_id }) { interaction ->
                    val isExpanded = uiState.expandedSessionId == interaction.session_id
                    InteractionCard(
                        interaction = interaction,
                        isExpanded = isExpanded,
                        onToggleExpand = { viewModel.toggleSessionExpanded(interaction.session_id) }
                    )
                }

                if (uiState.hasMore) {
                    item(key = "load_more") {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            if (uiState.isLoading) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp))
                            } else {
                                TextButton(onClick = { viewModel.loadMore() }) {
                                    Text("Load more")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun InteractionCard(
    interaction: InteractionItem,
    isExpanded: Boolean,
    onToggleExpand: () -> Unit,
    modifier: Modifier = Modifier
) {
    val statusColor = when (interaction.status) {
        "completed" -> Color(0xFF4CAF50)
        "partial" -> Color(0xFFFFC107)
        "timeout" -> Color(0xFFF44336)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    val typeIcon = when (interaction.type) {
        "daily_checkin" -> Icons.Default.Mic
        "caregiver_config" -> Icons.Default.Settings
        else -> Icons.AutoMirrored.Filled.Chat
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onToggleExpand)
            .testTag("interaction_card_${interaction.session_id}"),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        imageVector = typeIcon,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Column {
                        Text(
                            // Same Gson-non-null-bypass class of bug as
                            // `interaction.type` below — guard at the
                            // render site so a missing wire field doesn't
                            // crash the InteractionCard.
                            text = (interaction.timestamp as String?) ?: "—",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            // `interaction.type` is declared non-null in
                            // the DTO but Gson can land it as null when
                            // the wire payload omits the field. Guard at
                            // the render site rather than mutate the
                            // DTO (would cascade to other call sites).
                            text = "${(interaction.type as String?)?.replace("_", " ") ?: "session"} | ${interaction.turn_count} turns | ${formatDuration(interaction.duration_ms)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                SuggestionChip(
                    onClick = {},
                    label = {
                        Text(
                            text = (interaction.status as String?) ?: "—",
                            style = MaterialTheme.typography.labelSmall,
                            color = statusColor
                        )
                    }
                )
            }

            // Expanded: show confirmed values
            AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically(),
                exit = shrinkVertically()
            ) {
                Column(
                    modifier = Modifier.padding(top = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    HorizontalDivider()
                    Spacer(modifier = Modifier.height(4.dp))

                    if (interaction.confirmed_values.isNullOrEmpty()) {
                        Text(
                            text = "No values captured in this session.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    } else {
                        Text(
                            text = "Confirmed Values",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold
                        )
                        interaction.confirmed_values.forEach { value ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = value.parameter,
                                    style = MaterialTheme.typography.bodySmall
                                )
                                Text(
                                    text = "${formatDouble(value.value)} ${value.unit}",
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun formatDuration(ms: Long): String {
    val seconds = ms / 1000
    val minutes = seconds / 60
    val remainingSeconds = seconds % 60
    return if (minutes > 0) "${minutes}m ${remainingSeconds}s" else "${seconds}s"
}

private fun formatDouble(value: Double): String {
    return if (value == value.toLong().toDouble()) {
        value.toLong().toString()
    } else {
        "%.1f".format(value)
    }
}

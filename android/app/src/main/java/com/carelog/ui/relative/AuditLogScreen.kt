package com.carelog.ui.relative

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.api.AuditLogEntryDto
import com.carelog.api.RelativeApiService
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
 * Audit log viewer screen for relatives.
 * Shows chronological list of who logged what and when.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuditLogScreen(
    onNavigateBack: () -> Unit,
    viewModel: AuditLogViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var showFilterSheet by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Activity Log") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { showFilterSheet = true }) {
                        Badge(
                            containerColor = if (uiState.hasActiveFilters) {
                                CareLogColors.Primary
                            } else {
                                Color.Transparent
                            }
                        ) {
                            Icon(
                                imageVector = Icons.Default.FilterList,
                                contentDescription = "Filter"
                            )
                        }
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
                uiState.isLoading && uiState.logs.isEmpty() -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                uiState.error != null && uiState.logs.isEmpty() -> {
                    ErrorContent(
                        message = uiState.error!!,
                        onRetry = { viewModel.loadLogs() },
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                uiState.logs.isEmpty() -> {
                    EmptyContent(modifier = Modifier.align(Alignment.Center))
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Active filters indicator
                        if (uiState.hasActiveFilters) {
                            item {
                                ActiveFiltersBar(
                                    actorName = uiState.selectedActorName,
                                    action = uiState.selectedAction,
                                    resourceType = uiState.selectedResourceType,
                                    onClearFilters = { viewModel.clearFilters() }
                                )
                            }
                        }

                        items(
                            items = uiState.logs,
                            key = { it.id }
                        ) { log ->
                            AuditLogCard(log = log)
                        }

                        // Load more indicator
                        if (uiState.hasMore) {
                            item {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(16.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                                }
                                LaunchedEffect(Unit) {
                                    viewModel.loadMore()
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Filter bottom sheet
    if (showFilterSheet) {
        ModalBottomSheet(
            onDismissRequest = { showFilterSheet = false }
        ) {
            FilterSheet(
                actors = uiState.actors,
                actions = uiState.availableActions,
                resourceTypes = uiState.availableResourceTypes,
                selectedActorId = uiState.selectedActorId,
                selectedAction = uiState.selectedAction,
                selectedResourceType = uiState.selectedResourceType,
                onApply = { actorId, action, resourceType ->
                    viewModel.applyFilters(actorId, action, resourceType)
                    showFilterSheet = false
                },
                onDismiss = { showFilterSheet = false }
            )
        }
    }
}

@Composable
private fun AuditLogCard(log: AuditLogEntry) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.Top
        ) {
            // Action icon
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(getActionColor(log.action).copy(alpha = 0.1f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = getActionIcon(log.action),
                    contentDescription = null,
                    tint = getActionColor(log.action),
                    modifier = Modifier.size(20.dp)
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                // Actor and action
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = log.actorName,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Medium
                    )

                    Surface(
                        shape = RoundedCornerShape(4.dp),
                        color = getRoleColor(log.actorRole).copy(alpha = 0.1f)
                    ) {
                        Text(
                            text = log.actorRole.replaceFirstChar { it.uppercase() },
                            style = MaterialTheme.typography.labelSmall,
                            color = getRoleColor(log.actorRole),
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                // Description
                Text(
                    text = getActionDescription(log),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Spacer(modifier = Modifier.height(8.dp))

                // Timestamp
                Text(
                    text = formatTimestamp(log.timestamp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun ActiveFiltersBar(
    actorName: String?,
    action: String?,
    resourceType: String?,
    onClearFilters: () -> Unit
) {
    Surface(
        color = CareLogColors.Primary.copy(alpha = 0.1f),
        shape = RoundedCornerShape(8.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.FilterList,
                    contentDescription = null,
                    tint = CareLogColors.Primary,
                    modifier = Modifier.size(16.dp)
                )

                Text(
                    text = buildFilterText(actorName, action, resourceType),
                    style = MaterialTheme.typography.bodySmall,
                    color = CareLogColors.Primary
                )
            }

            TextButton(onClick = onClearFilters) {
                Text("Clear")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilterSheet(
    actors: List<ActorInfo>,
    actions: List<String>,
    resourceTypes: List<String>,
    selectedActorId: String?,
    selectedAction: String?,
    selectedResourceType: String?,
    onApply: (String?, String?, String?) -> Unit,
    onDismiss: () -> Unit
) {
    var actorId by remember { mutableStateOf(selectedActorId) }
    var action by remember { mutableStateOf(selectedAction) }
    var resourceType by remember { mutableStateOf(selectedResourceType) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Filter Activity Log",
            style = MaterialTheme.typography.titleLarge
        )

        // Actor filter
        Column {
            Text(
                text = "Person",
                style = MaterialTheme.typography.labelMedium
            )
            Spacer(modifier = Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(
                    selected = actorId == null,
                    onClick = { actorId = null },
                    label = { Text("All") }
                )
                actors.forEach { actor ->
                    FilterChip(
                        selected = actorId == actor.id,
                        onClick = { actorId = actor.id },
                        label = { Text(actor.name) }
                    )
                }
            }
        }

        // Action filter
        Column {
            Text(
                text = "Action",
                style = MaterialTheme.typography.labelMedium
            )
            Spacer(modifier = Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(
                    selected = action == null,
                    onClick = { action = null },
                    label = { Text("All") }
                )
                actions.forEach { a ->
                    FilterChip(
                        selected = action == a,
                        onClick = { action = a },
                        label = { Text(a.lowercase().replaceFirstChar { it.uppercase() }) }
                    )
                }
            }
        }

        // Resource type filter
        Column {
            Text(
                text = "Type",
                style = MaterialTheme.typography.labelMedium
            )
            Spacer(modifier = Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(
                    selected = resourceType == null,
                    onClick = { resourceType = null },
                    label = { Text("All") }
                )
                resourceTypes.forEach { type ->
                    FilterChip(
                        selected = resourceType == type,
                        onClick = { resourceType = type },
                        label = { Text(type) }
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedButton(
                onClick = onDismiss,
                modifier = Modifier.weight(1f)
            ) {
                Text("Cancel")
            }

            Button(
                onClick = { onApply(actorId, action, resourceType) },
                modifier = Modifier.weight(1f)
            ) {
                Text("Apply")
            }
        }

        Spacer(modifier = Modifier.height(32.dp))
    }
}

@Composable
private fun EmptyContent(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Icon(
            imageVector = Icons.Default.History,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )
        Text(
            text = "No activity yet",
            style = MaterialTheme.typography.titleMedium
        )
        Text(
            text = "Activity will appear here as vitals are logged and settings are changed.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
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
        Text(text = message, color = MaterialTheme.colorScheme.error)
        Button(onClick = onRetry) { Text("Retry") }
    }
}

// Helper functions
private fun getActionIcon(action: String): ImageVector {
    return when (action) {
        "CREATE" -> Icons.Default.Add
        "UPDATE" -> Icons.Default.Edit
        "DELETE" -> Icons.Default.Delete
        "LOGIN" -> Icons.AutoMirrored.Filled.Login
        "LOGOUT" -> Icons.AutoMirrored.Filled.Logout
        else -> Icons.Default.Info
    }
}

private fun getActionColor(action: String): Color {
    return when (action) {
        "CREATE" -> CareLogColors.Success
        "UPDATE" -> CareLogColors.Primary
        "DELETE" -> CareLogColors.Error
        "LOGIN" -> CareLogColors.Primary
        "LOGOUT" -> CareLogColors.Warning
        else -> CareLogColors.Primary
    }
}

private fun getRoleColor(role: String): Color {
    return when (role.lowercase()) {
        "patient" -> CareLogColors.Primary
        "attendant" -> CareLogColors.Success
        "relative" -> CareLogColors.Warning
        "doctor" -> CareLogColors.Error
        else -> CareLogColors.Primary
    }
}

private fun getActionDescription(log: AuditLogEntry): String {
    val resourceName = when (log.resourceType) {
        "Observation" -> "vital reading"
        "DocumentReference" -> "document"
        "Threshold" -> "threshold"
        "ReminderConfig" -> "reminder"
        else -> log.resourceType.lowercase()
    }

    return when (log.action) {
        "CREATE" -> "Added a new $resourceName"
        "UPDATE" -> "Updated $resourceName"
        "DELETE" -> "Removed $resourceName"
        "LOGIN" -> "Logged in"
        "LOGOUT" -> "Logged out"
        else -> "${log.action} $resourceName"
    }
}

private fun formatTimestamp(instant: Instant): String {
    val formatter = DateTimeFormatter
        .ofPattern("MMM d, yyyy 'at' h:mm a")
        .withZone(ZoneId.systemDefault())
    return formatter.format(instant)
}

private fun buildFilterText(actorName: String?, action: String?, resourceType: String?): String {
    val parts = mutableListOf<String>()
    actorName?.let { parts.add("by $it") }
    action?.let { parts.add(it.lowercase()) }
    resourceType?.let { parts.add(it) }
    return if (parts.isEmpty()) "Filtered" else "Filtered: ${parts.joinToString(", ")}"
}

// Data classes
data class AuditLogEntry(
    val id: String,
    val action: String,
    val resourceType: String,
    val resourceId: String?,
    val actorId: String,
    val actorName: String,
    val actorRole: String,
    val details: Map<String, Any>?,
    val timestamp: Instant
)

data class ActorInfo(
    val id: String,
    val name: String,
    val role: String
)

/**
 * ViewModel for audit log.
 */
@HiltViewModel
class AuditLogViewModel @Inject constructor(
    private val apiService: RelativeApiService,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuditLogUiState())
    val uiState: StateFlow<AuditLogUiState> = _uiState.asStateFlow()

    private var currentPage = 0
    private val pageSize = 20
    private var isLoadingMore = false

    init {
        loadLogs()
    }

    fun loadLogs() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            currentPage = 0

            try {
                val patientId = authRepository.fetchLinkedPatientId()
                    ?: throw Exception("No patient linked to this account")

                val state = _uiState.value
                val response = apiService.getAuditLogs(
                    patientId = patientId,
                    page = 0,
                    pageSize = pageSize,
                    actorId = state.selectedActorId,
                    action = state.selectedAction,
                    resourceType = state.selectedResourceType
                )

                val logs = response.logs.map { it.toAuditLogEntry() }
                val actors = response.actors.map { ActorInfo(it.id, it.name, it.role) }

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        logs = logs,
                        actors = actors,
                        hasMore = response.hasMore
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isLoading = false, error = e.message ?: "Failed to load logs")
                }
            }
        }
    }

    fun loadMore() {
        if (isLoadingMore) return
        isLoadingMore = true

        viewModelScope.launch {
            try {
                val patientId = authRepository.fetchLinkedPatientId()
                    ?: throw Exception("No patient linked to this account")

                val nextPage = currentPage + 1
                val state = _uiState.value
                val response = apiService.getAuditLogs(
                    patientId = patientId,
                    page = nextPage,
                    pageSize = pageSize,
                    actorId = state.selectedActorId,
                    action = state.selectedAction,
                    resourceType = state.selectedResourceType
                )

                val newLogs = response.logs.map { it.toAuditLogEntry() }
                currentPage = nextPage

                _uiState.update {
                    it.copy(
                        logs = it.logs + newLogs,
                        hasMore = response.hasMore
                    )
                }
            } catch (e: Exception) {
                // Silently fail on load-more; existing logs remain visible
            } finally {
                isLoadingMore = false
            }
        }
    }

    private fun AuditLogEntryDto.toAuditLogEntry() = AuditLogEntry(
        id = id,
        action = action,
        resourceType = resourceType,
        resourceId = resourceId,
        actorId = actorId,
        actorName = actorName,
        actorRole = actorRole,
        details = null,
        timestamp = try {
            Instant.parse(timestamp)
        } catch (e: Exception) {
            Instant.now()
        }
    )

    fun applyFilters(actorId: String?, action: String?, resourceType: String?) {
        val actorName = _uiState.value.actors.find { it.id == actorId }?.name
        _uiState.update {
            it.copy(
                selectedActorId = actorId,
                selectedActorName = actorName,
                selectedAction = action,
                selectedResourceType = resourceType
            )
        }
        loadLogs()
    }

    fun clearFilters() {
        _uiState.update {
            it.copy(
                selectedActorId = null,
                selectedActorName = null,
                selectedAction = null,
                selectedResourceType = null
            )
        }
        loadLogs()
    }
}

/**
 * UI state for audit log.
 */
data class AuditLogUiState(
    val isLoading: Boolean = false,
    val logs: List<AuditLogEntry> = emptyList(),
    val actors: List<ActorInfo> = emptyList(),
    val availableActions: List<String> = listOf("CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT"),
    val availableResourceTypes: List<String> = listOf("Observation", "DocumentReference", "Threshold", "ReminderConfig"),
    val selectedActorId: String? = null,
    val selectedActorName: String? = null,
    val selectedAction: String? = null,
    val selectedResourceType: String? = null,
    val hasMore: Boolean = false,
    val error: String? = null
) {
    val hasActiveFilters: Boolean
        get() = selectedActorId != null || selectedAction != null || selectedResourceType != null
}

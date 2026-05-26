package com.carelog.ui.relative

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
import com.carelog.network.CareNoteItem
import com.carelog.network.CloudApiService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Care notes inbox for a caregiver, scoped to one patient.
 * PRD §6.9 / Spec §4.6. Mirrors [com.carelog.dashboard.ui.AlertListScreen]
 * structurally — list + inline ack — but with two tabs (Unacked /
 * Resolved) instead of a single sorted list.
 */
enum class CareNotesTab { UNACKED, RESOLVED }

data class CareNotesUiState(
    val tab: CareNotesTab = CareNotesTab.UNACKED,
    val unackedItems: List<CareNoteItem> = emptyList(),
    val resolvedItems: List<CareNoteItem> = emptyList(),
    val unacknowledgedCount: Int = 0,
    val isLoading: Boolean = false,
    val acking: Set<String> = emptySet(),
    val errorMessage: String? = null,
)

@HiltViewModel
class CareNotesViewModel @Inject constructor(
    private val cloudApiService: CloudApiService,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    companion object {
        private const val TAG = "CareNotesVM"
    }

    private val patientId: String = savedStateHandle.get<String>("patientId") ?: ""

    private val _uiState = MutableStateFlow(CareNotesUiState())
    val uiState: StateFlow<CareNotesUiState> = _uiState.asStateFlow()

    init {
        load(CareNotesTab.UNACKED)
    }

    fun selectTab(tab: CareNotesTab) {
        if (tab == _uiState.value.tab) return
        _uiState.update { it.copy(tab = tab) }
        // Lazy-load Resolved on first switch; refresh Unacked on switch back
        // so a just-acked row that moved to Resolved doesn't linger.
        load(tab)
    }

    fun load(tab: CareNotesTab) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                val status = when (tab) {
                    CareNotesTab.UNACKED -> "unacknowledged"
                    CareNotesTab.RESOLVED -> "acknowledged"
                }
                val response = cloudApiService.getCareNotes(patientId = patientId, status = status)
                _uiState.update { state ->
                    when (tab) {
                        CareNotesTab.UNACKED -> state.copy(
                            unackedItems = response.items,
                            unacknowledgedCount = response.unacknowledgedCount,
                            isLoading = false,
                        )
                        CareNotesTab.RESOLVED -> state.copy(
                            resolvedItems = response.items,
                            isLoading = false,
                        )
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load care notes for tab=$tab", e)
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = "Failed to load notes.",
                    )
                }
            }
        }
    }

    fun acknowledge(noteId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(acking = it.acking + noteId) }
            try {
                cloudApiService.acknowledgeCareNote(patientId = patientId, noteId = noteId)
                // Move the row from unacked → resolved locally so the user sees
                // it land in the Resolved tab immediately. The badge count
                // decrements via the unacknowledgedCount drop on next refetch
                // (or the next dashboard query); for now decrement optimistically.
                _uiState.update { state ->
                    val moved = state.unackedItems.find { it.id == noteId }
                    state.copy(
                        unackedItems = state.unackedItems.filter { it.id != noteId },
                        resolvedItems = if (moved != null) {
                            listOf(moved.copy(acknowledgedAt = "(just now)")) + state.resolvedItems
                        } else state.resolvedItems,
                        unacknowledgedCount = (state.unacknowledgedCount - 1).coerceAtLeast(0),
                        acking = state.acking - noteId,
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to acknowledge care note $noteId", e)
                _uiState.update {
                    it.copy(
                        acking = it.acking - noteId,
                        errorMessage = "Couldn't acknowledge that note. Please try again.",
                    )
                }
            }
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CareNotesScreen(
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: CareNotesViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.errorMessage) {
        uiState.errorMessage?.let { msg ->
            snackbarHostState.showSnackbar(msg)
            viewModel.dismissError()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Notes") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        modifier = modifier.testTag("care_notes_screen"),
    ) { paddingValues ->
        Column(modifier = Modifier.padding(paddingValues).fillMaxSize()) {
            TabRow(selectedTabIndex = uiState.tab.ordinal) {
                Tab(
                    selected = uiState.tab == CareNotesTab.UNACKED,
                    onClick = { viewModel.selectTab(CareNotesTab.UNACKED) },
                    text = {
                        val label = if (uiState.unacknowledgedCount > 0) {
                            "Unacknowledged (${uiState.unacknowledgedCount})"
                        } else "Unacknowledged"
                        Text(label)
                    },
                    modifier = Modifier.testTag("care_notes_tab_unacked"),
                )
                Tab(
                    selected = uiState.tab == CareNotesTab.RESOLVED,
                    onClick = { viewModel.selectTab(CareNotesTab.RESOLVED) },
                    text = { Text("Resolved") },
                    modifier = Modifier.testTag("care_notes_tab_resolved"),
                )
            }

            val items = when (uiState.tab) {
                CareNotesTab.UNACKED -> uiState.unackedItems
                CareNotesTab.RESOLVED -> uiState.resolvedItems
            }

            when {
                uiState.isLoading && items.isEmpty() -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) { CircularProgressIndicator() }
                }
                items.isEmpty() -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                Icons.Default.CheckCircle,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = Color(0xFF4CAF50),
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = when (uiState.tab) {
                                    CareNotesTab.UNACKED -> "No new notes"
                                    CareNotesTab.RESOLVED -> "No resolved notes yet"
                                },
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().testTag("care_notes_list"),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(items, key = { it.id }) { note ->
                            CareNoteCard(
                                note = note,
                                isAcking = uiState.acking.contains(note.id),
                                onAcknowledge = { viewModel.acknowledge(note.id) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CareNoteCard(
    note: CareNoteItem,
    isAcking: Boolean,
    onAcknowledge: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val acknowledged = note.acknowledgedAt != null
    val sourceLabel = sourceBadgeLabel(note.source)
    val statusColor = disambiguationStatusColor(note.disambiguationStatus)

    Card(
        modifier = modifier
            .fillMaxWidth()
            .testTag("care_note_row_${note.id}"),
        colors = CardDefaults.cardColors(
            containerColor = if (acknowledged) {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            } else {
                MaterialTheme.colorScheme.surface
            }
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = if (acknowledged) 0.dp else 2.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // Top row: source badge + status chip + timestamp
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                AssistChip(
                    onClick = {},
                    label = { Text(sourceLabel, style = MaterialTheme.typography.labelSmall) },
                )
                if (note.disambiguationStatus != "resolved" &&
                    note.disambiguationStatus != "resolved_default"
                ) {
                    AssistChip(
                        onClick = {},
                        label = {
                            Text(
                                statusChipLabel(note.disambiguationStatus, note.mentionedName),
                                style = MaterialTheme.typography.labelSmall,
                                color = statusColor,
                            )
                        },
                    )
                }
                Spacer(modifier = Modifier.weight(1f))
                Text(
                    text = formatTimestamp(note.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // Note text
            Text(
                text = note.noteText,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (acknowledged) FontWeight.Normal else FontWeight.Medium,
            )

            // Recipient row + ack action
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = recipientSummary(note),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (!acknowledged) {
                    Button(
                        onClick = onAcknowledge,
                        enabled = !isAcking,
                        modifier = Modifier.testTag("care_note_ack_button"),
                    ) {
                        if (isAcking) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                                strokeWidth = 2.dp,
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Acknowledging…")
                        } else {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Acknowledge")
                        }
                    }
                } else {
                    Icon(
                        imageVector = Icons.Default.CheckCircle,
                        contentDescription = "Acknowledged",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        }
    }
}

private fun sourceBadgeLabel(source: String): String = when (source) {
    "patient_request" -> "Patient request"
    "matika_observation" -> "Matika observation"
    "doctor_note" -> "Doctor note"
    else -> source
}

private fun statusChipLabel(status: String, mentionedName: String?): String = when (status) {
    "ambiguous" -> "Needs disambiguation: \"${mentionedName ?: "?"}\""
    "no_match" -> "Named: ${mentionedName ?: "?"} (not in care team)"
    else -> status
}

private fun disambiguationStatusColor(status: String): Color = when (status) {
    "ambiguous" -> Color(0xFFFF9800)   // amber — needs follow-up
    "no_match" -> Color(0xFFF44336)    // red — name unresolved
    else -> Color.Unspecified
}

private fun recipientSummary(note: CareNoteItem): String {
    val recipient = note.recipientDisplayName ?: when (note.disambiguationStatus) {
        "no_match" -> "(no caregiver matched)"
        "ambiguous" -> "(awaiting clarification)"
        else -> "Caregiver"
    }
    return "For: $recipient"
}

private fun formatTimestamp(iso: String): String {
    // The createdAt comes through as an ISO-8601 UTC string. Day-precision
    // is plenty for the inbox view; the detail view would format finer.
    // Returning the date slice is good enough for v2.0.
    return iso.substringBefore('T')
}

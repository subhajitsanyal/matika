package com.carelog.ui.attendant

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.auth.AttendantSessionManager
import com.carelog.ui.theme.CareLogColors
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Attendant observations/notes screen.
 * Allows attendants to add free-text observations and voice notes.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttendantNotesScreen(
    onNavigateBack: () -> Unit,
    viewModel: AttendantNotesViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    // Permission launcher for audio recording
    val audioPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            viewModel.toggleRecording()
        }
    }

    // Handle save success
    LaunchedEffect(uiState.saveSuccess) {
        if (uiState.saveSuccess) {
            delay(1500)
            onNavigateBack()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Add Observation") },
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            // Note type selector
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "Observation Type",
                    style = MaterialTheme.typography.labelLarge
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    NoteTypeChip(
                        label = "General",
                        selected = uiState.noteType == NoteType.GENERAL,
                        onClick = { viewModel.setNoteType(NoteType.GENERAL) }
                    )
                    NoteTypeChip(
                        label = "Symptoms",
                        selected = uiState.noteType == NoteType.SYMPTOMS,
                        onClick = { viewModel.setNoteType(NoteType.SYMPTOMS) }
                    )
                    NoteTypeChip(
                        label = "Medication",
                        selected = uiState.noteType == NoteType.MEDICATION,
                        onClick = { viewModel.setNoteType(NoteType.MEDICATION) }
                    )
                }
            }

            // Text note input
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "Written Note",
                    style = MaterialTheme.typography.labelLarge
                )

                OutlinedTextField(
                    value = uiState.textNote,
                    onValueChange = { viewModel.updateTextNote(it) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(160.dp),
                    placeholder = { Text("Enter your observation here...") },
                    maxLines = 8
                )
            }

            // Voice note section
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "Voice Note (Optional)",
                    style = MaterialTheme.typography.labelLarge
                )

                VoiceRecordingSection(
                    isRecording = uiState.isRecording,
                    recordingDuration = uiState.recordingDuration,
                    hasRecording = uiState.hasVoiceRecording,
                    onStartRecording = {
                        // Check permission
                        when {
                            ContextCompat.checkSelfPermission(
                                context,
                                Manifest.permission.RECORD_AUDIO
                            ) == PackageManager.PERMISSION_GRANTED -> {
                                viewModel.toggleRecording()
                            }
                            else -> {
                                audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                            }
                        }
                    },
                    onStopRecording = { viewModel.toggleRecording() },
                    onDeleteRecording = { viewModel.deleteRecording() }
                )
            }

            Spacer(modifier = Modifier.weight(1f))

            // Error message
            if (uiState.error != null) {
                Text(
                    text = uiState.error!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }

            // Success message
            if (uiState.saveSuccess) {
                Surface(
                    color = CareLogColors.Success.copy(alpha = 0.1f),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = CareLogColors.Success
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Observation saved successfully",
                            color = CareLogColors.Success,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }

            // Save button
            Button(
                onClick = { viewModel.saveNote() },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                enabled = uiState.textNote.isNotBlank() || uiState.hasVoiceRecording,
                colors = ButtonDefaults.buttonColors(
                    containerColor = CareLogColors.Primary
                )
            ) {
                if (uiState.isSaving) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Text("Save Observation")
                }
            }
        }
    }
}

@Composable
private fun NoteTypeChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = CareLogColors.Primary,
            selectedLabelColor = Color.White
        )
    )
}

@Composable
private fun VoiceRecordingSection(
    isRecording: Boolean,
    recordingDuration: Int,
    hasRecording: Boolean,
    onStartRecording: () -> Unit,
    onStopRecording: () -> Unit,
    onDeleteRecording: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (isRecording) {
                // Recording state
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .clip(CircleShape)
                            .background(CareLogColors.Error)
                    )
                    Text(
                        text = "Recording... ${formatDuration(recordingDuration)}",
                        style = MaterialTheme.typography.bodyLarge
                    )
                }

                IconButton(
                    onClick = onStopRecording,
                    modifier = Modifier
                        .size(64.dp)
                        .clip(CircleShape)
                        .background(CareLogColors.Error)
                ) {
                    Icon(
                        imageVector = Icons.Default.Stop,
                        contentDescription = "Stop recording",
                        tint = Color.White,
                        modifier = Modifier.size(32.dp)
                    )
                }
            } else if (hasRecording) {
                // Has recording state
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.CheckCircle,
                        contentDescription = null,
                        tint = CareLogColors.Success
                    )
                    Text(
                        text = "Voice note recorded (${formatDuration(recordingDuration)})",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(onClick = onStartRecording) {
                        Icon(Icons.Default.Refresh, contentDescription = null)
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Re-record")
                    }

                    OutlinedButton(
                        onClick = onDeleteRecording,
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = CareLogColors.Error
                        )
                    ) {
                        Icon(Icons.Default.Delete, contentDescription = null)
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Delete")
                    }
                }
            } else {
                // Initial state
                Text(
                    text = "Tap to record a voice note",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                IconButton(
                    onClick = onStartRecording,
                    modifier = Modifier
                        .size(64.dp)
                        .clip(CircleShape)
                        .background(CareLogColors.Primary)
                ) {
                    Icon(
                        imageVector = Icons.Default.Mic,
                        contentDescription = "Start recording",
                        tint = Color.White,
                        modifier = Modifier.size(32.dp)
                    )
                }
            }
        }
    }
}

private fun formatDuration(seconds: Int): String {
    val mins = seconds / 60
    val secs = seconds % 60
    return "%d:%02d".format(mins, secs)
}

/**
 * Note types for categorization.
 */
enum class NoteType {
    GENERAL, SYMPTOMS, MEDICATION
}

/**
 * ViewModel for attendant notes.
 */
@HiltViewModel
class AttendantNotesViewModel @Inject constructor(
    private val attendantSessionManager: AttendantSessionManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(AttendantNotesUiState())
    val uiState: StateFlow<AttendantNotesUiState> = _uiState.asStateFlow()

    private var recordingJob: kotlinx.coroutines.Job? = null

    fun setNoteType(type: NoteType) {
        _uiState.update { it.copy(noteType = type) }
    }

    fun updateTextNote(text: String) {
        _uiState.update { it.copy(textNote = text) }
    }

    fun toggleRecording() {
        if (_uiState.value.isRecording) {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private fun startRecording() {
        _uiState.update { it.copy(isRecording = true, recordingDuration = 0) }

        // Update duration every second
        recordingJob = viewModelScope.launch {
            while (_uiState.value.isRecording) {
                delay(1000)
                _uiState.update { it.copy(recordingDuration = it.recordingDuration + 1) }
            }
        }

        // Note: Actual MediaRecorder implementation would go here
    }

    private fun stopRecording() {
        recordingJob?.cancel()
        _uiState.update {
            it.copy(
                isRecording = false,
                hasVoiceRecording = true
            )
        }

        // Note: Save recording to file
    }

    fun deleteRecording() {
        _uiState.update {
            it.copy(
                hasVoiceRecording = false,
                recordingDuration = 0
            )
        }

        // Note: Delete recording file
    }

    fun saveNote() {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, error = null) }

            try {
                val performer = attendantSessionManager.getPerformerInfo()

                // Note: Save observation to FHIR store
                // - Create FHIR Observation with note type
                // - Include performer info
                // - Upload voice recording if present
                // - Add to sync queue

                delay(1000) // Simulate save

                _uiState.update { it.copy(isSaving = false, saveSuccess = true) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isSaving = false, error = e.message ?: "Failed to save")
                }
            }
        }
    }
}

/**
 * UI state for attendant notes.
 */
data class AttendantNotesUiState(
    val noteType: NoteType = NoteType.GENERAL,
    val textNote: String = "",
    val isRecording: Boolean = false,
    val recordingDuration: Int = 0,
    val hasVoiceRecording: Boolean = false,
    val isSaving: Boolean = false,
    val saveSuccess: Boolean = false,
    val error: String? = null
)

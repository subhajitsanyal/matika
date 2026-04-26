package com.carelog.onboarding.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.conversation.session.ConversationTurn
import com.carelog.conversation.session.SessionPhase
import com.carelog.conversation.ui.ConversationControls
import com.carelog.conversation.ui.TranscriptView
import com.carelog.dashboard.ui.ModelStatusBanner
import com.carelog.discovery.ModelHealthStatus
import com.carelog.onboarding.CaregiverOnboardingViewModel
import com.carelog.onboarding.ExtractedPatientProfile
import com.carelog.onboarding.OnboardingPhase
import com.carelog.onboarding.OnboardingTurn

/**
 * Conversation screen for caregiver patient onboarding.
 *
 * Reuses conversation UI components (TranscriptView, ConversationControls)
 * but uses CaregiverOnboardingViewModel instead of ConversationViewModel.
 * Shows extracted profile summary as it builds up.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientOnboardingConversationScreen(
    onNavigateBack: () -> Unit,
    onProfileComplete: (ExtractedPatientProfile) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: CaregiverOnboardingViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val isRecording by viewModel.isRecording.collectAsState()
    val isPlaying by viewModel.isPlaying.collectAsState()

    val snackbarHostState = remember { SnackbarHostState() }
    var textInput by remember { mutableStateOf("") }

    // Show error messages
    LaunchedEffect(uiState.errorMessage) {
        uiState.errorMessage?.let { message ->
            snackbarHostState.showSnackbar(message)
            viewModel.onErrorDismissed()
        }
    }

    // Navigate when profile is complete
    LaunchedEffect(uiState.profileComplete) {
        if (uiState.profileComplete) {
            onProfileComplete(viewModel.getExtractedProfile())
        }
    }

    // Map onboarding phase to session phase for reusing ConversationControls
    val sessionPhase = when (uiState.phase) {
        OnboardingPhase.NOT_STARTED -> SessionPhase.NOT_STARTED
        OnboardingPhase.STARTING -> SessionPhase.STARTING
        OnboardingPhase.ACTIVE -> SessionPhase.ACTIVE
        OnboardingPhase.PROFILE_COMPLETE -> SessionPhase.ENDED
        OnboardingPhase.ENDED -> SessionPhase.ENDED
    }

    // Map onboarding turns to conversation turns for TranscriptView
    val conversationTurns = uiState.conversationTurns.map { turn ->
        ConversationTurn(
            turnNumber = turn.turnNumber,
            patientText = turn.userText,
            systemText = turn.systemText,
            action = turn.action
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Patient Setup") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        modifier = modifier
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .imePadding()
        ) {
            // Transcript view
            TranscriptView(
                turns = conversationTurns,
                currentTranscript = uiState.currentTranscript,
                modifier = Modifier
                    .weight(1f)
                    .padding(vertical = 8.dp)
            )

            // Extracted profile summary (shows as fields are collected)
            if (uiState.extractedProfile.name.isNotBlank()) {
                ProfileSummaryCard(
                    profile = uiState.extractedProfile,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )
            }

            // Text input (fallback mode)
            if (uiState.showTextInput && uiState.phase == OnboardingPhase.ACTIVE) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = textInput,
                        onValueChange = { textInput = it },
                        placeholder = { Text("Type your response...") },
                        modifier = Modifier.weight(1f),
                        singleLine = true
                    )
                    IconButton(
                        onClick = {
                            viewModel.onTextSubmitted(textInput)
                            textInput = ""
                        },
                        enabled = textInput.isNotBlank(),
                        modifier = Modifier.size(48.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Send,
                            contentDescription = "Send",
                            tint = if (textInput.isNotBlank()) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            }
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Conversation controls
            ConversationControls(
                sessionPhase = sessionPhase,
                isRecording = isRecording,
                isProcessing = uiState.isProcessing,
                isPlayingAudio = isPlaying,
                onStartPressed = viewModel::onStartPressed,
                onRecordPressed = viewModel::onRecordPressed,
                onStopRecordingPressed = viewModel::onStopRecordingPressed,
                onPausePressed = {},
                onResumePressed = {},
                onStopPressed = viewModel::onStopPressed
            )
        }
    }
}

/**
 * Card showing the extracted patient profile as it builds up.
 */
@Composable
private fun ProfileSummaryCard(
    profile: ExtractedPatientProfile,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.5f)
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = "Patient Profile",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer
            )

            if (profile.name.isNotBlank()) {
                ProfileField("Name", profile.name)
            }
            profile.age?.let { ProfileField("Age", it.toString()) }
            profile.gender?.let { ProfileField("Gender", it) }
            if (profile.conditions.isNotEmpty()) {
                ProfileField("Conditions", profile.conditions.joinToString(", "))
            }
            if (profile.medications.isNotEmpty()) {
                ProfileField("Medications", profile.medications.joinToString(", "))
            }
            if (profile.allergies.isNotEmpty()) {
                ProfileField("Allergies", profile.allergies.joinToString(", "))
            }
            profile.emergencyContactName?.let { ProfileField("Emergency Contact", it) }
        }
    }
}

@Composable
private fun ProfileField(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "$label:",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSecondaryContainer
        )
    }
}

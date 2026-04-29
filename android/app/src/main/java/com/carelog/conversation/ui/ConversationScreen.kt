package com.carelog.conversation.ui

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.conversation.ConversationViewModel
import com.carelog.conversation.session.SessionPhase
import com.carelog.dashboard.ui.DegradationSeverity
import com.carelog.dashboard.ui.ModelStatusBanner
import com.carelog.dashboard.ui.computeDegradationState

/**
 * Main conversation screen composable.
 *
 * Layout (top to bottom), with logical focus order for accessibility:
 * 1. Model status banner (announced via LiveRegion)
 * 2. Scrollable transcript view with chat bubbles (list semantics)
 * 3. Value cards (confirmed/pending with screen reader descriptions)
 * 4. Degradation messages (when services are partially available)
 * 5. Text input (only in fallback mode or TTS-down text-only mode)
 * 6. Conversation controls (Start/Record/Pause/Stop with haptic feedback)
 *
 * Graceful degradation per spec Section 7.6:
 * - TTS down: skips TTS, shows text-only, hides audio indicators
 * - Vision down: hides camera/photo button
 * - LLM/STT down: disables conversation start
 * - All down: everything disabled with device-not-found message
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(
    onNavigateBack: () -> Unit,
    onNavigateToPhoto: () -> Unit,
    onSessionEnded: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: ConversationViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val isRecording by viewModel.isRecording.collectAsState()
    val isPlaying by viewModel.isPlaying.collectAsState()

    val snackbarHostState = remember { SnackbarHostState() }
    var textInput by remember { mutableStateOf("") }
    var hasAudioPermission by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasAudioPermission = granted
    }

    // Request mic permission on first load
    LaunchedEffect(Unit) {
        permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }

    // Compute degradation state from current model status
    val degradation = remember(uiState.modelStatus) {
        computeDegradationState(uiState.modelStatus)
    }

    // Show error messages as snackbar
    LaunchedEffect(uiState.errorMessage) {
        uiState.errorMessage?.let { message ->
            snackbarHostState.showSnackbar(message)
            viewModel.onErrorDismissed()
        }
    }

    // Navigate to summary when session ends
    LaunchedEffect(uiState.sessionPhase) {
        if (uiState.sessionPhase == SessionPhase.ENDED) {
            onSessionEnded()
        }
    }

    // Navigate to photo capture when requested (only if vision is available)
    LaunchedEffect(uiState.showCamera, degradation.visionAvailable) {
        if (uiState.showCamera && degradation.visionAvailable) {
            onNavigateToPhoto()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Health Check-in",
                        modifier = Modifier.semantics { heading() }
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = onNavigateBack,
                        modifier = Modifier.semantics {
                            contentDescription = "Navigate back"
                        }
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = null
                        )
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
            // 1. Model status banner - use live health, not stale uiState
            val liveHealth by viewModel.liveHealthStatus.collectAsState()
            if (liveHealth.overallStatus != com.carelog.discovery.OverallStatus.OFFLINE) {
                ModelStatusBanner(
                    healthStatus = liveHealth,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                )
            }

            // 2. Transcript view (takes available space)
            TranscriptView(
                turns = uiState.conversationTurns,
                currentTranscript = uiState.currentTranscript,
                modifier = Modifier
                    .weight(1f)
                    .padding(vertical = 8.dp)
            )

            // 3. Value cards section
            ValueCardsSection(
                confirmedValues = uiState.confirmedValues,
                pendingValues = uiState.pendingConfirmation,
                modifier = Modifier.padding(vertical = 4.dp)
            )

            // 4. Degradation message (when in degraded mode during active session)
            AnimatedVisibility(
                visible = degradation.message != null &&
                    degradation.severity == DegradationSeverity.WARNING &&
                    uiState.sessionPhase == SessionPhase.ACTIVE,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                degradation.message?.let { message ->
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 4.dp)
                    )
                }
            }

            // 5. Text input (always shown during active session as fallback for voice)
            val showTextBar = uiState.sessionPhase == SessionPhase.ACTIVE

            if (showTextBar) {
                TextInputBar(
                    text = textInput,
                    onTextChanged = { textInput = it },
                    onSendClicked = {
                        viewModel.onTextSubmitted(textInput)
                        textInput = ""
                    },
                    // Hide camera when vision is down
                    showCamera = degradation.visionAvailable && uiState.modelStatus.canCapturePhoto,
                    onCameraClicked = onNavigateToPhoto,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )
            }

            // Session phase label when paused
            AnimatedVisibility(
                visible = uiState.sessionPhase == SessionPhase.PAUSED,
                enter = fadeIn(),
                exit = fadeOut()
            ) {
                Text(
                    text = "Session paused",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .align(Alignment.CenterHorizontally)
                        .padding(4.dp)
                        .semantics {
                            contentDescription = "Session is paused. It will end automatically after 5 minutes."
                        }
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // 6. Conversation controls (focus order: last)
            ConversationControls(
                sessionPhase = uiState.sessionPhase,
                isRecording = isRecording,
                isProcessing = uiState.isProcessing,
                isPlayingAudio = isPlaying,
                onStartPressed = viewModel::onStartPressed,
                onRecordPressed = viewModel::onRecordPressed,
                onStopRecordingPressed = viewModel::onStopRecordingPressed,
                onPausePressed = viewModel::onPausePressed,
                onResumePressed = viewModel::onResumePressed,
                onStopPressed = viewModel::onStopPressed
            )
        }
    }
}

/**
 * Text input bar with send button and optional camera button.
 *
 * All interactive elements have minimum 48dp touch targets and
 * descriptive contentDescription for screen readers.
 */
@Composable
private fun TextInputBar(
    text: String,
    onTextChanged: (String) -> Unit,
    onSendClicked: () -> Unit,
    showCamera: Boolean,
    onCameraClicked: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (showCamera) {
            IconButton(
                onClick = onCameraClicked,
                modifier = Modifier
                    .size(48.dp)
                    .semantics {
                        contentDescription = "Take photo of medical device"
                    }
            ) {
                Icon(
                    imageVector = Icons.Filled.CameraAlt,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }

        OutlinedTextField(
            value = text,
            onValueChange = onTextChanged,
            placeholder = { Text("Type your response...") },
            modifier = Modifier
                .weight(1f)
                .testTag("conversation_text_input"),
            singleLine = true
        )

        IconButton(
            onClick = onSendClicked,
            enabled = text.isNotBlank(),
            modifier = Modifier
                .size(48.dp)
                .semantics {
                    contentDescription = if (text.isNotBlank()) {
                        "Send message"
                    } else {
                        "Send message, disabled. Type a message first."
                    }
                }
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.Send,
                contentDescription = null,
                tint = if (text.isNotBlank()) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                }
            )
        }
    }
}

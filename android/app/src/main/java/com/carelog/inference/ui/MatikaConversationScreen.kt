package com.carelog.inference.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.carelog.inference.ConversationFsmState
import com.carelog.inference.MatikaConversationUiState
import com.carelog.inference.MatikaConversationViewModel
import com.carelog.network.ExtractedValue
import com.carelog.network.ExtractedValueStatus
import com.carelog.network.ProtocolResult

/**
 * v2 conversation screen — minimal Compose UI for the patient
 * daily check-in flow. Pilot smoke-testing tool, not the final UX.
 *
 * Layout:
 *  - Top bar with FSM state badge + back button
 *  - "Last response" card (what the LLM said; also being spoken via TTS)
 *  - "I heard you say" card (last final STT transcript)
 *  - Pending values list with status chips
 *  - Still-needed parameter chips
 *  - Mic button + text input fallback + Pause/Stop controls
 *
 * The screen calls [MatikaConversationViewModel.startSession] in a
 * `LaunchedEffect(Unit)`; the ViewModel's idempotency guard handles
 * configuration-change re-entries.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MatikaConversationScreen(
    onNavigateBack: () -> Unit,
    onSessionEnded: () -> Unit,
    viewModel: MatikaConversationViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    // Microphone permission. Mirrors the v1 ConversationScreen pattern —
    // launch the request unconditionally on first entry; Android dedupes
    // silently when already granted. If the user denies, the next mic
    // press still surfaces SttResult.Error(PERMISSION_DENIED) into the
    // snackbar, prompting them to enable in Settings.
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* result handled implicitly via SttManager errors */ }

    LaunchedEffect(Unit) {
        permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        viewModel.startSession()
    }

    LaunchedEffect(uiState.sttError) {
        uiState.sttError?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.onErrorDismissed()
        }
    }

    // Surface failed-turn errors. Without this, a 4xx/5xx from the
    // backend was silently absorbed into state and the UI looked
    // frozen — the turn counter ticked up but no response or error
    // appeared.
    LaunchedEffect(uiState.conversation.lastError) {
        uiState.conversation.lastError?.let {
            snackbarHostState.showSnackbar("Turn failed: $it")
            viewModel.onTurnErrorDismissed()
        }
    }

    // Session-ended is now rendered inline as a completion card (see
    // SessionCompleteCard below). The v1 SessionSummaryScreen reads from
    // v1 in-memory session state that the v2 path doesn't populate, so
    // navigating there would mis-report "no clinical values captured"
    // even though the server side persisted them. Inline render avoids
    // the wrong-source bug. The Done button on the card calls
    // [onSessionEnded] when the user is ready to leave.

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Matika — v2 (dev)") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (uiState.sessionEnded) {
                SessionCompleteCard(
                    uiState = uiState,
                    onDone = onSessionEnded,
                )
            } else {
                FsmHeader(uiState)
                ResponseCard(uiState)
                UserSaidCard(uiState)
                PendingValuesSection(uiState.conversation.pendingConfirmation)
                StillNeededSection(uiState.conversation.stillNeeded)
                Spacer(Modifier.height(8.dp))
                MicAndControls(
                    uiState = uiState,
                    onMicPressed = viewModel::onMicPressed,
                    onPausePressed = viewModel::onPausePressed,
                    onResumePressed = viewModel::onResumePressed,
                    onStopPressed = viewModel::onStopPressed,
                )
                TextFallback(
                    enabled = !uiState.conversation.isProcessingTurn,
                    onSubmit = viewModel::onTextSubmitted,
                )
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun SessionCompleteCard(
    uiState: MatikaConversationUiState,
    onDone: () -> Unit,
) {
    // Caregiver onboarding sessions surface a protocolResult on the
    // turn that fires complete_session. Render the protocol summary
    // when present; otherwise render the patient_logging summary
    // (captured values).
    val protocol = uiState.protocolResult
    val captured = uiState.conversation.capturedThisSession

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.tertiaryContainer,
        ),
    ) {
        Column(Modifier.padding(20.dp)) {
            Text(
                "Session complete",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(4.dp))

            if (protocol != null) {
                CaregiverProtocolSummary(protocol)
            } else {
                PatientLoggingSummary(captured)
            }

            Spacer(Modifier.height(20.dp))
            Button(
                onClick = onDone,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Done")
            }
        }
    }
}

@Composable
private fun PatientLoggingSummary(captured: List<ExtractedValue>) {
    // Server-side persistence is independent of this UI: the
    // bedrock-router Lambda already wrote each confirmed value to S3
    // as a FHIR Observation and recorded the model_call telemetry.
    // This block is just a visual receipt for the patient.
    Text(
        "Thank you. The readings below have been recorded.",
        style = MaterialTheme.typography.bodyMedium,
    )
    Spacer(Modifier.height(16.dp))

    if (captured.isEmpty()) {
        // Edge case: server completed the session without any
        // confirmed value (e.g. patient asked for help, then
        // explicitly ended). Surface honestly rather than lie.
        Text(
            "No values were confirmed during this session.",
            style = MaterialTheme.typography.bodyMedium,
        )
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            captured.forEach { v ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        v.parameter,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        "${formatNumber(v.value)} ${v.unit}",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
            }
        }
    }
}

@Composable
private fun CaregiverProtocolSummary(protocol: ProtocolResult) {
    if (!protocol.extracted) {
        // Sonnet extraction was attempted but failed. Honest message
        // rather than fake success — caregivers will need to retry
        // and may want to know something went wrong.
        Text(
            "We couldn't extract the monitoring protocol. Please contact support — your conversation is saved.",
            style = MaterialTheme.typography.bodyMedium,
        )
        protocol.error?.let { reason ->
            Spacer(Modifier.height(8.dp))
            Text(
                "Reason: $reason",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        return
    }

    Text(
        "Thanks. The patient's monitoring plan has been saved.",
        style = MaterialTheme.typography.bodyMedium,
    )
    Spacer(Modifier.height(16.dp))

    Row(modifier = Modifier.fillMaxWidth()) {
        Text(
            "Parameters configured",
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f),
        )
        Text(
            protocol.parametersConfigured.toString(),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
        )
    }
    Spacer(Modifier.height(4.dp))
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(
            "Topics configured",
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f),
        )
        Text(
            protocol.topicsConfigured.toString(),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
        )
    }

    if (protocol.topicsSkipped.isNotEmpty()) {
        Spacer(Modifier.height(12.dp))
        Text(
            "Skipped (unknown topic names): ${protocol.topicsSkipped.joinToString(", ")}",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun FsmHeader(uiState: MatikaConversationUiState) {
    val fsm = uiState.conversation.fsmState
    val color = when (fsm) {
        ConversationFsmState.EMERGENCY -> MaterialTheme.colorScheme.errorContainer
        ConversationFsmState.UNKNOWN -> MaterialTheme.colorScheme.surfaceVariant
        else -> MaterialTheme.colorScheme.primaryContainer
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        AssistChip(
            onClick = {},
            label = { Text(fsm.name) },
            colors = AssistChipDefaults.assistChipColors(containerColor = color),
        )
        Spacer(Modifier.size(8.dp))
        if (uiState.conversation.isProcessingTurn) {
            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
            Spacer(Modifier.size(6.dp))
            Text("thinking…", style = MaterialTheme.typography.bodySmall)
        } else if (uiState.isSpeaking) {
            Text("speaking…", style = MaterialTheme.typography.bodySmall)
        } else if (uiState.isListening) {
            Text("listening…", style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.weight(1f))
        Text(
            text = "turn ${uiState.conversation.turnSequence}",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun ResponseCard(uiState: MatikaConversationUiState) {
    val response = uiState.conversation.lastResponseText
    if (response.isNullOrBlank()) return
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
        ),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                "Matika says",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(response, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun UserSaidCard(uiState: MatikaConversationUiState) {
    val partial = uiState.sttPartialTranscript
    val final = uiState.lastUserUtterance
    val text = when {
        partial.isNotBlank() -> partial
        final.isNotBlank() -> final
        else -> return
    }
    val label = if (partial.isNotBlank()) "you (live)" else "you said"
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(text, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun PendingValuesSection(values: List<ExtractedValue>) {
    if (values.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            "Pending confirmation",
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
        )
        values.forEach { v ->
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                ),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            v.parameter,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            "${formatNumber(v.value)} ${v.unit}",
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
                    AssistChip(
                        onClick = {},
                        label = { Text(statusLabel(v.status)) },
                    )
                }
            }
        }
    }
}

@Composable
private fun StillNeededSection(stillNeeded: List<String>) {
    if (stillNeeded.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            "Still needed",
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            stillNeeded.forEach { name ->
                AssistChip(onClick = {}, label = { Text(name) })
            }
        }
    }
}

@Composable
private fun MicAndControls(
    uiState: MatikaConversationUiState,
    onMicPressed: () -> Unit,
    onPausePressed: () -> Unit,
    onResumePressed: () -> Unit,
    onStopPressed: () -> Unit,
) {
    val processing = uiState.conversation.isProcessingTurn
    val paused = uiState.conversation.isPausedByUser

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .background(
                    color = if (uiState.isListening) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.primaryContainer
                    },
                    shape = CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            FilledIconButton(
                onClick = onMicPressed,
                enabled = !processing,
                modifier = Modifier.size(64.dp),
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = Color.Transparent,
                ),
            ) {
                Icon(
                    imageVector = if (uiState.isListening) Icons.Filled.MicOff else Icons.Filled.Mic,
                    contentDescription = if (uiState.isListening) "Stop listening" else "Start listening",
                    modifier = Modifier.size(32.dp),
                )
            }
        }

        OutlinedButton(
            onClick = if (paused) onResumePressed else onPausePressed,
            enabled = !processing,
        ) {
            Text(if (paused) "Resume" else "Pause")
        }

        OutlinedButton(
            onClick = onStopPressed,
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = MaterialTheme.colorScheme.error,
            ),
        ) {
            Text("Stop")
        }
    }
}

@Composable
private fun TextFallback(
    enabled: Boolean,
    onSubmit: (String) -> Unit,
) {
    var text by remember { mutableStateOf("") }
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.weight(1f),
            label = { Text("Type instead (fallback)") },
            shape = RoundedCornerShape(12.dp),
            enabled = enabled,
            singleLine = true,
        )
        Spacer(Modifier.size(8.dp))
        Button(
            onClick = {
                if (text.isNotBlank()) {
                    onSubmit(text)
                    text = ""
                }
            },
            enabled = enabled && text.isNotBlank(),
        ) {
            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
        }
    }
}

private fun statusLabel(status: String): String = when (status) {
    ExtractedValueStatus.PENDING_CONFIRMATION -> "pending"
    ExtractedValueStatus.CONFIRMED -> "confirmed"
    ExtractedValueStatus.REJECTED -> "rejected"
    else -> status
}

private fun formatNumber(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

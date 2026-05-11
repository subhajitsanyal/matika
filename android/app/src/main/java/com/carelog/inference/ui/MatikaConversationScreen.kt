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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
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
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
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
    /**
     * F23 — invoked when the caregiver taps "Use form instead" during
     * the voice patient-onboarding flow. Caller is responsible for
     * tearing down the placeholder session (the ViewModel's
     * onStopPressed fires POST /sessions/{id}/end) and navigating
     * onward to the form-based PatientOnboardingScreen.
     */
    onEscapeToForm: () -> Unit = {},
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
                // F23 — escape hatch during voice patient onboarding.
                // Visible whenever the route flagged us as voice
                // onboarding; tapping ends the placeholder session and
                // routes back to the form-based onboarding screen.
                if (uiState.isVoicePatientOnboarding) {
                    Spacer(Modifier.height(4.dp))
                    OutlinedButton(
                        onClick = {
                            viewModel.onStopPressed()
                            onEscapeToForm()
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("use_form_instead_button"),
                    ) {
                        Text("Use form instead")
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }

    // F23 — credentials form modal. Surfaced when the LLM emits
    // pause_session{reason: awaiting_patient_credentials}. Closing
    // with the back button or tapping outside calls
    // onPatientCredentialsDismissed; submitting passes the values to
    // the ViewModel and resumes the conversation.
    if (uiState.awaitingPatientCredentials) {
        PatientCredentialsDialog(
            onSubmit = { email, phone ->
                viewModel.onPatientCredentialsSubmitted(email, phone)
            },
            onDismiss = { viewModel.onPatientCredentialsDismissed() },
        )
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun PatientCredentialsDialog(
    onSubmit: (email: String, phone: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    val submitEnabled = email.isNotBlank() && phone.isNotBlank()

    AlertDialog(
        // AlertDialog renders in its own Compose Window (via Popup).
        // The root MainActivity's `testTagsAsResourceId = true` semantics
        // flag does NOT propagate across windows — without re-applying
        // it here, Maestro can't see the testTags on the inner fields.
        modifier = Modifier.semantics { testTagsAsResourceId = true },
        onDismissRequest = onDismiss,
        title = { Text("Patient contact details") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "We'll send the patient their login by email and SMS. " +
                        "Please type their email address and phone number.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("patient_credentials_email"),
                )
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    label = { Text("Phone (with country code)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("patient_credentials_phone"),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onSubmit(email, phone) },
                enabled = submitEnabled,
                modifier = Modifier.testTag("patient_credentials_submit"),
            ) {
                Text("Submit")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
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
        // Activity tags — F6. Maestro asserts on these between turns:
        //   matika_thinking_indicator   — Bedrock turn in flight
        //   matika_speaking_indicator   — TTS is playing (mic must wait
        //                                 or Soda will hear overlap)
        //   matika_listening_indicator  — STT mic is open
        // Multi-turn voice flows wait for `notVisible: speaking` before
        // tapping mic again so the playback doesn't bleed into capture.
        if (uiState.conversation.isProcessingTurn) {
            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
            Spacer(Modifier.size(6.dp))
            Text(
                "thinking…",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("matika_thinking_indicator"),
            )
        } else if (uiState.isSpeaking) {
            Text(
                "speaking…",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("matika_speaking_indicator"),
            )
        } else if (uiState.isListening) {
            Text(
                "listening…",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("matika_listening_indicator"),
            )
        }
        Spacer(Modifier.weight(1f))
        // matika_turn_counter — F6. Maestro can assert
        // `id: matika_turn_counter, text: "turn N"` to detect
        // turn-progression in multi-turn flows. The response-card
        // visibility alone isn't enough: it stays visible across
        // turns, so an "extendedWaitUntil visible" check after
        // turn 2's mic tap would pass on turn 1's residue.
        Text(
            text = "turn ${uiState.conversation.turnSequence}",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("matika_turn_counter"),
        )
    }
}

@Composable
private fun ResponseCard(uiState: MatikaConversationUiState) {
    val response = uiState.conversation.lastResponseText
    if (response.isNullOrBlank()) return
    // matika_response_card — F6. Only mounts when lastResponseText is
    // non-blank, which only happens after a successful /conversation/turn
    // round-trip. Maestro's `assertVisible: id: matika_response_card` is
    // therefore non-vacuous proof that the turn reached Bedrock and came
    // back. Replaces the prior `notVisible: thinking` assertion which
    // passed even when no turn was ever submitted.
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("matika_response_card"),
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
    // matika_user_said_card — companion to matika_response_card. Mounts
    // when STT has produced a final transcript (or partial is in-flight).
    // Useful as a faster signal than the response card for tests that
    // only need to verify "STT captured something" without waiting for
    // the LLM round-trip.
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("matika_user_said_card"),
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
                modifier = Modifier
                    .size(64.dp)
                    .testTag("matika_mic"),
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
    val submit: () -> Unit = {
        if (text.isNotBlank()) {
            onSubmit(text)
            text = ""
        }
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier
                .weight(1f)
                .testTag("matika_text_fallback"),
            label = { Text("Type instead (fallback)") },
            shape = RoundedCornerShape(12.dp),
            enabled = enabled,
            singleLine = true,
            // F23 — IME action submits the turn directly. Maestro can
            // dispatch ENTER via pressKey to fire this without tapping
            // the explicit Send button, which is occluded by the
            // keyboard at typical handset resolutions.
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { submit() }),
        )
        Spacer(Modifier.size(8.dp))
        Button(
            onClick = submit,
            enabled = enabled && text.isNotBlank(),
            modifier = Modifier.testTag("matika_text_send"),
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

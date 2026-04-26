package com.carelog.onboarding.ui

import android.util.Log
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.network.CloudApiService
import com.carelog.network.SendInviteRequest
import com.carelog.onboarding.InviteUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the invite screen after patient account creation.
 */
@HiltViewModel
class InviteViewModel @Inject constructor(
    private val cloudApiService: CloudApiService,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    companion object {
        private const val TAG = "InviteVM"
    }

    private val _uiState = MutableStateFlow(
        InviteUiState(
            patientId = savedStateHandle.get<String>("patientId") ?: "",
            patientName = savedStateHandle.get<String>("patientName") ?: "",
            temporaryPassword = savedStateHandle.get<String>("temporaryPassword") ?: ""
        )
    )
    val uiState: StateFlow<InviteUiState> = _uiState.asStateFlow()

    fun sendViaSms(phone: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSending = true, errorMessage = null) }
            try {
                cloudApiService.sendInvite(
                    SendInviteRequest(
                        patient_id = _uiState.value.patientId,
                        patient_name = _uiState.value.patientName,
                        invite_type = "patient",
                        channel = "sms",
                        recipient_email = null,
                        recipient_phone = phone,
                        temporary_password = _uiState.value.temporaryPassword
                    )
                )
                _uiState.update { it.copy(isSending = false, sentVia = "SMS") }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to send SMS invite", e)
                _uiState.update {
                    it.copy(isSending = false, errorMessage = "Failed to send SMS. Please try again.")
                }
            }
        }
    }

    fun sendViaEmail(email: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSending = true, errorMessage = null) }
            try {
                cloudApiService.sendInvite(
                    SendInviteRequest(
                        patient_id = _uiState.value.patientId,
                        patient_name = _uiState.value.patientName,
                        invite_type = "patient",
                        channel = "email",
                        recipient_email = email,
                        recipient_phone = null,
                        temporary_password = _uiState.value.temporaryPassword
                    )
                )
                _uiState.update { it.copy(isSending = false, sentVia = "Email") }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to send email invite", e)
                _uiState.update {
                    it.copy(isSending = false, errorMessage = "Failed to send email. Please try again.")
                }
            }
        }
    }

    fun inviteDoctor(email: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSending = true, errorMessage = null) }
            try {
                cloudApiService.sendInvite(
                    SendInviteRequest(
                        patient_id = _uiState.value.patientId,
                        patient_name = _uiState.value.patientName,
                        invite_type = "doctor",
                        channel = "email",
                        recipient_email = email,
                        recipient_phone = null,
                        temporary_password = null
                    )
                )
                _uiState.update { it.copy(isSending = false, sentVia = "Doctor invite sent") }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to send doctor invite", e)
                _uiState.update {
                    it.copy(isSending = false, errorMessage = "Failed to invite doctor.")
                }
            }
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }
}

/**
 * Screen shown after patient account creation.
 *
 * Displays patient credentials and provides options to send invites
 * via SMS or email. Also allows inviting a doctor.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteScreen(
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: InviteViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    var recipientPhone by remember { mutableStateOf("") }
    var recipientEmail by remember { mutableStateOf("") }
    var doctorEmail by remember { mutableStateOf("") }
    var showDoctorInvite by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.errorMessage) {
        uiState.errorMessage?.let { message ->
            snackbarHostState.showSnackbar(message)
            viewModel.dismissError()
        }
    }

    LaunchedEffect(uiState.sentVia) {
        uiState.sentVia?.let { via ->
            snackbarHostState.showSnackbar("Invite sent via $via")
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Invite Patient") }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        modifier = modifier
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Success icon
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = null,
                tint = Color(0xFF4CAF50),
                modifier = Modifier.size(64.dp)
            )

            Text(
                text = "Patient Account Created!",
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center
            )

            Text(
                text = "Share the login credentials with ${uiState.patientName.ifBlank { "the patient" }}.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )

            // Credentials card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "Temporary Credentials",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "Password: ${uiState.temporaryPassword}",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        text = "The patient will be asked to change their password on first login.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            HorizontalDivider()

            // Send via SMS
            OutlinedTextField(
                value = recipientPhone,
                onValueChange = { recipientPhone = it },
                label = { Text("Patient Phone Number") },
                leadingIcon = { Icon(Icons.Default.Phone, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("invite_phone")
            )

            Button(
                onClick = { viewModel.sendViaSms(recipientPhone) },
                enabled = recipientPhone.isNotBlank() && !uiState.isSending,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .testTag("invite_sms_button")
            ) {
                Icon(Icons.Default.Sms, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Send via SMS")
            }

            // Send via Email
            OutlinedTextField(
                value = recipientEmail,
                onValueChange = { recipientEmail = it },
                label = { Text("Patient Email") },
                leadingIcon = { Icon(Icons.Default.Email, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("invite_email")
            )

            Button(
                onClick = { viewModel.sendViaEmail(recipientEmail) },
                enabled = recipientEmail.isNotBlank() && !uiState.isSending,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .testTag("invite_email_button")
            ) {
                Icon(Icons.Default.Email, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Send via Email")
            }

            HorizontalDivider()

            // Doctor invite (optional, expandable)
            TextButton(
                onClick = { showDoctorInvite = !showDoctorInvite }
            ) {
                Text(if (showDoctorInvite) "Hide Doctor Invite" else "Also Invite a Doctor")
            }

            if (showDoctorInvite) {
                OutlinedTextField(
                    value = doctorEmail,
                    onValueChange = { doctorEmail = it },
                    label = { Text("Doctor's Email") },
                    leadingIcon = { Icon(Icons.Default.MedicalServices, contentDescription = null) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag("invite_doctor_email")
                )

                OutlinedButton(
                    onClick = { viewModel.inviteDoctor(doctorEmail) },
                    enabled = doctorEmail.isNotBlank() && !uiState.isSending,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                        .testTag("invite_doctor_button")
                ) {
                    Text("Invite Doctor")
                }
            }

            Spacer(modifier = Modifier.weight(1f))

            // Done button
            Button(
                onClick = onDone,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .testTag("invite_done_button")
            ) {
                Text("Done", style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}

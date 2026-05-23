package com.carelog.ui.invite

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Screen for inviting an attendant to care for a patient.
 *
 * Allows relatives to send invites via email or SMS.
 * The attendant receives a link to register and accept the invitation.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteAttendantScreen(
    patientId: String,
    patientName: String,
    onNavigateBack: () -> Unit,
    onInviteSent: () -> Unit,
    viewModel: InviteAttendantViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    var attendantName by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var useEmail by remember { mutableStateOf(true) }

    val isFormValid = attendantName.isNotBlank() &&
        (if (useEmail) email.isNotBlank() else phone.isNotBlank())

    // On a normal success, navigate immediately. On a "delivery_failed"
    // success (F52 sub-issue 4 — invite committed but credentials email
    // could not be sent), hold the screen and surface the warning dialog
    // so the caregiver can read the explanation before navigating away.
    val successState = uiState as? InviteAttendantUiState.Success
    LaunchedEffect(uiState) {
        if (successState != null && successState.emailStatus != "delivery_failed") {
            onInviteSent()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Invite Attendant") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            // Header
            Text(
                text = "Add a Caregiver",
                style = MaterialTheme.typography.headlineSmall
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Invite someone to help care for $patientName",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Info Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.secondaryContainer
                )
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSecondaryContainer
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = "The attendant will receive an invitation to create their account. Once accepted, they can log vitals and help monitor health.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Attendant Name
            OutlinedTextField(
                value = attendantName,
                onValueChange = { attendantName = it },
                label = { Text("Attendant's Name *") },
                leadingIcon = { Icon(Icons.Default.Person, contentDescription = null) },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("invite_attendant_name"),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next)
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Contact Method Toggle
            Text(
                text = "How would you like to send the invite?",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.align(Alignment.Start)
            )

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(
                    selected = useEmail,
                    onClick = { useEmail = true },
                    label = { Text("Email") },
                    leadingIcon = if (useEmail) {
                        { Icon(Icons.Default.Check, contentDescription = null) }
                    } else null,
                    modifier = Modifier
                        .weight(1f)
                        .testTag("invite_attendant_method_email")
                )
                FilterChip(
                    selected = !useEmail,
                    onClick = { useEmail = false },
                    label = { Text("SMS") },
                    leadingIcon = if (!useEmail) {
                        { Icon(Icons.Default.Check, contentDescription = null) }
                    } else null,
                    modifier = Modifier
                        .weight(1f)
                        .testTag("invite_attendant_method_sms")
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Email or Phone Input
            if (useEmail) {
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email Address *") },
                    leadingIcon = { Icon(Icons.Default.Email, contentDescription = null) },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("invite_attendant_email"),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Done
                    )
                )
            } else {
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    label = { Text("Phone Number *") },
                    leadingIcon = { Icon(Icons.Default.Phone, contentDescription = null) },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("invite_attendant_phone"),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Phone,
                        imeAction = ImeAction.Done
                    ),
                    supportingText = { Text("Include country code (e.g., +91)") }
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Error message
            if (uiState is InviteAttendantUiState.Error) {
                Text(
                    text = (uiState as InviteAttendantUiState.Error).message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Send Invite Button
            Button(
                onClick = {
                    viewModel.sendInvite(
                        patientId = patientId,
                        attendantName = attendantName,
                        email = if (useEmail) email else null,
                        phone = if (!useEmail) phone else null
                    )
                },
                enabled = isFormValid && uiState !is InviteAttendantUiState.Loading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .testTag("invite_attendant_send")
            ) {
                if (uiState is InviteAttendantUiState.Loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Send Invitation", style = MaterialTheme.typography.titleMedium)
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }

    if (successState?.emailStatus == "delivery_failed") {
        InviteSentDialog(
            attendantName = attendantName,
            emailStatus = "delivery_failed",
            fallbackMessage = successState.message,
            onDismiss = onInviteSent,
        )
    }
}

/**
 * Success dialog shown after invite is sent.
 *
 * Renders two variants based on `emailStatus`:
 *   - normal ("sent" / "verification_pending"): green check + standard copy.
 *   - "delivery_failed" (F52 sub-issue 4): warning icon + non-blocking copy
 *     telling the caregiver the invite is valid but the email didn't go
 *     out, so they need to share credentials manually. This is reached
 *     when the lambda returns 201 with emailStatus=delivery_failed
 *     (SES IAM gap or other SES-side failure after DB writes commit).
 */
@Composable
fun InviteSentDialog(
    attendantName: String,
    emailStatus: String? = null,
    fallbackMessage: String? = null,
    onDismiss: () -> Unit
) {
    val isDeliveryFailed = emailStatus == "delivery_failed"
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                if (isDeliveryFailed) Icons.Default.Warning else Icons.Default.CheckCircle,
                contentDescription = null,
                tint = if (isDeliveryFailed) MaterialTheme.colorScheme.tertiary
                    else MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .size(48.dp)
                    .testTag(
                        if (isDeliveryFailed) "invite_sent_dialog_delivery_failed"
                        else "invite_sent_dialog_success"
                    )
            )
        },
        title = {
            Text(
                if (isDeliveryFailed) "Invite Created" else "Invitation Sent!",
                modifier = Modifier.testTag(
                    if (isDeliveryFailed) "invite_sent_dialog_delivery_failed_title"
                    else "invite_sent_dialog_success_title"
                )
            )
        },
        text = {
            Text(
                if (isDeliveryFailed) {
                    fallbackMessage
                        ?: "We created the invite for $attendantName, but the credentials email could not be delivered. Please share their login details manually or retry from the care team screen."
                } else {
                    "We've sent an invitation to $attendantName. " +
                        "They will receive instructions to create their account and start caring for your loved one."
                }
            )
        },
        confirmButton = {
            Button(onClick = onDismiss) {
                Text("Done")
            }
        }
    )
}

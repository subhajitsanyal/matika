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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Screen for inviting a doctor to access patient health data.
 *
 * Allows relatives to invite their doctor via email.
 * Doctors access patient data through the web portal.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteDoctorScreen(
    patientId: String,
    patientName: String,
    onNavigateBack: () -> Unit,
    onInviteSent: () -> Unit,
    viewModel: InviteDoctorViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    var doctorName by remember { mutableStateOf("") }
    var doctorEmail by remember { mutableStateOf("") }
    var specialty by remember { mutableStateOf("") }
    var showSpecialtyDropdown by remember { mutableStateOf(false) }

    val specialties = listOf(
        "General Practitioner",
        "Internal Medicine",
        "Cardiology",
        "Endocrinology",
        "Geriatrics",
        "Neurology",
        "Pulmonology",
        "Nephrology",
        "Other"
    )

    val isFormValid = doctorName.isNotBlank() && doctorEmail.isNotBlank()

    LaunchedEffect(uiState) {
        if (uiState is InviteDoctorUiState.Success) {
            onInviteSent()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Invite Doctor") },
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
                text = "Add a Physician",
                style = MaterialTheme.typography.headlineSmall
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Invite $patientName's doctor to review health data",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Info Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.LocalHospital,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = "Doctors access patient data through our secure web portal. They can view vitals, set health thresholds, and receive alerts.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Doctor Name
            OutlinedTextField(
                value = doctorName,
                onValueChange = { doctorName = it },
                label = { Text("Doctor's Name *") },
                leadingIcon = { Icon(Icons.Default.Person, contentDescription = null) },
                placeholder = { Text("Dr. John Smith") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next)
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Doctor Email
            OutlinedTextField(
                value = doctorEmail,
                onValueChange = { doctorEmail = it },
                label = { Text("Email Address *") },
                leadingIcon = { Icon(Icons.Default.Email, contentDescription = null) },
                placeholder = { Text("doctor@example.com") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next
                )
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Specialty Dropdown
            ExposedDropdownMenuBox(
                expanded = showSpecialtyDropdown,
                onExpandedChange = { showSpecialtyDropdown = it }
            ) {
                OutlinedTextField(
                    value = specialty,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Specialty (Optional)") },
                    leadingIcon = { Icon(Icons.Default.MedicalServices, contentDescription = null) },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = showSpecialtyDropdown) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .menuAnchor()
                )
                ExposedDropdownMenu(
                    expanded = showSpecialtyDropdown,
                    onDismissRequest = { showSpecialtyDropdown = false }
                ) {
                    specialties.forEach { option ->
                        DropdownMenuItem(
                            text = { Text(option) },
                            onClick = {
                                specialty = option
                                showSpecialtyDropdown = false
                            }
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Permissions info
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "Physician Permissions",
                        style = MaterialTheme.typography.titleSmall
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    PermissionItem(icon = Icons.Default.Visibility, text = "View all health history")
                    PermissionItem(icon = Icons.Default.Tune, text = "Configure alert thresholds")
                    PermissionItem(icon = Icons.Default.Notifications, text = "Receive health alerts")
                    PermissionItem(icon = Icons.Default.Description, text = "Access medical documents")
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Error message
            if (uiState is InviteDoctorUiState.Error) {
                Text(
                    text = (uiState as InviteDoctorUiState.Error).message,
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
                        doctorName = doctorName,
                        doctorEmail = doctorEmail,
                        specialty = specialty.ifBlank { null }
                    )
                },
                enabled = isFormValid && uiState !is InviteDoctorUiState.Loading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
            ) {
                if (uiState is InviteDoctorUiState.Loading) {
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
}

@Composable
private fun PermissionItem(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(
        modifier = Modifier.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            icon,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(text, style = MaterialTheme.typography.bodySmall)
    }
}

package com.carelog.onboarding.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.onboarding.PatientSetupViewModel

/**
 * Screen for confirming and editing the extracted patient profile
 * before creating the patient account.
 *
 * Displays all extracted fields as editable form inputs.
 * On confirmation, calls the cloud API to create the patient.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientProfileConfirmationScreen(
    onNavigateBack: () -> Unit,
    onPatientCreated: (patientId: String, temporaryPassword: String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PatientSetupViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // Navigate when patient is created
    LaunchedEffect(uiState.patientId) {
        uiState.patientId?.let { patientId ->
            onPatientCreated(patientId, uiState.temporaryPassword ?: "")
        }
    }

    // Show errors
    LaunchedEffect(uiState.errorMessage) {
        uiState.errorMessage?.let { message ->
            snackbarHostState.showSnackbar(message)
            viewModel.dismissError()
        }
    }

    val profile = uiState.profile

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Confirm Patient Profile") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        bottomBar = {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shadowElevation = 8.dp
            ) {
                Button(
                    onClick = { viewModel.confirmAndCreatePatient() },
                    enabled = !uiState.isSubmitting && profile.name.isNotBlank(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                        .height(56.dp)
                        .testTag("confirm_patient_button")
                ) {
                    if (uiState.isSubmitting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    } else {
                        Icon(Icons.Default.CheckCircle, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Confirm & Create Account", style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
        },
        modifier = modifier
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 24.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Please review the patient information below. You can edit any field before creating the account.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(8.dp))

            // ── Basic Information ────────────────────────────────
            Text(
                text = "Basic Information",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )

            OutlinedTextField(
                value = profile.name,
                onValueChange = { viewModel.updateName(it) },
                label = { Text("Patient Name *") },
                leadingIcon = { Icon(Icons.Default.Person, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("profile_name"),
                isError = profile.name.isBlank()
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                OutlinedTextField(
                    value = profile.age?.toString() ?: "",
                    onValueChange = { viewModel.updateAge(it.toIntOrNull()) },
                    label = { Text("Age") },
                    singleLine = true,
                    modifier = Modifier.weight(1f).testTag("profile_age"),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                )

                OutlinedTextField(
                    value = profile.gender ?: "",
                    onValueChange = { viewModel.updateGender(it.ifBlank { null }) },
                    label = { Text("Gender") },
                    singleLine = true,
                    modifier = Modifier.weight(1f).testTag("profile_gender")
                )
            }

            OutlinedTextField(
                value = profile.dateOfBirth ?: "",
                onValueChange = { viewModel.updateDateOfBirth(it.ifBlank { null }) },
                label = { Text("Date of Birth") },
                leadingIcon = { Icon(Icons.Default.CalendarToday, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("profile_dob"),
                placeholder = { Text("YYYY-MM-DD") }
            )

            HorizontalDivider()

            // ── Medical Information ──────────────────────────────
            Text(
                text = "Medical Information",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )

            EditableListField(
                label = "Conditions",
                items = profile.conditions,
                onItemsChanged = { viewModel.updateConditions(it) },
                testTag = "profile_conditions"
            )

            EditableListField(
                label = "Medications",
                items = profile.medications,
                onItemsChanged = { viewModel.updateMedications(it) },
                testTag = "profile_medications"
            )

            EditableListField(
                label = "Allergies",
                items = profile.allergies,
                onItemsChanged = { viewModel.updateAllergies(it) },
                testTag = "profile_allergies"
            )

            HorizontalDivider()

            // ── Emergency Contact ────────────────────────────────
            Text(
                text = "Emergency Contact",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )

            OutlinedTextField(
                value = profile.emergencyContactName ?: "",
                onValueChange = { viewModel.updateEmergencyContactName(it) },
                label = { Text("Contact Name") },
                leadingIcon = { Icon(Icons.Default.ContactPhone, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("profile_emergency_name")
            )

            OutlinedTextField(
                value = profile.emergencyContactPhone ?: "",
                onValueChange = { viewModel.updateEmergencyContactPhone(it) },
                label = { Text("Contact Phone") },
                leadingIcon = { Icon(Icons.Default.Phone, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("profile_emergency_phone"),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone)
            )

            HorizontalDivider()

            // ── Doctor ──────────────────────────────────────────
            Text(
                text = "Primary Doctor (Optional)",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )

            OutlinedTextField(
                value = profile.primaryDoctor ?: "",
                onValueChange = { viewModel.updatePrimaryDoctor(it.ifBlank { null }) },
                label = { Text("Doctor's Name") },
                leadingIcon = { Icon(Icons.Default.MedicalServices, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("profile_doctor")
            )

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

/**
 * Editable list field that shows items as chips with the ability
 * to add new items and remove existing ones.
 */
@Composable
private fun EditableListField(
    label: String,
    items: List<String>,
    onItemsChanged: (List<String>) -> Unit,
    testTag: String,
    modifier: Modifier = Modifier
) {
    var newItem by remember { mutableStateOf("") }

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurface
        )

        Spacer(modifier = Modifier.height(4.dp))

        // Existing items as chips
        if (items.isNotEmpty()) {
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items.forEachIndexed { index, item ->
                    InputChip(
                        selected = false,
                        onClick = {
                            onItemsChanged(items.toMutableList().apply { removeAt(index) })
                        },
                        label = { Text(item) },
                        trailingIcon = {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "Remove $item",
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    )
                }
            }

            Spacer(modifier = Modifier.height(4.dp))
        }

        // Add new item
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = newItem,
                onValueChange = { newItem = it },
                placeholder = { Text("Add $label") },
                singleLine = true,
                modifier = Modifier.weight(1f).testTag(testTag)
            )
            IconButton(
                onClick = {
                    if (newItem.isNotBlank()) {
                        onItemsChanged(items + newItem.trim())
                        newItem = ""
                    }
                },
                enabled = newItem.isNotBlank(),
                modifier = Modifier.size(48.dp)
            ) {
                Icon(Icons.Default.Add, contentDescription = "Add")
            }
        }
    }
}

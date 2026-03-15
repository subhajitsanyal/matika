package com.carelog.ui.onboarding

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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import java.time.LocalDate

/**
 * Patient onboarding screen.
 *
 * Allows relatives to create a patient account by entering
 * the patient's details. Designed for accessibility with
 * large touch targets and clear labels.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientOnboardingScreen(
    onNavigateBack: () -> Unit,
    onPatientCreated: (String) -> Unit, // Patient ID
    viewModel: PatientOnboardingViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    var name by remember { mutableStateOf("") }
    var dateOfBirth by remember { mutableStateOf("") }
    var gender by remember { mutableStateOf("") }
    var bloodType by remember { mutableStateOf("") }
    var medicalConditions by remember { mutableStateOf("") }
    var allergies by remember { mutableStateOf("") }
    var medications by remember { mutableStateOf("") }
    var emergencyContactName by remember { mutableStateOf("") }
    var emergencyContactPhone by remember { mutableStateOf("") }

    var showGenderDropdown by remember { mutableStateOf(false) }
    var showBloodTypeDropdown by remember { mutableStateOf(false) }

    val genderOptions = listOf("Male", "Female", "Other", "Prefer not to say")
    val bloodTypeOptions = listOf("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown")

    val isFormValid = name.isNotBlank()

    LaunchedEffect(uiState) {
        when (uiState) {
            is PatientOnboardingUiState.Success -> {
                onPatientCreated((uiState as PatientOnboardingUiState.Success).patientId)
            }
            else -> {}
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Add Patient") },
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
                text = "Enter Patient Details",
                style = MaterialTheme.typography.headlineSmall
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Create an account for your loved one",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Required: Name
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Patient's Full Name *") },
                leadingIcon = { Icon(Icons.Default.Person, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next)
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Date of Birth
            OutlinedTextField(
                value = dateOfBirth,
                onValueChange = { dateOfBirth = it },
                label = { Text("Date of Birth (DD/MM/YYYY)") },
                leadingIcon = { Icon(Icons.Default.DateRange, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Number,
                    imeAction = ImeAction.Next
                )
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Gender dropdown
            ExposedDropdownMenuBox(
                expanded = showGenderDropdown,
                onExpandedChange = { showGenderDropdown = it }
            ) {
                OutlinedTextField(
                    value = gender,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Gender") },
                    leadingIcon = { Icon(Icons.Default.Person, contentDescription = null) },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = showGenderDropdown) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .menuAnchor()
                )
                ExposedDropdownMenu(
                    expanded = showGenderDropdown,
                    onDismissRequest = { showGenderDropdown = false }
                ) {
                    genderOptions.forEach { option ->
                        DropdownMenuItem(
                            text = { Text(option) },
                            onClick = {
                                gender = option
                                showGenderDropdown = false
                            }
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Blood Type dropdown
            ExposedDropdownMenuBox(
                expanded = showBloodTypeDropdown,
                onExpandedChange = { showBloodTypeDropdown = it }
            ) {
                OutlinedTextField(
                    value = bloodType,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Blood Type") },
                    leadingIcon = { Icon(Icons.Default.Favorite, contentDescription = null) },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = showBloodTypeDropdown) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .menuAnchor()
                )
                ExposedDropdownMenu(
                    expanded = showBloodTypeDropdown,
                    onDismissRequest = { showBloodTypeDropdown = false }
                ) {
                    bloodTypeOptions.forEach { option ->
                        DropdownMenuItem(
                            text = { Text(option) },
                            onClick = {
                                bloodType = option
                                showBloodTypeDropdown = false
                            }
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Medical Conditions
            OutlinedTextField(
                value = medicalConditions,
                onValueChange = { medicalConditions = it },
                label = { Text("Medical Conditions") },
                leadingIcon = { Icon(Icons.Default.MedicalServices, contentDescription = null) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                supportingText = { Text("Separate multiple conditions with commas") }
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Allergies
            OutlinedTextField(
                value = allergies,
                onValueChange = { allergies = it },
                label = { Text("Allergies") },
                leadingIcon = { Icon(Icons.Default.Warning, contentDescription = null) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                supportingText = { Text("Separate multiple allergies with commas") }
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Current Medications
            OutlinedTextField(
                value = medications,
                onValueChange = { medications = it },
                label = { Text("Current Medications") },
                leadingIcon = { Icon(Icons.Default.Medication, contentDescription = null) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                supportingText = { Text("Separate multiple medications with commas") }
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Section: Emergency Contact
            Text(
                text = "Emergency Contact",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.align(Alignment.Start)
            )

            Spacer(modifier = Modifier.height(8.dp))

            OutlinedTextField(
                value = emergencyContactName,
                onValueChange = { emergencyContactName = it },
                label = { Text("Contact Name") },
                leadingIcon = { Icon(Icons.Default.Person, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(16.dp))

            OutlinedTextField(
                value = emergencyContactPhone,
                onValueChange = { emergencyContactPhone = it },
                label = { Text("Contact Phone") },
                leadingIcon = { Icon(Icons.Default.Phone, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone)
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Error message
            if (uiState is PatientOnboardingUiState.Error) {
                Text(
                    text = (uiState as PatientOnboardingUiState.Error).message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Create Patient button
            Button(
                onClick = {
                    viewModel.createPatient(
                        name = name,
                        dateOfBirth = dateOfBirth.ifBlank { null },
                        gender = gender.ifBlank { null },
                        bloodType = bloodType.ifBlank { null },
                        medicalConditions = medicalConditions.split(",").map { it.trim() }.filter { it.isNotEmpty() },
                        allergies = allergies.split(",").map { it.trim() }.filter { it.isNotEmpty() },
                        medications = medications.split(",").map { it.trim() }.filter { it.isNotEmpty() },
                        emergencyContactName = emergencyContactName.ifBlank { null },
                        emergencyContactPhone = emergencyContactPhone.ifBlank { null }
                    )
                },
                enabled = isFormValid && uiState !is PatientOnboardingUiState.Loading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
            ) {
                if (uiState is PatientOnboardingUiState.Loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Text("Create Patient Account", style = MaterialTheme.typography.titleMedium)
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

/**
 * UI state for patient onboarding.
 */
sealed class PatientOnboardingUiState {
    object Idle : PatientOnboardingUiState()
    object Loading : PatientOnboardingUiState()
    data class Success(val patientId: String) : PatientOnboardingUiState()
    data class Error(val message: String) : PatientOnboardingUiState()
}

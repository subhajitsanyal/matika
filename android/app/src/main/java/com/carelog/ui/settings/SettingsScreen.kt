package com.carelog.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.api.RelativeApiService
import com.carelog.auth.AuthRepository
import com.carelog.auth.CareLogUser
import com.carelog.auth.PersonaType
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateBack: () -> Unit,
    onNavigateToPatientOnboarding: () -> Unit,
    onNavigateToCareTeam: () -> Unit,
    onNavigateToInviteAttendant: () -> Unit,
    onNavigateToInviteDoctor: () -> Unit,
    onSignedOut: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val user by viewModel.currentUser.collectAsState()
    val signOutState by viewModel.signOutState.collectAsState()
    val deletePatientState by viewModel.deletePatientState.collectAsState()
    var showDeletePatientDialog by remember { mutableStateOf(false) }

    LaunchedEffect(signOutState) {
        if (signOutState is SignOutState.Success) {
            onSignedOut()
        }
    }

    LaunchedEffect(deletePatientState) {
        if (deletePatientState is DeletePatientState.Success) {
            onSignedOut() // Return to login after patient deletion
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
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
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Spacer(modifier = Modifier.height(8.dp))

            // Account info card — all personas
            AccountInfoCard(user = user)

            // Relative-only sections
            if (user?.personaType == PersonaType.RELATIVE) {
                // Primary Patient card
                PrimaryPatientCard(
                    linkedPatientId = user?.linkedPatientId,
                    onCreatePatient = onNavigateToPatientOnboarding,
                    onDeletePatient = { showDeletePatientDialog = true },
                    isDeleting = deletePatientState is DeletePatientState.Loading
                )

                // Care team management
                SettingsActionRow(
                    icon = Icons.Default.Group,
                    title = "Manage Care Team",
                    subtitle = "View, add, or remove doctors and attendants",
                    onClick = onNavigateToCareTeam
                )

                SettingsActionRow(
                    icon = Icons.Default.PersonAdd,
                    title = "Invite Attendant",
                    subtitle = "Send an invite to a caregiver attendant",
                    onClick = onNavigateToInviteAttendant
                )

                SettingsActionRow(
                    icon = Icons.Default.MedicalServices,
                    title = "Invite Doctor",
                    subtitle = "Invite a doctor to view patient data",
                    onClick = onNavigateToInviteDoctor
                )

                // Doctor portal placeholder
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.secondaryContainer
                    )
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "Doctor Portal",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "A dedicated portal for doctors to review patient vitals and trends is coming soon.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                    }
                }
            }

            // Attendant-only section
            if (user?.personaType == PersonaType.ATTENDANT) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.tertiaryContainer
                    )
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "Attendant Session",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "You are logged in as an attendant. Vitals you record will be attributed to your account.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onTertiaryContainer
                        )
                    }
                }
            }

            // Sign out
            Spacer(modifier = Modifier.height(8.dp))

            OutlinedButton(
                onClick = { viewModel.signOut() },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                ),
                enabled = signOutState !is SignOutState.Loading
            ) {
                if (signOutState is SignOutState.Loading) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp))
                } else {
                    Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Sign Out")
                }
            }

            if (signOutState is SignOutState.Error) {
                Text(
                    text = (signOutState as SignOutState.Error).message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            if (deletePatientState is DeletePatientState.Error) {
                Text(
                    text = (deletePatientState as DeletePatientState.Error).message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }

    // Delete patient confirmation dialog
    if (showDeletePatientDialog) {
        AlertDialog(
            onDismissRequest = { showDeletePatientDialog = false },
            icon = { Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
            title = { Text("Delete Patient?") },
            text = {
                Text(
                    "This will permanently remove the patient and all associated care team members " +
                    "(attendants and doctors). Their accounts will be disabled and they will be notified by email.\n\n" +
                    "This action cannot be undone."
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showDeletePatientDialog = false
                        viewModel.deletePatient()
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Text("Delete Patient")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeletePatientDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun AccountInfoCard(user: CareLogUser?) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Icon(
                    Icons.Default.AccountCircle,
                    contentDescription = null,
                    modifier = Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = user?.name ?: "Loading...",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = user?.email ?: "",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                user?.personaType?.let { persona ->
                    AssistChip(
                        onClick = {},
                        label = {
                            Text(
                                when (persona) {
                                    PersonaType.PATIENT -> "Patient"
                                    PersonaType.RELATIVE -> "Caregiver"
                                    PersonaType.ATTENDANT -> "Attendant"
                                    PersonaType.DOCTOR -> "Doctor"
                                }
                            )
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun PrimaryPatientCard(
    linkedPatientId: String?,
    onCreatePatient: () -> Unit,
    onDeletePatient: () -> Unit,
    isDeleting: Boolean
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Primary Patient",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(modifier = Modifier.height(8.dp))
            if (linkedPatientId != null) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Text(
                            text = "Patient linked (ID: ${linkedPatientId.take(8)}...)",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedButton(
                    onClick = onDeletePatient,
                    enabled = !isDeleting,
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    ),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (isDeleting) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp))
                    } else {
                        Icon(Icons.Default.DeleteForever, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Delete Patient & All Associated Personas")
                    }
                }
            } else {
                Text(
                    text = "No patient linked yet. Create a patient profile to start recording vitals.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(8.dp))
                Button(onClick = onCreatePatient) {
                    Icon(Icons.Default.PersonAdd, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Create Patient")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsActionRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

sealed class SignOutState {
    object Idle : SignOutState()
    object Loading : SignOutState()
    object Success : SignOutState()
    data class Error(val message: String) : SignOutState()
}

sealed class DeletePatientState {
    object Idle : DeletePatientState()
    object Loading : DeletePatientState()
    object Success : DeletePatientState()
    data class Error(val message: String) : DeletePatientState()
}

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val apiService: RelativeApiService
) : ViewModel() {

    val currentUser: StateFlow<CareLogUser?> = authRepository.currentUser

    private val _signOutState = MutableStateFlow<SignOutState>(SignOutState.Idle)
    val signOutState: StateFlow<SignOutState> = _signOutState.asStateFlow()

    private val _deletePatientState = MutableStateFlow<DeletePatientState>(DeletePatientState.Idle)
    val deletePatientState: StateFlow<DeletePatientState> = _deletePatientState.asStateFlow()

    fun signOut() {
        viewModelScope.launch {
            _signOutState.value = SignOutState.Loading
            authRepository.signOut().fold(
                onSuccess = { _signOutState.value = SignOutState.Success },
                onFailure = { _signOutState.value = SignOutState.Error(it.message ?: "Sign out failed") }
            )
        }
    }

    fun deletePatient() {
        val patientId = authRepository.currentUser.value?.linkedPatientId ?: return
        viewModelScope.launch {
            _deletePatientState.value = DeletePatientState.Loading
            val success = apiService.deletePatient(patientId)
            if (success) {
                // Sign out after patient deletion since the data context is gone
                authRepository.signOut()
                _deletePatientState.value = DeletePatientState.Success
            } else {
                _deletePatientState.value = DeletePatientState.Error("Failed to delete patient. Please try again.")
            }
        }
    }
}

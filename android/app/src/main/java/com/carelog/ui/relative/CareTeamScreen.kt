package com.carelog.ui.relative

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.api.*
import com.carelog.auth.AuthRepository
import com.carelog.ui.theme.CareLogColors
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject

/**
 * Care team management screen showing attendants, doctors, and relatives.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CareTeamScreen(
    onNavigateBack: () -> Unit,
    viewModel: CareTeamViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var showInviteDialog by remember { mutableStateOf(false) }
    var inviteRole by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Care Team") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                }
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { showInviteDialog = true },
                icon = { Icon(Icons.Default.PersonAdd, contentDescription = null) },
                text = { Text("Invite") },
                containerColor = CareLogColors.Primary
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                uiState.isLoading -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                uiState.error != null -> {
                    ErrorContent(
                        message = uiState.error!!,
                        onRetry = { viewModel.loadCareTeam() },
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        // Doctors section
                        if (uiState.careTeam?.doctors?.isNotEmpty() == true) {
                            item {
                                SectionHeader(
                                    title = "Doctors",
                                    icon = Icons.Default.MedicalServices,
                                    count = uiState.careTeam!!.doctors.size
                                )
                            }

                            items(uiState.careTeam!!.doctors) { member ->
                                CareTeamMemberCard(
                                    member = member,
                                    roleColor = CareLogColors.Primary,
                                    onRemove = { viewModel.removeMember(member.id) },
                                    isRemoving = uiState.removingMemberId == member.id
                                )
                            }
                        }

                        // Attendants section
                        item {
                            SectionHeader(
                                title = "Attendants",
                                icon = Icons.Default.Person,
                                count = uiState.careTeam?.attendants?.size ?: 0,
                                onAddClick = {
                                    inviteRole = "attendant"
                                    showInviteDialog = true
                                }
                            )
                        }

                        if (uiState.careTeam?.attendants?.isNotEmpty() == true) {
                            items(uiState.careTeam!!.attendants) { member ->
                                CareTeamMemberCard(
                                    member = member,
                                    roleColor = CareLogColors.Success,
                                    onRemove = { viewModel.removeMember(member.id) },
                                    isRemoving = uiState.removingMemberId == member.id
                                )
                            }
                        } else {
                            item {
                                EmptySection(message = "No attendants yet. Invite someone to help care for the patient.")
                            }
                        }

                        // Relatives section
                        if (uiState.careTeam?.relatives?.isNotEmpty() == true) {
                            item {
                                SectionHeader(
                                    title = "Family Members",
                                    icon = Icons.Default.FamilyRestroom,
                                    count = uiState.careTeam!!.relatives.size
                                )
                            }

                            items(uiState.careTeam!!.relatives) { member ->
                                CareTeamMemberCard(member = member, roleColor = CareLogColors.Warning)
                            }
                        }

                        // Pending invites section
                        if (uiState.careTeam?.pendingInvites?.isNotEmpty() == true) {
                            item {
                                SectionHeader(
                                    title = "Pending Invitations",
                                    icon = Icons.Default.Schedule,
                                    count = uiState.careTeam!!.pendingInvites.size
                                )
                            }

                            items(uiState.careTeam!!.pendingInvites) { invite ->
                                PendingInviteCard(
                                    invite = invite,
                                    onResend = { viewModel.resendInvite(invite.id) },
                                    onCancel = { viewModel.cancelInvite(invite.id) }
                                )
                            }
                        }

                        // Bottom padding for FAB
                        item {
                            Spacer(modifier = Modifier.height(72.dp))
                        }
                    }
                }
            }
        }
    }

    // Invite dialog
    if (showInviteDialog) {
        InviteDialog(
            preselectedRole = inviteRole,
            onDismiss = {
                showInviteDialog = false
                inviteRole = null
            },
            onInvite = { email, name, role ->
                viewModel.sendInvite(email, name, role)
                showInviteDialog = false
                inviteRole = null
            }
        )
    }

    // Success snackbar
    if (uiState.inviteSuccess) {
        LaunchedEffect(Unit) {
            kotlinx.coroutines.delay(2000)
            viewModel.clearInviteSuccess()
        }
    }
}

@Composable
private fun SectionHeader(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    count: Int,
    onAddClick: (() -> Unit)? = null
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.surfaceVariant
            ) {
                Text(
                    text = count.toString(),
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                )
            }
        }

        onAddClick?.let {
            IconButton(onClick = it) {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = "Add",
                    tint = CareLogColors.Primary
                )
            }
        }
    }
}

@Composable
private fun CareTeamMemberCard(
    member: CareTeamMember,
    roleColor: Color,
    onRemove: (() -> Unit)? = null,
    isRemoving: Boolean = false
) {
    var showRemoveDialog by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Avatar
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(roleColor.copy(alpha = 0.1f)),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = member.name.take(2).uppercase(),
                    style = MaterialTheme.typography.titleMedium,
                    color = roleColor
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            // Info
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = member.name,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium
                )

                member.email?.let { email ->
                    Text(
                        text = email,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                member.joinedAt?.let { joinedAt ->
                    Text(
                        text = "Joined ${formatDate(joinedAt)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // Role badge
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = roleColor.copy(alpha = 0.1f)
            ) {
                Text(
                    text = member.role.replaceFirstChar { it.uppercase() },
                    style = MaterialTheme.typography.labelSmall,
                    color = roleColor,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                )
            }

            // Remove button (only for attendants and doctors)
            if (onRemove != null && member.role in listOf("attendant", "doctor")) {
                Spacer(modifier = Modifier.width(4.dp))
                if (isRemoving) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                } else {
                    IconButton(onClick = { showRemoveDialog = true }) {
                        Icon(
                            Icons.Default.RemoveCircleOutline,
                            contentDescription = "Remove ${member.name}",
                            tint = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }
        }
    }

    // Confirm removal dialog
    if (showRemoveDialog && onRemove != null) {
        AlertDialog(
            onDismissRequest = { showRemoveDialog = false },
            title = { Text("Remove ${member.name}?") },
            text = {
                Text(
                    "This will disable their account and remove their access to this patient. " +
                    "They will be notified by email. You can invite a replacement afterward."
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showRemoveDialog = false
                        onRemove()
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Text("Remove")
                }
            },
            dismissButton = {
                TextButton(onClick = { showRemoveDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun PendingInviteCard(
    invite: PendingInvite,
    onResend: () -> Unit,
    onCancel: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Icon
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Email,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            // Info
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = invite.email,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium
                )

                Text(
                    text = "Invited as ${invite.role}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Text(
                    text = "Sent ${formatDate(invite.sentAt)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // Actions
            Row {
                IconButton(onClick = onResend) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Resend",
                        tint = CareLogColors.Primary
                    )
                }

                IconButton(onClick = onCancel) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Cancel",
                        tint = MaterialTheme.colorScheme.error
                    )
                }
            }
        }
    }
}

@Composable
private fun EmptySection(message: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(16.dp)
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InviteDialog(
    preselectedRole: String?,
    onDismiss: () -> Unit,
    onInvite: (email: String, name: String, role: String) -> Unit
) {
    var email by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var selectedRole by remember { mutableStateOf(preselectedRole ?: "attendant") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Invite to Care Team") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                Column {
                    Text(
                        text = "Role",
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = selectedRole == "attendant",
                            onClick = { selectedRole = "attendant" },
                            label = { Text("Attendant") }
                        )

                        FilterChip(
                            selected = selectedRole == "doctor",
                            onClick = { selectedRole = "doctor" },
                            label = { Text("Doctor") }
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onInvite(email, name, selectedRole) },
                enabled = email.isNotBlank() && name.isNotBlank()
            ) {
                Text("Send Invite")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

@Composable
private fun ErrorContent(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.error
        )
        Button(onClick = onRetry) {
            Text("Retry")
        }
    }
}

private fun formatDate(instant: Instant): String {
    val formatter = DateTimeFormatter
        .ofPattern("MMM d, yyyy")
        .withZone(ZoneId.systemDefault())
    return formatter.format(instant)
}

/**
 * ViewModel for care team management.
 */
@HiltViewModel
class CareTeamViewModel @Inject constructor(
    private val apiService: RelativeApiService,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(CareTeamUiState())
    val uiState: StateFlow<CareTeamUiState> = _uiState.asStateFlow()

    init {
        loadCareTeam()
    }

    fun loadCareTeam() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                val user = authRepository.currentUser.value
                val patientId = user?.linkedPatientId ?: return@launch

                val careTeam = apiService.getCareTeam(patientId)

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        careTeam = careTeam,
                        patientId = patientId
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isLoading = false, error = e.message ?: "Failed to load care team")
                }
            }
        }
    }

    @Suppress("UNUSED_PARAMETER")
    fun sendInvite(email: String, name: String, role: String) {
        viewModelScope.launch {
            try {
                // Note: Would call invite API here
                // For now, just show success and refresh
                _uiState.update { it.copy(inviteSuccess = true) }
                loadCareTeam()
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(error = e.message ?: "Failed to send invite")
                }
            }
        }
    }

    fun removeMember(memberId: String) {
        val patientId = _uiState.value.patientId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(removingMemberId = memberId) }
            try {
                val success = apiService.removeTeamMember(patientId, memberId)
                if (success) {
                    _uiState.update { it.copy(removingMemberId = null) }
                    loadCareTeam() // Refresh the list
                } else {
                    _uiState.update {
                        it.copy(removingMemberId = null, error = "Failed to remove team member")
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(removingMemberId = null, error = e.message ?: "Failed to remove team member")
                }
            }
        }
    }

    @Suppress("UNUSED_PARAMETER")
    fun resendInvite(inviteId: String) {
        // Implementation would call API to resend invite
    }

    @Suppress("UNUSED_PARAMETER")
    fun cancelInvite(inviteId: String) {
        // Implementation would call API to cancel invite
        // Then refresh care team
        loadCareTeam()
    }

    fun clearInviteSuccess() {
        _uiState.update { it.copy(inviteSuccess = false) }
    }
}

/**
 * UI state for care team management.
 */
data class CareTeamUiState(
    val isLoading: Boolean = false,
    val careTeam: CareTeam? = null,
    val patientId: String? = null,
    val inviteSuccess: Boolean = false,
    val removingMemberId: String? = null,
    val error: String? = null
)

package com.carelog.ui.patient

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.api.CareTeamMember
import com.carelog.api.RelativeApiService
import com.carelog.auth.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * PT-V2-22 — patient-side read-only Care Team view.
 *
 * Lists the caregivers linked to the signed-in patient (per `persona_links`
 * rows where `relationship = 'caregiver'`). Doctor section is suppressed
 * until Phase 2 per the Stream D 2026-05-12 decision.
 *
 * Patient app gets its own patientId from `linkedPatientId` on the
 * authenticated user (Cognito `custom:linked_patient_id`, short form
 * like `CL-63NRGO`). The care-team lambda was updated 2026-05-14 to
 * accept either UUID or short form AND to authorize the patient
 * themselves via `patients.user_id`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientCareTeamScreen(
    onNavigateBack: () -> Unit,
    viewModel: PatientCareTeamViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("My Care Team") },
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
                .padding(horizontal = 16.dp)
                .testTag("patient_care_team_screen"),
        ) {
            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "The people who help look after you. Read-only — your caregiver " +
                    "manages who's on the team.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(16.dp))

            when (val s = uiState) {
                is PatientCareTeamUiState.Loading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.testTag("patient_care_team_loading")
                        )
                    }
                }
                is PatientCareTeamUiState.Error -> {
                    Text(
                        text = s.message,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag("patient_care_team_error"),
                    )
                }
                is PatientCareTeamUiState.Success -> {
                    if (s.caregivers.isEmpty()) {
                        Text(
                            text = "No caregivers yet.",
                            modifier = Modifier.testTag("patient_care_team_empty"),
                        )
                    } else {
                        LazyColumn(
                            modifier = Modifier.testTag("patient_care_team_list"),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(s.caregivers, key = { it.id }) { caregiver ->
                                CaregiverRow(caregiver)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CaregiverRow(caregiver: CareTeamMember) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("patient_care_team_caregiver_${caregiver.id}"),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                Icons.Default.Person,
                contentDescription = null,
                modifier = Modifier.size(40.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = caregiver.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                if (!caregiver.email.isNullOrBlank()) {
                    Text(
                        text = caregiver.email,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (caregiver.isPrimary) {
                AssistChip(
                    onClick = {},
                    label = { Text("Primary") },
                    leadingIcon = {
                        Icon(
                            Icons.Default.Star,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                        )
                    },
                    modifier = Modifier.testTag("patient_care_team_primary_badge_${caregiver.id}"),
                )
            }
        }
    }
}

sealed class PatientCareTeamUiState {
    object Loading : PatientCareTeamUiState()
    data class Success(val caregivers: List<CareTeamMember>) : PatientCareTeamUiState()
    data class Error(val message: String) : PatientCareTeamUiState()
}

@HiltViewModel
class PatientCareTeamViewModel @Inject constructor(
    private val apiService: RelativeApiService,
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<PatientCareTeamUiState>(PatientCareTeamUiState.Loading)
    val uiState: StateFlow<PatientCareTeamUiState> = _uiState.asStateFlow()

    init {
        loadCareTeam()
    }

    private fun loadCareTeam() {
        viewModelScope.launch {
            val patientId = authRepository.currentUser.value?.linkedPatientId
            if (patientId.isNullOrBlank()) {
                _uiState.value = PatientCareTeamUiState.Error(
                    "Account not linked to a patient profile yet."
                )
                return@launch
            }
            try {
                val team = apiService.getCareTeam(patientId)
                _uiState.value = PatientCareTeamUiState.Success(team.caregivers)
            } catch (e: Exception) {
                _uiState.value = PatientCareTeamUiState.Error(
                    e.message ?: "Failed to load care team."
                )
            }
        }
    }
}

package com.carelog.ui.invite

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.auth.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for doctor invite screen.
 */
@HiltViewModel
class InviteDoctorViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val inviteRepository: InviteRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<InviteDoctorUiState>(InviteDoctorUiState.Idle)
    val uiState: StateFlow<InviteDoctorUiState> = _uiState.asStateFlow()

    /**
     * Send an invitation to a doctor.
     */
    fun sendInvite(
        patientId: String,
        doctorName: String,
        doctorEmail: String,
        specialty: String?
    ) {
        viewModelScope.launch {
            _uiState.value = InviteDoctorUiState.Loading

            try {
                val token = authRepository.getAccessToken()
                    ?: throw Exception("Not authenticated")

                val result = inviteRepository.sendDoctorInvite(
                    token = token,
                    request = SendDoctorInviteRequest(
                        patientId = patientId,
                        doctorName = doctorName,
                        doctorEmail = doctorEmail,
                        specialty = specialty
                    )
                )

                _uiState.value = InviteDoctorUiState.Success(
                    inviteId = result.inviteId,
                    expiresAt = result.expiresAt
                )
            } catch (e: Exception) {
                _uiState.value = InviteDoctorUiState.Error(
                    e.message ?: "Failed to send invitation"
                )
            }
        }
    }

    /**
     * Reset the UI state.
     */
    fun resetState() {
        _uiState.value = InviteDoctorUiState.Idle
    }
}

/**
 * UI state for doctor invite screen.
 */
sealed class InviteDoctorUiState {
    object Idle : InviteDoctorUiState()
    object Loading : InviteDoctorUiState()
    data class Success(val inviteId: String, val expiresAt: String) : InviteDoctorUiState()
    data class Error(val message: String) : InviteDoctorUiState()
}

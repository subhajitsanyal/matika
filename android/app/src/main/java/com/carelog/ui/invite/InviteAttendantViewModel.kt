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
 * ViewModel for attendant invite screen.
 */
@HiltViewModel
class InviteAttendantViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val inviteRepository: InviteRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<InviteAttendantUiState>(InviteAttendantUiState.Idle)
    val uiState: StateFlow<InviteAttendantUiState> = _uiState.asStateFlow()

    /**
     * Send an invitation to an attendant.
     */
    fun sendInvite(
        patientId: String,
        attendantName: String,
        email: String?,
        phone: String?
    ) {
        viewModelScope.launch {
            _uiState.value = InviteAttendantUiState.Loading

            try {
                val token = authRepository.getAccessToken()
                    ?: throw Exception("Not authenticated")

                // Resolve patient ID from auth state if not provided
                val resolvedPatientId = patientId.takeIf { it.isNotEmpty() }
                    ?: authRepository.fetchLinkedPatientId()
                    ?: throw Exception("No patient linked to this account")

                val result = inviteRepository.sendAttendantInvite(
                    token = token,
                    request = SendInviteRequest(
                        patientId = resolvedPatientId,
                        attendantName = attendantName,
                        email = email,
                        phone = phone
                    )
                )

                _uiState.value = InviteAttendantUiState.Success(
                    inviteId = result.inviteId,
                    expiresAt = result.expiresAt
                )
            } catch (e: Exception) {
                _uiState.value = InviteAttendantUiState.Error(
                    e.message ?: "Failed to send invitation"
                )
            }
        }
    }

    /**
     * Reset the UI state.
     */
    fun resetState() {
        _uiState.value = InviteAttendantUiState.Idle
    }
}

/**
 * UI state for attendant invite screen.
 */
sealed class InviteAttendantUiState {
    object Idle : InviteAttendantUiState()
    object Loading : InviteAttendantUiState()
    data class Success(val inviteId: String, val expiresAt: String) : InviteAttendantUiState()
    data class Error(val message: String) : InviteAttendantUiState()
}

/**
 * Request model for sending invite.
 */
data class SendInviteRequest(
    val patientId: String,
    val attendantName: String,
    val email: String?,
    val phone: String?
)

/**
 * Response model from invite API.
 */
data class SendInviteResponse(
    val inviteId: String,
    val message: String,
    val expiresAt: String
)

/**
 * Repository for invite operations.
 */
interface InviteRepository {
    suspend fun sendAttendantInvite(token: String, request: SendInviteRequest): SendInviteResponse
    suspend fun sendDoctorInvite(token: String, request: SendDoctorInviteRequest): SendInviteResponse
}

/**
 * Request model for sending doctor invite.
 */
data class SendDoctorInviteRequest(
    val patientId: String,
    val doctorName: String,
    val doctorEmail: String,
    val specialty: String?
)

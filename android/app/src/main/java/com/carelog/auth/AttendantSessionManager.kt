package com.carelog.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages attendant session on a patient's device.
 * Allows attendant to log in temporarily to record vitals on behalf of patient.
 */
@Singleton
class AttendantSessionManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val authRepository: AuthRepository
) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "attendant_session_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    private val _currentAttendant = MutableStateFlow<AttendantInfo?>(null)
    val currentAttendant: StateFlow<AttendantInfo?> = _currentAttendant.asStateFlow()

    private val _isAttendantMode = MutableStateFlow(false)
    val isAttendantMode: StateFlow<Boolean> = _isAttendantMode.asStateFlow()

    companion object {
        private const val KEY_ATTENDANT_ID = "attendant_id"
        private const val KEY_ATTENDANT_NAME = "attendant_name"
        private const val KEY_ATTENDANT_TOKEN = "attendant_token"
        private const val KEY_SESSION_EXPIRY = "session_expiry"
        private const val SESSION_DURATION_MS = 8 * 60 * 60 * 1000L // 8 hours
    }

    init {
        // Restore session if valid
        restoreSession()
    }

    /**
     * Restore attendant session from storage if still valid.
     */
    private fun restoreSession() {
        val expiry = prefs.getLong(KEY_SESSION_EXPIRY, 0)
        if (System.currentTimeMillis() < expiry) {
            val attendantId = prefs.getString(KEY_ATTENDANT_ID, null)
            val attendantName = prefs.getString(KEY_ATTENDANT_NAME, null)

            if (attendantId != null && attendantName != null) {
                _currentAttendant.value = AttendantInfo(
                    id = attendantId,
                    name = attendantName
                )
                _isAttendantMode.value = true
            }
        } else {
            // Clear expired session
            clearSession()
        }
    }

    /**
     * Log in as attendant.
     */
    suspend fun loginAsAttendant(email: String, password: String): Result<AttendantInfo> {
        return try {
            // Authenticate with Cognito
            val result = authRepository.signIn(email, password)

            if (result.isSuccess) {
                val user = result.getOrThrow()

                // Verify user is an attendant
                if (user.personaType != PersonaType.ATTENDANT) {
                    return Result.failure(AttendantSessionException("User is not an attendant"))
                }

                // Store session
                val attendantInfo = AttendantInfo(
                    id = user.userId,
                    name = user.name
                )

                val token = authRepository.getAccessToken() ?: ""

                prefs.edit()
                    .putString(KEY_ATTENDANT_ID, attendantInfo.id)
                    .putString(KEY_ATTENDANT_NAME, attendantInfo.name)
                    .putString(KEY_ATTENDANT_TOKEN, token)
                    .putLong(KEY_SESSION_EXPIRY, System.currentTimeMillis() + SESSION_DURATION_MS)
                    .apply()

                _currentAttendant.value = attendantInfo
                _isAttendantMode.value = true

                Result.success(attendantInfo)
            } else {
                Result.failure(result.exceptionOrNull() ?: Exception("Login failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Log out attendant and return to patient mode.
     */
    fun logoutAttendant() {
        clearSession()
        _currentAttendant.value = null
        _isAttendantMode.value = false
    }

    /**
     * Clear stored session data.
     */
    private fun clearSession() {
        prefs.edit()
            .remove(KEY_ATTENDANT_ID)
            .remove(KEY_ATTENDANT_NAME)
            .remove(KEY_ATTENDANT_TOKEN)
            .remove(KEY_SESSION_EXPIRY)
            .apply()
    }

    /**
     * Get the current performer info for FHIR observations.
     * Returns attendant info if in attendant mode, null otherwise.
     */
    fun getPerformerInfo(): PerformerInfo? {
        val attendant = _currentAttendant.value ?: return null
        return PerformerInfo(
            id = attendant.id,
            name = attendant.name,
            role = "attendant"
        )
    }

    /**
     * Check if session is still valid.
     */
    fun isSessionValid(): Boolean {
        val expiry = prefs.getLong(KEY_SESSION_EXPIRY, 0)
        return System.currentTimeMillis() < expiry
    }

    /**
     * Extend session by another session duration.
     */
    fun extendSession() {
        if (_isAttendantMode.value) {
            prefs.edit()
                .putLong(KEY_SESSION_EXPIRY, System.currentTimeMillis() + SESSION_DURATION_MS)
                .apply()
        }
    }
}

/**
 * Attendant information.
 */
data class AttendantInfo(
    val id: String,
    val name: String
)

/**
 * Performer info for FHIR observations.
 */
data class PerformerInfo(
    val id: String,
    val name: String,
    val role: String
)

/**
 * Exception for attendant session errors.
 */
class AttendantSessionException(message: String) : Exception(message)

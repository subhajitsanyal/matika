package com.carelog.onboarding

/**
 * Patient profile extracted from the caregiver onboarding conversation.
 * Cumulative -- fields are filled as the LLM extracts them from conversation.
 */
data class ExtractedPatientProfile(
    val name: String = "",
    val age: Int? = null,
    val dateOfBirth: String? = null,
    val gender: String? = null,
    val conditions: List<String> = emptyList(),
    val medications: List<String> = emptyList(),
    val allergies: List<String> = emptyList(),
    val emergencyContactName: String? = null,
    val emergencyContactPhone: String? = null,
    val emergencyContactRelationship: String? = null,
    val primaryDoctor: String? = null
)

/**
 * LLM response for the caregiver onboarding conversation.
 * Maps to the output format defined in spec section 6.2.2.
 */
data class OnboardingLlmResponse(
    val response_text: String,
    val extracted_profile: LlmExtractedProfile?,
    val profile_complete: Boolean,
    val action: String
)

data class LlmExtractedProfile(
    val name: String?,
    val age: Int?,
    val date_of_birth: String?,
    val gender: String?,
    val conditions: List<String>?,
    val medications: List<String>?,
    val allergies: List<String>?,
    val emergency_contact_name: String?,
    val emergency_contact_phone: String?,
    val emergency_contact_relationship: String?,
    val primary_doctor: String?
)

/**
 * LLM response for the caregiver protocol configuration conversation.
 * Maps to the output format defined in spec section 6.2.3.
 */
data class ProtocolConfigLlmResponse(
    val response_text: String,
    val config_changes: List<ConfigChange>?,
    val topic_data: TopicData?,
    val action: String
)

data class ConfigChange(
    val action: String,
    val parameter: String,
    val loinc_codes: List<String>?,
    val unit: String?,
    val frequency_days: Int?,
    val daily_deadline: String?,
    val threshold_min: Double?,
    val threshold_max: Double?
)

data class TopicData(
    val topic_name: String,
    val collected_data: String?
)

/**
 * A parameter currently configured in the patient's monitoring protocol.
 */
data class ProtocolParameter(
    val name: String,
    val unit: String,
    val frequencyDays: Int?,
    val dailyDeadline: String?,
    val thresholdMin: Double?,
    val thresholdMax: Double?
)

/**
 * UI state for the onboarding conversation.
 */
data class OnboardingUiState(
    val phase: OnboardingPhase = OnboardingPhase.NOT_STARTED,
    val sessionId: String? = null,
    val extractedProfile: ExtractedPatientProfile = ExtractedPatientProfile(),
    val profileComplete: Boolean = false,
    val conversationTurns: List<OnboardingTurn> = emptyList(),
    val currentTranscript: String = "",
    val lastSystemResponse: String = "",
    val isRecording: Boolean = false,
    val isProcessing: Boolean = false,
    val errorMessage: String? = null,
    val showTextInput: Boolean = false,
    val retryCount: Int = 0
)

enum class OnboardingPhase {
    NOT_STARTED,
    STARTING,
    ACTIVE,
    PROFILE_COMPLETE,
    ENDED
}

data class OnboardingTurn(
    val turnNumber: Int,
    val userText: String,
    val systemText: String,
    val action: String? = null
)

/**
 * UI state for protocol configuration conversation.
 */
data class ProtocolConfigUiState(
    val phase: OnboardingPhase = OnboardingPhase.NOT_STARTED,
    val sessionId: String? = null,
    val parameters: List<ProtocolParameter> = emptyList(),
    val conversationTurns: List<OnboardingTurn> = emptyList(),
    val currentTranscript: String = "",
    val lastSystemResponse: String = "",
    val isRecording: Boolean = false,
    val isProcessing: Boolean = false,
    val errorMessage: String? = null,
    val showTextInput: Boolean = false,
    val retryCount: Int = 0,
    val configComplete: Boolean = false
)

/**
 * UI state for the patient profile confirmation screen.
 */
data class PatientSetupUiState(
    val profile: ExtractedPatientProfile = ExtractedPatientProfile(),
    val isSubmitting: Boolean = false,
    val patientId: String? = null,
    val temporaryPassword: String? = null,
    /**
     * Patient's Cognito sub from the create-patient response. Required
     * to launch the v2 caregiver-onboarding conversation in Phase C —
     * the v2 backend takes Cognito sub on the wire. Null when running
     * against pre-Phase-C backends; the caller falls back to the v1
     * route in that case.
     */
    val patientCognitoSub: String? = null,
    val errorMessage: String? = null
)

/**
 * UI state for the invite screen.
 */
data class InviteUiState(
    val patientId: String = "",
    val patientName: String = "",
    val temporaryPassword: String = "",
    val isSending: Boolean = false,
    val sentVia: String? = null,
    val errorMessage: String? = null
)

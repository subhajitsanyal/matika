package com.carelog.ui

import android.util.Log
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.carelog.auth.AuthState
import com.carelog.auth.AuthRepository
import com.carelog.auth.PersonaType
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import com.carelog.dashboard.ui.AlertListScreen
import com.carelog.dashboard.ui.CaregiverHomeScreen
import com.carelog.dashboard.ui.PatientHomeScreen
import com.carelog.dashboard.ui.PatientLogScreen
import com.carelog.onboarding.ui.CaregiverRegistrationScreen
import com.carelog.onboarding.ui.InviteScreen
import com.carelog.onboarding.ui.PatientOnboardingConversationScreen
import com.carelog.onboarding.ui.PatientProfileConfirmationScreen
import com.carelog.onboarding.ui.ProtocolConfigConversationScreen
import com.carelog.ui.attendant.AttendantDashboardScreen
import com.carelog.ui.attendant.AttendantLoginScreen
import com.carelog.ui.attendant.AttendantNotesScreen
import com.carelog.ui.auth.ForgotPasswordScreen
import com.carelog.ui.auth.LoginScreen
import com.carelog.ui.auth.RegisterScreen
import com.carelog.ui.auth.VerificationScreen
import com.carelog.conversation.ConversationViewModel
import com.carelog.conversation.ui.ConversationScreen
import com.carelog.conversation.ui.SessionSummaryScreen
import com.carelog.conversation.photo.DevicePhotoCaptureScreen
import com.carelog.ui.chat.ChatPlaceholderScreen
import com.carelog.ui.consent.ConsentScreen
import com.carelog.ui.dashboard.DashboardScreen
import com.carelog.ui.dashboard.VitalType
import com.carelog.ui.history.HistoryScreen
import com.carelog.ui.invite.InviteAttendantScreen
import com.carelog.ui.invite.InviteDoctorScreen
import com.carelog.ui.onboarding.PatientOnboardingScreen
import com.carelog.ui.relative.AlertInboxScreen
import com.carelog.ui.relative.AuditLogScreen
import com.carelog.ui.relative.CareTeamScreen
import com.carelog.ui.relative.RelativeDashboardScreen
import com.carelog.ui.relative.ReminderConfigScreen
import com.carelog.ui.relative.ThresholdConfigScreen
import com.carelog.ui.relative.TrendsScreen
import com.carelog.ui.settings.SettingsScreen
import com.carelog.ui.upload.CameraScreen
import com.carelog.ui.upload.PrescriptionScanScreen
import com.carelog.ui.upload.UploadScreen
import com.carelog.ui.upload.VideoRecorderScreen
import com.carelog.ui.upload.VoiceRecorderScreen
import com.carelog.ui.vitals.BloodPressureScreen
import com.carelog.ui.vitals.GlucoseScreen
import com.carelog.ui.vitals.PulseScreen
import com.carelog.ui.vitals.SpO2Screen
import com.carelog.ui.vitals.TemperatureScreen
import com.carelog.ui.vitals.WeightScreen
import com.carelog.upload.FileType

/**
 * Navigation routes for CareLog app.
 */
object CareLogRoutes {
    const val SPLASH = "splash"
    const val LOGIN = "login"
    const val REGISTER = "register"
    const val VERIFICATION = "verification/{email}"
    const val CONSENT = "consent"
    const val ONBOARDING = "onboarding"
    const val PATIENT_DASHBOARD = "patient_dashboard"
    const val RELATIVE_DASHBOARD = "relative_dashboard"
    const val CAREGIVER_DASHBOARD = "caregiver_dashboard"
    const val ATTENDANT_DASHBOARD = "attendant_dashboard"
    const val ATTENDANT_LOGIN = "attendant_login"
    const val ATTENDANT_NOTES = "attendant_notes"

    // Vital logging routes
    const val BLOOD_PRESSURE = "vital/blood_pressure"
    const val GLUCOSE = "vital/glucose"
    const val TEMPERATURE = "vital/temperature"
    const val WEIGHT = "vital/weight"
    const val PULSE = "vital/pulse"
    const val SPO2 = "vital/spo2"

    // Media capture routes
    const val UPLOAD = "upload"
    const val PRESCRIPTION_SCAN = "media/prescription"
    const val CAMERA = "media/camera/{fileType}"
    const val VOICE_NOTE = "media/voice"
    const val VIDEO_NOTE = "media/video"

    // History and settings
    const val HISTORY = "history"
    const val SETTINGS = "settings"
    const val CARE_TEAM = "care_team"
    const val THRESHOLDS = "thresholds"
    const val REMINDERS = "reminders"
    const val ALERTS = "alerts"
    const val TRENDS = "trends"
    const val AUDIT_LOG = "audit_log"

    // Invite screens
    const val INVITE_ATTENDANT = "invite_attendant"
    const val INVITE_DOCTOR = "invite_doctor"

    // Forgot password
    const val FORGOT_PASSWORD = "forgot_password"

    // LLM Chat placeholder
    const val CHAT = "chat"

    // Patient home with conversation support (P1)
    const val PATIENT_HOME = "patient_home"

    // Conversation session routes (P1)
    const val CONVERSATION = "conversation/{patientId}"
    const val SESSION_SUMMARY = "session_summary"
    const val DEVICE_PHOTO_CAPTURE = "device_photo_capture"

    // Caregiver onboarding routes (P2)
    const val CAREGIVER_REGISTRATION = "caregiver_registration"
    const val PATIENT_ONBOARDING_CONVERSATION = "patient_onboarding_conversation"
    const val PATIENT_PROFILE_CONFIRMATION = "patient_profile_confirmation"
    const val PROTOCOL_CONFIG_CONVERSATION = "protocol_config_conversation/{patientId}/{patientName}"
    const val CAREGIVER_INVITE = "caregiver_invite/{patientId}/{patientName}/{temporaryPassword}"

    // Caregiver dashboard routes (P2)
    const val PATIENT_LOGS = "patient_logs/{patientId}"
    const val CAREGIVER_ALERTS = "caregiver_alerts/{patientId}"

    fun verification(email: String) = "verification/$email"
    fun camera(fileType: FileType) = "media/camera/${fileType.name}"
    fun conversation(patientId: String) = "conversation/$patientId"
    fun protocolConfig(patientId: String, patientName: String) =
        "protocol_config_conversation/$patientId/$patientName"
    fun caregiverInvite(patientId: String, patientName: String, temporaryPassword: String) =
        "caregiver_invite/$patientId/$patientName/$temporaryPassword"
    fun patientLogs(patientId: String) = "patient_logs/$patientId"
    fun caregiverAlerts(patientId: String) = "caregiver_alerts/$patientId"
}

/**
 * Returns the dashboard route for a given persona type.
 */
@Suppress("DEPRECATION")
private fun dashboardRouteForPersona(persona: PersonaType): String = when (persona) {
    PersonaType.CAREGIVER -> CareLogRoutes.CAREGIVER_DASHBOARD
    // Legacy values — map to caregiver dashboard
    PersonaType.RELATIVE -> CareLogRoutes.CAREGIVER_DASHBOARD
    PersonaType.ATTENDANT -> CareLogRoutes.CAREGIVER_DASHBOARD
    PersonaType.PATIENT -> CareLogRoutes.PATIENT_HOME
    PersonaType.DOCTOR -> CareLogRoutes.PATIENT_DASHBOARD // fallback
}

/**
 * Main navigation host for CareLog app.
 *
 * Handles routing between all screens based on authentication
 * state and user persona (patient, attendant, relative).
 */
@Composable
fun CareLogNavHost() {
    val navController = rememberNavController()

    NavHost(
        navController = navController,
        startDestination = CareLogRoutes.SPLASH
    ) {
        // ── Splash ──────────────────────────────────────────────
        composable(CareLogRoutes.SPLASH) {
            SplashScreen(navController)
        }

        // ── Auth ────────────────────────────────────────────────
        composable(CareLogRoutes.LOGIN) {
            LoginScreen(
                onNavigateToRegister = {
                    navController.navigate(CareLogRoutes.REGISTER)
                },
                onLoginSuccess = {
                    // Route through splash to determine correct dashboard by persona
                    navController.navigate(CareLogRoutes.SPLASH) {
                        popUpTo(CareLogRoutes.LOGIN) { inclusive = true }
                    }
                },
                onNavigateToForgotPassword = {
                    navController.navigate(CareLogRoutes.FORGOT_PASSWORD)
                }
            )
        }

        composable(CareLogRoutes.REGISTER) {
            RegisterScreen(
                onNavigateToLogin = { navController.popBackStack() },
                onRegistrationSuccess = {
                    navController.navigate(CareLogRoutes.SPLASH) {
                        popUpTo(CareLogRoutes.LOGIN) { inclusive = true }
                    }
                },
                onNavigateToVerification = { email ->
                    navController.navigate(CareLogRoutes.verification(email))
                }
            )
        }

        composable(
            route = CareLogRoutes.VERIFICATION,
            arguments = listOf(navArgument("email") { type = NavType.StringType })
        ) { backStackEntry ->
            val email = backStackEntry.arguments?.getString("email") ?: ""
            VerificationScreen(
                email = email,
                onNavigateBack = { navController.popBackStack() },
                onVerificationSuccess = {
                    // Route through splash after verification to pick correct dashboard
                    navController.navigate(CareLogRoutes.SPLASH) {
                        popUpTo(CareLogRoutes.LOGIN) { inclusive = true }
                    }
                }
            )
        }

        composable(CareLogRoutes.CONSENT) {
            ConsentScreen(
                onConsentAccepted = {
                    navController.navigate(CareLogRoutes.ONBOARDING) {
                        popUpTo(CareLogRoutes.CONSENT) { inclusive = true }
                    }
                },
                onCancel = { navController.popBackStack() }
            )
        }

        composable(CareLogRoutes.ONBOARDING) {
            PatientOnboardingScreen(
                onNavigateBack = { navController.popBackStack() },
                onPatientCreated = {
                    navController.navigate(CareLogRoutes.SPLASH) {
                        popUpTo(CareLogRoutes.LOGIN) { inclusive = true }
                    }
                }
            )
        }

        // ── Patient Dashboard ───────────────────────────────────
        composable(CareLogRoutes.PATIENT_DASHBOARD) {
            DashboardScreen(
                onNavigateToVital = { vitalType ->
                    val route = when (vitalType) {
                        VitalType.BLOOD_PRESSURE -> CareLogRoutes.BLOOD_PRESSURE
                        VitalType.GLUCOSE -> CareLogRoutes.GLUCOSE
                        VitalType.TEMPERATURE -> CareLogRoutes.TEMPERATURE
                        VitalType.WEIGHT -> CareLogRoutes.WEIGHT
                        VitalType.PULSE -> CareLogRoutes.PULSE
                        VitalType.SPO2 -> CareLogRoutes.SPO2
                        VitalType.VOICE_NOTE -> CareLogRoutes.VOICE_NOTE
                        else -> return@DashboardScreen
                    }
                    navController.navigate(route)
                },
                onNavigateToUpload = {
                    navController.navigate(CareLogRoutes.UPLOAD)
                },
                onNavigateToChat = {
                    navController.navigate(CareLogRoutes.CHAT)
                },
                onNavigateToHistory = {
                    navController.navigate(CareLogRoutes.HISTORY)
                },
                onNavigateToSettings = {
                    navController.navigate(CareLogRoutes.SETTINGS)
                },
                onNavigateToAlerts = {
                    navController.navigate(CareLogRoutes.ALERTS)
                }
            )
        }

        // ── Vital Logging Screens ───────────────────────────────
        composable(CareLogRoutes.BLOOD_PRESSURE) {
            BloodPressureScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(CareLogRoutes.GLUCOSE) {
            GlucoseScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(CareLogRoutes.TEMPERATURE) {
            TemperatureScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(CareLogRoutes.WEIGHT) {
            WeightScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(CareLogRoutes.PULSE) {
            PulseScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(CareLogRoutes.SPO2) {
            SpO2Screen(onNavigateBack = { navController.popBackStack() })
        }

        // ── Upload & Media Capture ──────────────────────────────
        composable(CareLogRoutes.UPLOAD) {
            UploadScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToCamera = { fileType ->
                    navController.navigate(CareLogRoutes.camera(fileType))
                },
                onNavigateToVoiceRecorder = {
                    navController.navigate(CareLogRoutes.VOICE_NOTE)
                },
                onNavigateToVideoRecorder = {
                    navController.navigate(CareLogRoutes.VIDEO_NOTE)
                }
            )
        }

        composable(
            route = CareLogRoutes.CAMERA,
            arguments = listOf(navArgument("fileType") { type = NavType.StringType })
        ) { backStackEntry ->
            val fileTypeName = backStackEntry.arguments?.getString("fileType") ?: ""
            val fileType = try { FileType.valueOf(fileTypeName) } catch (_: Exception) { FileType.MEDICAL_PHOTO }
            CameraScreen(
                fileType = fileType,
                onNavigateBack = { navController.popBackStack() },
                onImageCaptured = { navController.popBackStack() }
            )
        }

        composable(CareLogRoutes.PRESCRIPTION_SCAN) {
            PrescriptionScanScreen(
                onNavigateBack = { navController.popBackStack() },
                onDocumentSelected = { _, _ -> navController.popBackStack() }
            )
        }

        composable(CareLogRoutes.VOICE_NOTE) {
            VoiceRecorderScreen(
                onNavigateBack = { navController.popBackStack() },
                onRecordingComplete = { navController.popBackStack() }
            )
        }

        composable(CareLogRoutes.VIDEO_NOTE) {
            VideoRecorderScreen(
                onNavigateBack = { navController.popBackStack() },
                onRecordingComplete = { navController.popBackStack() }
            )
        }

        // ── History ─────────────────────────────────────────────
        composable(CareLogRoutes.HISTORY) {
            HistoryScreen(onNavigateBack = { navController.popBackStack() })
        }

        // ── Settings ────────────────────────────────────────────
        composable(CareLogRoutes.SETTINGS) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToPatientOnboarding = {
                    navController.navigate(CareLogRoutes.ONBOARDING)
                },
                onNavigateToCareTeam = {
                    navController.navigate(CareLogRoutes.CARE_TEAM)
                },
                onNavigateToInviteAttendant = {
                    navController.navigate(CareLogRoutes.INVITE_ATTENDANT)
                },
                onNavigateToInviteDoctor = {
                    navController.navigate(CareLogRoutes.INVITE_DOCTOR)
                },
                onSignedOut = {
                    navController.navigate(CareLogRoutes.LOGIN) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        // ── Invite Screens ──────────────────────────────────────
        composable(CareLogRoutes.INVITE_ATTENDANT) {
            InviteAttendantScreen(
                patientId = "",  // ViewModel resolves this from auth state
                patientName = "",
                onNavigateBack = { navController.popBackStack() },
                onInviteSent = { navController.popBackStack() }
            )
        }

        composable(CareLogRoutes.INVITE_DOCTOR) {
            InviteDoctorScreen(
                patientId = "",
                patientName = "",
                onNavigateBack = { navController.popBackStack() },
                onInviteSent = { navController.popBackStack() }
            )
        }

        // ── Caregiver Dashboard (P2) ────────────────────────────
        composable(CareLogRoutes.CAREGIVER_DASHBOARD) {
            CaregiverHomeScreen(
                onNavigateToOnboarding = {
                    navController.navigate(CareLogRoutes.ONBOARDING)
                },
                onNavigateToPatientLogs = { patientId ->
                    navController.navigate(CareLogRoutes.patientLogs(patientId))
                },
                onNavigateToAlerts = { patientId ->
                    navController.navigate(CareLogRoutes.caregiverAlerts(patientId))
                },
                onNavigateToSettings = {
                    navController.navigate(CareLogRoutes.SETTINGS)
                }
            )
        }

        // ── Caregiver Registration (P2) ─────────────────────────
        composable(CareLogRoutes.CAREGIVER_REGISTRATION) {
            CaregiverRegistrationScreen(
                onNavigateBack = { navController.popBackStack() },
                onRegistrationSuccess = {
                    navController.navigate(CareLogRoutes.SPLASH) {
                        popUpTo(CareLogRoutes.LOGIN) { inclusive = true }
                    }
                },
                onNavigateToVerification = { email ->
                    navController.navigate(CareLogRoutes.verification(email))
                }
            )
        }

        // ── Patient Onboarding Conversation (P2) ────────────────
        composable(CareLogRoutes.PATIENT_ONBOARDING_CONVERSATION) {
            PatientOnboardingConversationScreen(
                onNavigateBack = { navController.popBackStack() },
                onProfileComplete = { _ ->
                    navController.navigate(CareLogRoutes.PATIENT_PROFILE_CONFIRMATION)
                }
            )
        }

        // ── Patient Profile Confirmation (P2) ───────────────────
        composable(CareLogRoutes.PATIENT_PROFILE_CONFIRMATION) {
            PatientProfileConfirmationScreen(
                onNavigateBack = { navController.popBackStack() },
                onPatientCreated = { patientId, temporaryPassword ->
                    navController.navigate(
                        CareLogRoutes.protocolConfig(patientId, "Patient")
                    ) {
                        popUpTo(CareLogRoutes.PATIENT_ONBOARDING_CONVERSATION) { inclusive = true }
                    }
                }
            )
        }

        // ── Protocol Config Conversation (P2) ───────────────────
        composable(
            route = CareLogRoutes.PROTOCOL_CONFIG_CONVERSATION,
            arguments = listOf(
                navArgument("patientId") { type = NavType.StringType },
                navArgument("patientName") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val patientId = backStackEntry.arguments?.getString("patientId") ?: ""
            val patientName = backStackEntry.arguments?.getString("patientName") ?: ""
            ProtocolConfigConversationScreen(
                onNavigateBack = { navController.popBackStack() },
                onConfigComplete = {
                    navController.navigate(
                        CareLogRoutes.caregiverInvite(patientId, patientName, "")
                    ) {
                        popUpTo(CareLogRoutes.CAREGIVER_DASHBOARD) { inclusive = false }
                    }
                }
            )
        }

        // ── Caregiver Invite Screen (P2) ────────────────────────
        composable(
            route = CareLogRoutes.CAREGIVER_INVITE,
            arguments = listOf(
                navArgument("patientId") { type = NavType.StringType },
                navArgument("patientName") { type = NavType.StringType },
                navArgument("temporaryPassword") { type = NavType.StringType }
            )
        ) {
            InviteScreen(
                onDone = {
                    navController.navigate(CareLogRoutes.CAREGIVER_DASHBOARD) {
                        popUpTo(CareLogRoutes.CAREGIVER_DASHBOARD) { inclusive = true }
                    }
                }
            )
        }

        // ── Patient Logs (P2) ───────────────────────────────────
        composable(
            route = CareLogRoutes.PATIENT_LOGS,
            arguments = listOf(navArgument("patientId") { type = NavType.StringType })
        ) {
            PatientLogScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }

        // ── Caregiver Alerts (P2) ───────────────────────────────
        composable(
            route = CareLogRoutes.CAREGIVER_ALERTS,
            arguments = listOf(navArgument("patientId") { type = NavType.StringType })
        ) {
            AlertListScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }

        // ── Relative Dashboard & Screens (legacy) ──────────────
        composable(CareLogRoutes.RELATIVE_DASHBOARD) {
            RelativeDashboardScreen(
                onNavigateToTrends = { navController.navigate(CareLogRoutes.TRENDS) },
                onNavigateToAlerts = { navController.navigate(CareLogRoutes.ALERTS) },
                onNavigateToSettings = {
                    navController.navigate(CareLogRoutes.SETTINGS)
                },
                onNavigateToCareTeam = { navController.navigate(CareLogRoutes.CARE_TEAM) },
                onNavigateToThresholds = { navController.navigate(CareLogRoutes.THRESHOLDS) },
                onNavigateToReminders = { navController.navigate(CareLogRoutes.REMINDERS) }
            )
        }

        composable(CareLogRoutes.TRENDS) {
            TrendsScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(CareLogRoutes.ALERTS) {
            AlertInboxScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(CareLogRoutes.CARE_TEAM) {
            CareTeamScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(CareLogRoutes.THRESHOLDS) {
            ThresholdConfigScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(CareLogRoutes.REMINDERS) {
            ReminderConfigScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(CareLogRoutes.AUDIT_LOG) {
            AuditLogScreen(onNavigateBack = { navController.popBackStack() })
        }

        // ── Attendant Screens ───────────────────────────────────
        composable(CareLogRoutes.ATTENDANT_LOGIN) {
            AttendantLoginScreen(
                onNavigateBack = { navController.popBackStack() },
                onLoginSuccess = {
                    navController.navigate(CareLogRoutes.ATTENDANT_DASHBOARD) {
                        popUpTo(CareLogRoutes.ATTENDANT_LOGIN) { inclusive = true }
                    }
                }
            )
        }

        composable(CareLogRoutes.ATTENDANT_DASHBOARD) {
            AttendantDashboardScreen(
                onNavigateToBloodPressure = { navController.navigate(CareLogRoutes.BLOOD_PRESSURE) },
                onNavigateToGlucose = { navController.navigate(CareLogRoutes.GLUCOSE) },
                onNavigateToTemperature = { navController.navigate(CareLogRoutes.TEMPERATURE) },
                onNavigateToWeight = { navController.navigate(CareLogRoutes.WEIGHT) },
                onNavigateToPulse = { navController.navigate(CareLogRoutes.PULSE) },
                onNavigateToSpO2 = { navController.navigate(CareLogRoutes.SPO2) },
                onNavigateToUpload = { navController.navigate(CareLogRoutes.UPLOAD) },
                onNavigateToNotes = { navController.navigate(CareLogRoutes.ATTENDANT_NOTES) },
                onNavigateToHistory = { navController.navigate(CareLogRoutes.HISTORY) },
                onNavigateToSettings = {
                    navController.navigate(CareLogRoutes.SETTINGS)
                },
                onSwitchToPatient = {
                    navController.navigate(CareLogRoutes.PATIENT_DASHBOARD)
                }
            )
        }

        composable(CareLogRoutes.ATTENDANT_NOTES) {
            AttendantNotesScreen(onNavigateBack = { navController.popBackStack() })
        }

        // ── Forgot Password ─────────────────────────────────────
        composable(CareLogRoutes.FORGOT_PASSWORD) {
            ForgotPasswordScreen(
                onNavigateBack = { navController.popBackStack() },
                onPasswordResetSuccess = {
                    navController.navigate(CareLogRoutes.LOGIN) {
                        popUpTo(CareLogRoutes.FORGOT_PASSWORD) { inclusive = true }
                    }
                }
            )
        }

        // ── Chat (Placeholder) ──────────────────────────────────
        composable(CareLogRoutes.CHAT) {
            ChatPlaceholderScreen(onNavigateBack = { navController.popBackStack() })
        }

        // ── Patient Home with Conversation (P1) ────────────────
        composable(CareLogRoutes.PATIENT_HOME) {
            val authRepo = hiltViewModel<PatientHomeNavHelper>().authRepository
            PatientHomeScreen(
                onStartConversation = {
                    val patientId = authRepo.currentUser.value?.linkedPatientId ?: "self"
                    navController.navigate(CareLogRoutes.conversation(patientId))
                },
                onNavigateToSettings = {
                    navController.navigate(CareLogRoutes.SETTINGS)
                }
            )
        }

        // ── Conversation Session (P1) ──────────────────────────
        composable(
            route = CareLogRoutes.CONVERSATION,
            arguments = listOf(navArgument("patientId") { type = NavType.StringType })
        ) {
            ConversationScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToPhoto = {
                    navController.navigate(CareLogRoutes.DEVICE_PHOTO_CAPTURE)
                },
                onSessionEnded = {
                    navController.navigate(CareLogRoutes.SESSION_SUMMARY) {
                        popUpTo(CareLogRoutes.CONVERSATION) { inclusive = true }
                    }
                }
            )
        }

        composable(CareLogRoutes.SESSION_SUMMARY) {
            SessionSummaryScreen(
                onDoneClicked = {
                    // Try PATIENT_HOME first (voice flow), fall back to PATIENT_DASHBOARD (legacy)
                    val popped = navController.popBackStack(
                        route = CareLogRoutes.PATIENT_HOME,
                        inclusive = false
                    )
                    if (!popped) {
                        navController.popBackStack(
                            route = CareLogRoutes.PATIENT_DASHBOARD,
                            inclusive = false
                        )
                    }
                }
            )
        }

        composable(CareLogRoutes.DEVICE_PHOTO_CAPTURE) {
            DevicePhotoCaptureScreen(
                onPhotoConfirmed = { _ ->
                    // Photo bytes are passed via shared ViewModel; navigate back
                    navController.popBackStack()
                },
                onNavigateBack = { navController.popBackStack() }
            )
        }
    }
}

/**
 * ViewModel for SplashScreen.
 * Uses AuthRepository to check session AND populate currentUser,
 * so downstream ViewModels (RelativeDashboard, etc.) have user data.
 */
@HiltViewModel
class SplashViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _navigateTo = MutableStateFlow<String?>(null)
    val navigateTo: StateFlow<String?> = _navigateTo.asStateFlow()

    init {
        viewModelScope.launch {
            try {
                // This populates authRepository.currentUser AND authState
                authRepository.checkAuthSession()

                val state = authRepository.authState.value
                when (state) {
                    is AuthState.Authenticated -> {
                        val persona = state.user.personaType
                        Log.d("SplashViewModel", "Authenticated as $persona, linkedPatientId=${state.user.linkedPatientId}")
                        _navigateTo.value = dashboardRouteForPersona(persona)
                    }
                    else -> {
                        _navigateTo.value = CareLogRoutes.LOGIN
                    }
                }
            } catch (e: Exception) {
                Log.w("SplashViewModel", "Auth check failed", e)
                _navigateTo.value = CareLogRoutes.LOGIN
            }
        }
    }
}

@HiltViewModel
class PatientHomeNavHelper @Inject constructor(
    val authRepository: AuthRepository
) : ViewModel()

@Composable
private fun SplashScreen(navController: NavController) {
    val viewModel: SplashViewModel = hiltViewModel()
    val navigateTo by viewModel.navigateTo.collectAsState()

    navigateTo?.let { destination ->
        LaunchedEffect(destination) {
            navController.navigate(destination) {
                popUpTo(CareLogRoutes.SPLASH) { inclusive = true }
            }
        }
    }

    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        CircularProgressIndicator()
    }
}

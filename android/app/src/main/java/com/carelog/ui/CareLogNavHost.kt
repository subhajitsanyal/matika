package com.carelog.ui

import android.util.Log
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.amplifyframework.core.Amplify
import com.carelog.ui.attendant.AttendantDashboardScreen
import com.carelog.ui.attendant.AttendantLoginScreen
import com.carelog.ui.attendant.AttendantNotesScreen
import com.carelog.ui.auth.LoginScreen
import com.carelog.ui.auth.RegisterScreen
import com.carelog.ui.auth.VerificationScreen
import com.carelog.ui.chat.ChatPlaceholderScreen
import com.carelog.ui.consent.ConsentScreen
import com.carelog.ui.dashboard.DashboardScreen
import com.carelog.ui.dashboard.VitalType
import com.carelog.ui.history.HistoryScreen
import com.carelog.ui.onboarding.PatientOnboardingScreen
import com.carelog.ui.relative.AlertInboxScreen
import com.carelog.ui.relative.AuditLogScreen
import com.carelog.ui.relative.CareTeamScreen
import com.carelog.ui.relative.RelativeDashboardScreen
import com.carelog.ui.relative.ReminderConfigScreen
import com.carelog.ui.relative.ThresholdConfigScreen
import com.carelog.ui.relative.TrendsScreen
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
import kotlinx.coroutines.delay

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
    const val CARE_TEAM = "care_team"
    const val THRESHOLDS = "thresholds"
    const val REMINDERS = "reminders"
    const val ALERTS = "alerts"
    const val TRENDS = "trends"
    const val AUDIT_LOG = "audit_log"

    // LLM Chat placeholder
    const val CHAT = "chat"

    fun verification(email: String) = "verification/$email"
    fun camera(fileType: FileType) = "media/camera/${fileType.name}"
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
                    navController.navigate(CareLogRoutes.PATIENT_DASHBOARD) {
                        popUpTo(CareLogRoutes.LOGIN) { inclusive = true }
                    }
                },
                onNavigateToForgotPassword = { /* TODO */ }
            )
        }

        composable(CareLogRoutes.REGISTER) {
            RegisterScreen(
                onNavigateToLogin = { navController.popBackStack() },
                onRegistrationSuccess = {
                    navController.navigate(CareLogRoutes.PATIENT_DASHBOARD) {
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
                    navController.navigate(CareLogRoutes.PATIENT_DASHBOARD) {
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
                    navController.navigate(CareLogRoutes.PATIENT_DASHBOARD) {
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
                onNavigateToSettings = { /* TODO: Settings screen */ }
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

        // ── Relative Dashboard & Screens ────────────────────────
        composable(CareLogRoutes.RELATIVE_DASHBOARD) {
            RelativeDashboardScreen(
                onNavigateToTrends = { navController.navigate(CareLogRoutes.TRENDS) },
                onNavigateToAlerts = { navController.navigate(CareLogRoutes.ALERTS) },
                onNavigateToSettings = { /* TODO */ },
                onNavigateToCareTeam = { navController.navigate(CareLogRoutes.CARE_TEAM) }
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
                onSwitchToPatient = {
                    navController.navigate(CareLogRoutes.PATIENT_DASHBOARD) {
                        popUpTo(CareLogRoutes.ATTENDANT_DASHBOARD) { inclusive = true }
                    }
                }
            )
        }

        composable(CareLogRoutes.ATTENDANT_NOTES) {
            AttendantNotesScreen(onNavigateBack = { navController.popBackStack() })
        }

        // ── Chat (Placeholder) ──────────────────────────────────
        composable(CareLogRoutes.CHAT) {
            ChatPlaceholderScreen(onNavigateBack = { navController.popBackStack() })
        }
    }
}

@Composable
private fun SplashScreen(navController: NavController) {
    val navigateTo = remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        delay(1500)
        try {
            Amplify.Auth.fetchAuthSession(
                { session ->
                    navigateTo.value = if (session.isSignedIn) {
                        CareLogRoutes.PATIENT_DASHBOARD
                    } else {
                        CareLogRoutes.LOGIN
                    }
                },
                { error ->
                    Log.w("SplashScreen", "Auth check failed, navigating to login", error)
                    navigateTo.value = CareLogRoutes.LOGIN
                }
            )
        } catch (e: Exception) {
            Log.w("SplashScreen", "Amplify not configured, navigating to login", e)
            navigateTo.value = CareLogRoutes.LOGIN
        }
    }

    navigateTo.value?.let { destination ->
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

package com.carelog.ui

import android.util.Log
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.amplifyframework.core.Amplify
import kotlinx.coroutines.delay

/**
 * Navigation routes for CareLog app.
 */
object CareLogRoutes {
    const val SPLASH = "splash"
    const val LOGIN = "login"
    const val PATIENT_DASHBOARD = "patient_dashboard"
    const val RELATIVE_DASHBOARD = "relative_dashboard"
    const val ATTENDANT_DASHBOARD = "attendant_dashboard"

    // Vital logging routes
    const val BLOOD_PRESSURE = "vital/blood_pressure"
    const val GLUCOSE = "vital/glucose"
    const val TEMPERATURE = "vital/temperature"
    const val WEIGHT = "vital/weight"
    const val PULSE = "vital/pulse"
    const val SPO2 = "vital/spo2"

    // Media capture routes
    const val PRESCRIPTION_SCAN = "media/prescription"
    const val MEDICAL_PHOTO = "media/photo"
    const val VOICE_NOTE = "media/voice"
    const val VIDEO_NOTE = "media/video"

    // History and settings
    const val HISTORY = "history"
    const val SETTINGS = "settings"
    const val CARE_TEAM = "care_team"
    const val THRESHOLDS = "thresholds"
    const val REMINDERS = "reminders"
    const val ALERTS = "alerts"

    // LLM Chat placeholder
    const val CHAT = "chat"
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
        // Splash screen - check auth and navigate
        composable(CareLogRoutes.SPLASH) {
            SplashScreen(navController)
        }

        // Login screen - will be implemented in T-011
        composable(CareLogRoutes.LOGIN) {
            PlaceholderScreen("Login")
        }

        // Patient Dashboard - will be implemented in T-026
        composable(CareLogRoutes.PATIENT_DASHBOARD) {
            PlaceholderScreen("Patient Dashboard")
        }

        // Vital logging screens - will be implemented in T-028 to T-039
        composable(CareLogRoutes.BLOOD_PRESSURE) {
            PlaceholderScreen("Blood Pressure")
        }
        composable(CareLogRoutes.GLUCOSE) {
            PlaceholderScreen("Glucose")
        }
        composable(CareLogRoutes.TEMPERATURE) {
            PlaceholderScreen("Temperature")
        }
        composable(CareLogRoutes.WEIGHT) {
            PlaceholderScreen("Weight")
        }
        composable(CareLogRoutes.PULSE) {
            PlaceholderScreen("Pulse")
        }
        composable(CareLogRoutes.SPO2) {
            PlaceholderScreen("SpO2")
        }

        // History - will be implemented in T-043
        composable(CareLogRoutes.HISTORY) {
            PlaceholderScreen("History")
        }

        // Chat placeholder - will be implemented in T-045
        composable(CareLogRoutes.CHAT) {
            PlaceholderScreen("Chat - Coming Soon")
        }
    }
}

@Composable
private fun SplashScreen(navController: NavController) {
    val navigateTo = remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        delay(1500) // Brief splash display
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

@Composable
private fun PlaceholderScreen(title: String) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text = title)
    }
}

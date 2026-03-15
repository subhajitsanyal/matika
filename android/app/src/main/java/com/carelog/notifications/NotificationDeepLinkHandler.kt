package com.carelog.notifications

import android.content.Intent
import android.os.Bundle

/**
 * Handles deep linking from push notifications.
 */
object NotificationDeepLinkHandler {

    /**
     * Notification deep link data.
     */
    data class DeepLinkData(
        val type: String?,
        val patientId: String?,
        val vitalType: String?,
        val alertId: String?
    )

    /**
     * Extract deep link data from intent extras.
     */
    fun extractDeepLinkData(intent: Intent?): DeepLinkData? {
        val extras = intent?.extras ?: return null

        val type = extras.getString("type")
        if (type == null) return null

        return DeepLinkData(
            type = type,
            patientId = extras.getString("patientId"),
            vitalType = extras.getString("vitalType"),
            alertId = extras.getString("alertId")
        )
    }

    /**
     * Extract deep link data from bundle.
     */
    fun extractDeepLinkData(bundle: Bundle?): DeepLinkData? {
        if (bundle == null) return null

        val type = bundle.getString("type")
        if (type == null) return null

        return DeepLinkData(
            type = type,
            patientId = bundle.getString("patientId"),
            vitalType = bundle.getString("vitalType"),
            alertId = bundle.getString("alertId")
        )
    }

    /**
     * Determine the navigation destination based on deep link type.
     */
    fun getNavigationDestination(deepLinkData: DeepLinkData): NavigationDestination {
        return when (deepLinkData.type) {
            "THRESHOLD_BREACH" -> NavigationDestination.AlertInbox
            "REMINDER_LAPSE" -> NavigationDestination.AlertInbox
            "PATIENT_REMINDER" -> {
                // Navigate to the appropriate vital logging screen
                when (deepLinkData.vitalType) {
                    "BLOOD_PRESSURE" -> NavigationDestination.BloodPressureLog
                    "GLUCOSE" -> NavigationDestination.GlucoseLog
                    "TEMPERATURE" -> NavigationDestination.TemperatureLog
                    "WEIGHT" -> NavigationDestination.WeightLog
                    "PULSE" -> NavigationDestination.PulseLog
                    "SPO2" -> NavigationDestination.SpO2Log
                    else -> NavigationDestination.Dashboard
                }
            }
            else -> NavigationDestination.Dashboard
        }
    }

    /**
     * Navigation destinations for deep linking.
     */
    sealed class NavigationDestination {
        data object Dashboard : NavigationDestination()
        data object AlertInbox : NavigationDestination()
        data object BloodPressureLog : NavigationDestination()
        data object GlucoseLog : NavigationDestination()
        data object TemperatureLog : NavigationDestination()
        data object WeightLog : NavigationDestination()
        data object PulseLog : NavigationDestination()
        data object SpO2Log : NavigationDestination()
    }
}

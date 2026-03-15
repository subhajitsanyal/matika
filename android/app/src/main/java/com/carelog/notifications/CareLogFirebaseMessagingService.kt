package com.carelog.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.carelog.MainActivity
import com.carelog.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Firebase Cloud Messaging service for handling push notifications.
 */
@AndroidEntryPoint
class CareLogFirebaseMessagingService : FirebaseMessagingService() {

    @Inject
    lateinit var deviceTokenManager: DeviceTokenManager

    companion object {
        private const val TAG = "CareLogFCM"
        private const val CHANNEL_ID_ALERTS = "carelog_alerts"
        private const val CHANNEL_ID_REMINDERS = "carelog_reminders"
    }

    override fun onNewToken(token: String) {
        Log.d(TAG, "Refreshed FCM token")

        // Register the new token with the backend
        CoroutineScope(Dispatchers.IO).launch {
            try {
                deviceTokenManager.registerToken(token)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to register token", e)
            }
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        Log.d(TAG, "Message received from: ${remoteMessage.from}")

        // Check if message contains a data payload
        val data = remoteMessage.data
        if (data.isNotEmpty()) {
            Log.d(TAG, "Message data payload: $data")
            handleDataMessage(data)
        }

        // Check if message contains a notification payload (for display when app is in background)
        remoteMessage.notification?.let { notification ->
            val title = notification.title ?: "CareLog"
            val body = notification.body ?: ""
            showNotification(title, body, data)
        }
    }

    private fun handleDataMessage(data: Map<String, String>) {
        val type = data["type"]
        val patientId = data["patientId"]
        val vitalType = data["vitalType"]
        val value = data["value"]

        when (type) {
            "THRESHOLD_BREACH" -> {
                val title = "${getVitalDisplayName(vitalType)} Alert"
                val body = "Patient's ${getVitalDisplayName(vitalType)?.lowercase()} reading of $value is outside the normal range."
                showNotification(title, body, data, isAlert = true)
            }
            "REMINDER_LAPSE" -> {
                val title = "Missed Reading"
                val body = "Patient hasn't logged their ${getVitalDisplayName(vitalType)?.lowercase()} reading."
                showNotification(title, body, data, isAlert = false)
            }
            "PATIENT_REMINDER" -> {
                val title = "Reminder"
                val body = "Time to log your ${getVitalDisplayName(vitalType)?.lowercase()} reading."
                showNotification(title, body, data, isAlert = false)
            }
        }
    }

    private fun showNotification(
        title: String,
        body: String,
        data: Map<String, String>,
        isAlert: Boolean = false
    ) {
        // Create intent for when notification is tapped
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            // Add deep link data
            data.forEach { (key, value) ->
                putExtra(key, value)
            }
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            System.currentTimeMillis().toInt(),
            intent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )

        val channelId = if (isAlert) CHANNEL_ID_ALERTS else CHANNEL_ID_REMINDERS
        val defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

        val notificationBuilder = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setSound(defaultSoundUri)
            .setContentIntent(pendingIntent)
            .setPriority(
                if (isAlert) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT
            )

        // Add color for alert notifications
        if (isAlert) {
            notificationBuilder.setColor(getColor(R.color.error))
        }

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Create notification channels for Android O and above
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            createNotificationChannels(notificationManager)
        }

        notificationManager.notify(
            System.currentTimeMillis().toInt(),
            notificationBuilder.build()
        )
    }

    private fun createNotificationChannels(notificationManager: NotificationManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Alerts channel (high importance)
            val alertsChannel = NotificationChannel(
                CHANNEL_ID_ALERTS,
                "Health Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifications for vital readings outside normal range"
                enableVibration(true)
                enableLights(true)
            }

            // Reminders channel (default importance)
            val remindersChannel = NotificationChannel(
                CHANNEL_ID_REMINDERS,
                "Reminders",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Reminders to log vital readings"
            }

            notificationManager.createNotificationChannels(listOf(alertsChannel, remindersChannel))
        }
    }

    private fun getVitalDisplayName(vitalType: String?): String? {
        return when (vitalType) {
            "BLOOD_PRESSURE" -> "Blood Pressure"
            "GLUCOSE" -> "Glucose"
            "TEMPERATURE" -> "Temperature"
            "WEIGHT" -> "Weight"
            "PULSE" -> "Pulse"
            "SPO2" -> "SpO2"
            else -> vitalType
        }
    }
}

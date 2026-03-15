package com.carelog.notifications

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.ContextCompat

/**
 * Helper for managing notification permissions on Android 13+.
 */
object NotificationPermissionHelper {

    /**
     * Check if notification permission is granted.
     */
    fun hasNotificationPermission(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            // Permission not required on earlier versions
            true
        }
    }

    /**
     * Request notification permission if needed.
     */
    fun requestNotificationPermissionIfNeeded(
        context: Context,
        launcher: ActivityResultLauncher<String>,
        onAlreadyGranted: () -> Unit
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            when {
                hasNotificationPermission(context) -> {
                    onAlreadyGranted()
                }
                else -> {
                    launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        } else {
            onAlreadyGranted()
        }
    }
}

package com.carelog.notifications

import android.content.Context
import android.provider.Settings
import android.util.Log
import com.carelog.auth.AuthRepository
import com.carelog.auth.AuthState
import com.google.firebase.messaging.FirebaseMessaging
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import com.carelog.BuildConfig
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages device token registration with the backend.
 */
@Singleton
class DeviceTokenManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val authRepository: AuthRepository
) {
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val apiBaseUrl = BuildConfig.API_BASE_URL

    companion object {
        private const val TAG = "DeviceTokenManager"
        private const val PLATFORM = "android"
    }

    /**
     * Get the unique device ID.
     */
    private fun getDeviceId(): String {
        return Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
    }

    /**
     * Get the current FCM token.
     */
    suspend fun getFcmToken(): String? {
        return try {
            FirebaseMessaging.getInstance().token.await()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get FCM token", e)
            null
        }
    }

    /**
     * Register the device token with the backend.
     */
    suspend fun registerToken(token: String? = null): Boolean = withContext(Dispatchers.IO) {
        try {
            val accessToken = authRepository.getAccessToken() ?: run {
                Log.w(TAG, "No access token available, skipping token registration")
                return@withContext false
            }

            val fcmToken = token ?: getFcmToken() ?: run {
                Log.e(TAG, "Failed to get FCM token")
                return@withContext false
            }

            val deviceId = getDeviceId()

            val body = JSONObject().apply {
                put("deviceToken", fcmToken)
                put("platform", PLATFORM)
                put("deviceId", deviceId)
            }.toString()

            val request = Request.Builder()
                .url("$apiBaseUrl/device-tokens")
                .header("Authorization", "Bearer $accessToken")
                .header("Content-Type", "application/json")
                .post(body.toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()

            if (response.isSuccessful) {
                Log.d(TAG, "Device token registered successfully")
                true
            } else {
                Log.e(TAG, "Failed to register device token: ${response.code}")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error registering device token", e)
            false
        }
    }

    /**
     * Unregister the device token from the backend.
     */
    suspend fun unregisterToken(): Boolean = withContext(Dispatchers.IO) {
        try {
            val accessToken = authRepository.getAccessToken() ?: return@withContext false
            val deviceId = getDeviceId()

            val request = Request.Builder()
                .url("$apiBaseUrl/device-tokens?deviceId=$deviceId")
                .header("Authorization", "Bearer $accessToken")
                .delete()
                .build()

            val response = httpClient.newCall(request).execute()

            if (response.isSuccessful) {
                Log.d(TAG, "Device token unregistered successfully")
                true
            } else {
                Log.e(TAG, "Failed to unregister device token: ${response.code}")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error unregistering device token", e)
            false
        }
    }

    /**
     * Request notification permissions and register token.
     * Should be called after user logs in.
     */
    suspend fun initializeNotifications() {
        // On Android 13+, notification permission is handled separately via runtime permission
        // For earlier versions, we just need to register the token
        registerToken()
    }

    // Application-scoped coroutine for the auth observer. Survives the
    // entire process lifetime, so transitions to Authenticated land
    // regardless of which Activity is foregrounded. SupervisorJob means
    // a one-off failure (e.g. transient backend 500) doesn't kill the
    // observer; the next Authenticated emission re-fires the call.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * Wire the FCM-token-registration call to fire on every login.
     *
     * F17 (docs/testing_todos_v2.md): the FirebaseMessagingService's
     * `onNewToken` only fires once per FCM enrollment (often before
     * login → no access token → no-op). Without this observer, a fresh
     * sign-in never registers a device-tokens row and no push lands.
     *
     * Distinct-until-changed on the *user identity* (not just the
     * Authenticated wrapper) so persona-update re-emissions of
     * Authenticated don't re-fire the network call repeatedly. Backend
     * upserts on (user_id, device_token) so duplicates are harmless,
     * but no point spamming.
     *
     * Called from CareLogApplication.onCreate.
     */
    fun start() {
        scope.launch {
            authRepository.authState
                .map { state -> (state as? AuthState.Authenticated)?.user?.userId }
                .distinctUntilChanged()
                .collect { userId ->
                    if (userId != null) {
                        initializeNotifications()
                    }
                }
        }
    }
}

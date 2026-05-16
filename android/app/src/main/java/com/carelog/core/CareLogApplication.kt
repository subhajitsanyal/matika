package com.carelog.core

import android.app.Application
import android.util.Log
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.amplifyframework.AmplifyException
import com.amplifyframework.auth.cognito.AWSCognitoAuthPlugin
import com.amplifyframework.core.Amplify
// import com.amplifyframework.storage.s3.AWSS3StoragePlugin
import com.carelog.BuildConfig
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.carelog.notifications.DeviceTokenManager
import com.carelog.sync.SyncManager
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

/**
 * CareLog Application class.
 *
 * Initializes:
 * - Hilt dependency injection
 * - WorkManager for background sync
 * - AWS Amplify for authentication and storage
 */
@HiltAndroidApp
class CareLogApplication : Application(), Configuration.Provider {

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    @Inject
    lateinit var syncManager: SyncManager

    @Inject
    lateinit var deviceTokenManager: DeviceTokenManager

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .setMinimumLoggingLevel(if (BuildConfig.DEBUG) Log.DEBUG else Log.INFO)
            .build()

    override fun onCreate() {
        super.onCreate()
        instance = this
        initializeCrashlytics()
        initializeAmplify()
        syncManager.initialize()
        // F17 — observe auth state and register FCM token on every sign-in.
        // FirebaseMessagingService.onNewToken alone is insufficient because
        // it fires once per FCM enrollment (often pre-login), so the auth
        // header is missing and the call no-ops.
        deviceTokenManager.start()
    }

    /**
     * Stream D #4 — Firebase Crashlytics. Release-only; debug builds opt
     * out so dev iteration never floods the console with stack traces from
     * `am force-stop` / device reboots / etc.
     *
     * PII discipline: do NOT call FirebaseCrashlytics.setUserId() with
     * cognito_sub, FirebaseCrashlytics.setCustomKey() with patientId/email,
     * or FirebaseCrashlytics.log() with conversation transcript / vital
     * values. Default-config Crashlytics ships only stack traces + device
     * metadata; PHI only leaks if a future caller adds setCustomKey/log
     * with patient data. Audit any Crashlytics.* call before merging.
     */
    private fun initializeCrashlytics() {
        FirebaseCrashlytics.getInstance().setCrashlyticsCollectionEnabled(
            !BuildConfig.DEBUG,
        )
    }

    private fun initializeAmplify() {
        try {
            // Add Cognito Auth plugin
            Amplify.addPlugin(AWSCognitoAuthPlugin())

            // Configure Amplify with the configuration files
            Amplify.configure(applicationContext)

            Log.i(TAG, "Amplify initialized successfully")
        } catch (e: AmplifyException) {
            Log.e(TAG, "Failed to initialize Amplify", e)
        }
    }

    companion object {
        private const val TAG = "CareLogApp"

        @Volatile
        private var instance: CareLogApplication? = null

        fun getInstance(): CareLogApplication {
            return instance ?: throw IllegalStateException(
                "CareLogApplication not initialized"
            )
        }
    }
}

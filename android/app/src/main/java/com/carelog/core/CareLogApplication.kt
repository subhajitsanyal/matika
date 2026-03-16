package com.carelog.core

import android.app.Application
import android.util.Log
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.amplifyframework.AmplifyException
import com.amplifyframework.auth.cognito.AWSCognitoAuthPlugin
import com.amplifyframework.core.Amplify
import com.amplifyframework.storage.s3.AWSS3StoragePlugin
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

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .setMinimumLoggingLevel(if (BuildConfig.DEBUG) Log.DEBUG else Log.INFO)
            .build()

    override fun onCreate() {
        super.onCreate()
        instance = this
        initializeAmplify()
    }

    private fun initializeAmplify() {
        try {
            // Add Cognito Auth plugin
            Amplify.addPlugin(AWSCognitoAuthPlugin())

            // Add S3 Storage plugin for document uploads
            try {
                Amplify.addPlugin(AWSS3StoragePlugin())
            } catch (e: Exception) {
                Log.w(TAG, "S3 Storage plugin not available, skipping", e)
            }

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

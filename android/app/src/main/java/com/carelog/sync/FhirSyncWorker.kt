package com.carelog.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.carelog.fhir.client.HealthLakeFhirClient
import com.carelog.fhir.local.entities.SyncStatus
import com.carelog.fhir.repository.LocalFhirRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * WorkManager Worker for FHIR sync operations.
 *
 * Processes sync queue when WiFi is available.
 * Implements retry with exponential backoff for failures.
 */
@HiltWorker
class FhirSyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val localFhirRepository: LocalFhirRepository,
    private val healthLakeClient: HealthLakeFhirClient,
    private val networkMonitor: NetworkMonitor
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            // Check network connectivity
            if (!networkMonitor.isConnected()) {
                return@withContext Result.retry()
            }

            // Process pending observations
            val pendingObservations = localFhirRepository.getPendingObservations()
            var allSucceeded = true

            for (observation in pendingObservations) {
                try {
                    // Convert to FHIR JSON and send to HealthLake
                    val fhirJson = observation.toFhirJson()

                    if (observation.serverId == null) {
                        // New observation - POST
                        val serverId = healthLakeClient.createObservation(fhirJson)
                        localFhirRepository.markObservationSynced(observation.id, serverId)
                    } else {
                        // Updated observation - PUT
                        healthLakeClient.updateObservation(observation.serverId, fhirJson)
                        localFhirRepository.markObservationSynced(observation.id, observation.serverId)
                    }
                } catch (e: Exception) {
                    // Mark as failed and continue with others
                    localFhirRepository.markObservationFailed(observation.id, e.message)
                    allSucceeded = false
                }
            }

            // Process pending documents
            val pendingDocuments = localFhirRepository.getPendingDocuments()

            for (document in pendingDocuments) {
                try {
                    val fhirJson = document.toFhirJson()

                    if (document.serverId == null) {
                        val serverId = healthLakeClient.createDocumentReference(fhirJson)
                        localFhirRepository.markDocumentSynced(document.id, serverId)
                    } else {
                        healthLakeClient.updateDocumentReference(document.serverId, fhirJson)
                        localFhirRepository.markDocumentSynced(document.id, document.serverId)
                    }
                } catch (e: Exception) {
                    localFhirRepository.markDocumentFailed(document.id, e.message)
                    allSucceeded = false
                }
            }

            if (allSucceeded) {
                Result.success()
            } else {
                // Some items failed - retry with backoff
                Result.retry()
            }
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "fhir_sync"

        /**
         * Enqueue a one-time sync request.
         */
        fun enqueueOneTimeSync(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val request = OneTimeWorkRequestBuilder<FhirSyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(
                    WORK_NAME,
                    ExistingWorkPolicy.KEEP,
                    request
                )
        }

        /**
         * Enqueue a WiFi-only sync request.
         */
        fun enqueueWifiSync(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.UNMETERED)
                .build()

            val request = OneTimeWorkRequestBuilder<FhirSyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(
                    "${WORK_NAME}_wifi",
                    ExistingWorkPolicy.KEEP,
                    request
                )
        }

        /**
         * Schedule periodic sync (every 15 minutes when on WiFi).
         */
        fun schedulePeriodicSync(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.UNMETERED)
                .build()

            val request = PeriodicWorkRequestBuilder<FhirSyncWorker>(
                15, TimeUnit.MINUTES,
                5, TimeUnit.MINUTES  // Flex interval
            )
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .build()

            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    "${WORK_NAME}_periodic",
                    ExistingPeriodicWorkPolicy.KEEP,
                    request
                )
        }

        /**
         * Cancel all sync work.
         */
        fun cancelAllSync(context: Context) {
            WorkManager.getInstance(context).cancelAllWorkByTag(WORK_NAME)
        }
    }
}

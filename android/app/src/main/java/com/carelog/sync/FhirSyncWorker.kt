package com.carelog.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.carelog.fhir.client.FhirClient
import com.carelog.fhir.client.ObservationType
import com.carelog.fhir.local.entities.LocalObservation
import com.carelog.fhir.local.entities.LocalDocumentReference
import com.carelog.fhir.models.FhirDocumentReference
import com.carelog.fhir.models.FhirObservation
import com.carelog.fhir.models.MeasurementContext
import com.carelog.fhir.models.ObservationComponent
import com.carelog.fhir.repository.LocalFhirRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
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
    private val fhirClient: FhirClient,
    private val networkMonitor: NetworkMonitor
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            // Check network connectivity
            if (!networkMonitor.isConnected()) {
                return@withContext Result.retry()
            }

            // Process pending observations
            val pendingObservations = localFhirRepository.getPendingSyncObservations()
            var allSucceeded = true

            for (observation in pendingObservations) {
                try {
                    // Convert LocalObservation to FhirObservation
                    val fhirObservation = observation.toFhirObservation()

                    // Create on server (always create for now - no update method in client)
                    val serverId = fhirClient.createObservation(fhirObservation)
                    localFhirRepository.markObservationSynced(observation.localId, serverId)
                } catch (e: Exception) {
                    // Mark as failed and continue with others
                    localFhirRepository.markObservationSyncFailed(observation.localId, e.message ?: "Unknown error")
                    allSucceeded = false
                }
            }

            // Process pending documents
            val pendingDocuments = localFhirRepository.getPendingFhirSync()

            for (document in pendingDocuments) {
                try {
                    // Convert LocalDocumentReference to FhirDocumentReference
                    val fhirDocument = document.toFhirDocumentReference()

                    // Create on server
                    val serverId = fhirClient.createDocumentReference(fhirDocument)
                    localFhirRepository.markDocumentFhirSynced(document.localId, serverId)
                } catch (e: Exception) {
                    localFhirRepository.markDocumentFhirSyncFailed(document.localId, e.message ?: "Unknown error")
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

    /**
     * Convert LocalObservation to FhirObservation.
     */
    private fun LocalObservation.toFhirObservation(): FhirObservation {
        val components = if (type == ObservationType.BLOOD_PRESSURE) {
            listOfNotNull(
                systolicValue?.let { ObservationComponent(ObservationType.SYSTOLIC_BP, it, "mmHg") },
                diastolicValue?.let { ObservationComponent(ObservationType.DIASTOLIC_BP, it, "mmHg") }
            ).takeIf { it.isNotEmpty() }
        } else null

        return FhirObservation(
            id = serverId,
            patientId = patientId,
            type = type,
            effectiveDateTime = Instant.ofEpochSecond(effectiveDateTime)
                .atZone(ZoneOffset.UTC)
                .format(DateTimeFormatter.ISO_INSTANT),
            value = value,
            unit = unit,
            components = components,
            interpretation = interpretation,
            performerId = performerId,
            performerType = performerType,
            note = note,
            context = MeasurementContext(fasting = isFasting, postMeal = isPostMeal),
            status = status
        )
    }

    /**
     * Convert LocalDocumentReference to FhirDocumentReference.
     */
    private fun LocalDocumentReference.toFhirDocumentReference(): FhirDocumentReference {
        return FhirDocumentReference(
            id = serverId,
            patientId = patientId,
            documentId = documentId,
            type = type,
            title = title,
            description = description,
            contentUrl = contentUrl ?: localFilePath,
            contentType = contentType,
            size = size,
            date = Instant.ofEpochMilli(date).toString(),
            authorId = authorId,
            authorName = authorName,
            authorType = authorType,
            status = status
        )
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
                    ExistingWorkPolicy.REPLACE,
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

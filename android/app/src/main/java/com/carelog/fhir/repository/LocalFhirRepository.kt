package com.carelog.fhir.repository

import com.carelog.fhir.client.DocumentType
import com.carelog.fhir.client.ObservationType
import com.carelog.fhir.local.dao.DocumentReferenceDao
import com.carelog.fhir.local.dao.ObservationDao
import com.carelog.fhir.local.entities.LocalDocumentReference
import com.carelog.fhir.local.entities.LocalObservation
import com.carelog.fhir.local.entities.SyncStatus
import com.carelog.fhir.models.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for local FHIR resource storage.
 *
 * Provides offline-first CRUD operations with sync status tracking.
 * All data is stored locally first, then synced to the server
 * when connectivity is available.
 */
@Singleton
class LocalFhirRepository @Inject constructor(
    private val observationDao: ObservationDao,
    private val documentReferenceDao: DocumentReferenceDao
) {

    // ==================== Observation Operations ====================

    /**
     * Save an observation locally.
     * Returns the local ID for tracking.
     */
    suspend fun saveObservation(observation: FhirObservation): String {
        val localId = UUID.randomUUID().toString()
        val localObservation = observation.toLocalEntity(localId)
        observationDao.insert(localObservation)
        return localId
    }

    /**
     * Get an observation by local ID.
     */
    suspend fun getObservation(localId: String): FhirObservation? {
        return observationDao.getById(localId)?.toFhirObservation()
    }

    /**
     * Get all observations for a patient as a Flow.
     */
    fun getObservationsForPatient(patientId: String): Flow<List<FhirObservation>> {
        return observationDao.getByPatientId(patientId).map { list ->
            list.map { it.toFhirObservation() }
        }
    }

    /**
     * Get observations by type for a patient.
     */
    fun getObservationsByType(
        patientId: String,
        type: ObservationType
    ): Flow<List<FhirObservation>> {
        return observationDao.getByPatientIdAndType(patientId, type).map { list ->
            list.map { it.toFhirObservation() }
        }
    }

    /**
     * Get the latest observation of a type for a patient.
     */
    suspend fun getLatestObservation(
        patientId: String,
        type: ObservationType
    ): FhirObservation? {
        return observationDao.getLatestByType(patientId, type)?.toFhirObservation()
    }

    /**
     * Get observations pending sync.
     */
    suspend fun getPendingSyncObservations(limit: Int = 50): List<LocalObservation> {
        return observationDao.getPendingSync(SyncStatus.PENDING, limit)
    }

    /**
     * Mark an observation as synced.
     */
    suspend fun markObservationSynced(localId: String, serverId: String) {
        observationDao.markSynced(localId, serverId)
    }

    /**
     * Mark an observation sync as failed.
     */
    suspend fun markObservationSyncFailed(localId: String, error: String) {
        observationDao.markSyncFailed(localId, error)
    }

    /**
     * Get count of observations pending sync.
     */
    fun getPendingObservationCount(): Flow<Int> {
        return observationDao.countPendingSync()
    }

    /**
     * Delete an observation.
     */
    suspend fun deleteObservation(localId: String) {
        observationDao.deleteById(localId)
    }

    /**
     * Get all observations pending sync as a Flow.
     */
    fun getPendingObservations(): Flow<List<LocalObservation>> {
        return observationDao.getPendingSyncFlow(SyncStatus.PENDING)
    }

    /**
     * Get all observations for a patient.
     */
    fun getAllObservations(patientId: String): Flow<List<LocalObservation>> {
        return observationDao.getByPatientId(patientId)
    }

    /**
     * Get count of failed observation syncs.
     */
    fun getFailedObservationCount(): Flow<Int> {
        return observationDao.countByStatus(SyncStatus.FAILED)
    }

    /**
     * Update an observation's sync status.
     */
    suspend fun updateObservation(observation: LocalObservation) {
        observationDao.update(observation)
    }

    /**
     * Mark observation as failed with error.
     */
    suspend fun markObservationFailed(localId: String, error: String) {
        observationDao.markSyncFailed(localId, error)
    }

    // ==================== DocumentReference Operations ====================

    /**
     * Save a document reference locally.
     * Returns the local ID for tracking.
     */
    suspend fun saveDocumentReference(document: FhirDocumentReference, localFilePath: String): String {
        val localId = UUID.randomUUID().toString()
        val localDocument = document.toLocalEntity(localId, localFilePath)
        documentReferenceDao.insert(localDocument)
        return localId
    }

    /**
     * Get a document reference by local ID.
     */
    suspend fun getDocumentReference(localId: String): FhirDocumentReference? {
        return documentReferenceDao.getById(localId)?.toFhirDocumentReference()
    }

    /**
     * Get all documents for a patient as a Flow.
     */
    fun getDocumentsForPatient(patientId: String): Flow<List<FhirDocumentReference>> {
        return documentReferenceDao.getByPatientId(patientId).map { list ->
            list.map { it.toFhirDocumentReference() }
        }
    }

    /**
     * Get documents by type for a patient.
     */
    fun getDocumentsByType(
        patientId: String,
        type: DocumentType
    ): Flow<List<FhirDocumentReference>> {
        return documentReferenceDao.getByPatientIdAndType(patientId, type).map { list ->
            list.map { it.toFhirDocumentReference() }
        }
    }

    /**
     * Get documents pending file upload.
     */
    suspend fun getPendingFileUploads(limit: Int = 10): List<LocalDocumentReference> {
        return documentReferenceDao.getPendingFileUploads(SyncStatus.PENDING, limit)
    }

    /**
     * Mark a document's file as uploaded.
     */
    suspend fun markFileUploaded(localId: String, contentUrl: String) {
        documentReferenceDao.markFileUploaded(localId, contentUrl)
    }

    /**
     * Mark a document's file upload as failed.
     */
    suspend fun markFileUploadFailed(localId: String, error: String) {
        documentReferenceDao.markFileUploadFailed(localId, error)
    }

    /**
     * Get documents pending FHIR sync (after file upload).
     */
    suspend fun getPendingFhirSync(limit: Int = 50): List<LocalDocumentReference> {
        return documentReferenceDao.getPendingFhirSync(SyncStatus.PENDING, limit)
    }

    /**
     * Mark a document as FHIR synced.
     */
    suspend fun markDocumentFhirSynced(localId: String, serverId: String) {
        documentReferenceDao.markFhirSynced(localId, serverId)
    }

    /**
     * Mark a document's FHIR sync as failed.
     */
    suspend fun markDocumentFhirSyncFailed(localId: String, error: String) {
        documentReferenceDao.markFhirSyncFailed(localId, error)
    }

    /**
     * Get count of pending uploads + syncs.
     */
    fun getPendingDocumentCount(): Flow<Int> {
        return documentReferenceDao.countPendingFileUploads()
    }

    /**
     * Delete a document reference.
     */
    suspend fun deleteDocumentReference(localId: String) {
        documentReferenceDao.deleteById(localId)
    }

    /**
     * Get all documents pending sync as a Flow.
     */
    fun getPendingDocuments(): Flow<List<LocalDocumentReference>> {
        return documentReferenceDao.getPendingFhirSyncFlow(SyncStatus.PENDING)
    }

    /**
     * Get count of failed document syncs.
     */
    fun getFailedDocumentCount(): Flow<Int> {
        return documentReferenceDao.countByStatus(SyncStatus.FAILED)
    }

    /**
     * Update a document reference.
     */
    suspend fun updateDocumentReference(document: LocalDocumentReference) {
        documentReferenceDao.update(document)
    }

    /**
     * Mark document as synced.
     */
    suspend fun markDocumentSynced(localId: String, serverId: String) {
        documentReferenceDao.markFhirSynced(localId, serverId)
    }

    /**
     * Mark document sync as failed.
     */
    suspend fun markDocumentFailed(localId: String, error: String) {
        documentReferenceDao.markFhirSyncFailed(localId, error)
    }

    /**
     * Get last sync time (most recent synced observation).
     */
    fun getLastSyncTime(): Flow<Long?> {
        return observationDao.getLastSyncTime()
    }

    // ==================== Conversion Extensions ====================

    private fun FhirObservation.toLocalEntity(localId: String): LocalObservation {
        return LocalObservation(
            localId = localId,
            serverId = id,
            patientId = patientId,
            type = type,
            effectiveDateTime = java.time.Instant.parse(effectiveDateTime).epochSecond,
            value = value,
            unit = unit,
            systolicValue = components?.find { it.type == ObservationType.SYSTOLIC_BP }?.value,
            diastolicValue = components?.find { it.type == ObservationType.DIASTOLIC_BP }?.value,
            interpretation = interpretation,
            performerId = performerId,
            performerType = performerType,
            note = note,
            isFasting = context?.fasting ?: false,
            isPostMeal = context?.postMeal ?: false,
            status = status,
            syncStatus = if (id != null) SyncStatus.SYNCED else SyncStatus.PENDING
        )
    }

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
            effectiveDateTime = java.time.Instant.ofEpochSecond(effectiveDateTime)
                .atZone(java.time.ZoneOffset.UTC)
                .format(java.time.format.DateTimeFormatter.ISO_INSTANT),
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

    private fun FhirDocumentReference.toLocalEntity(
        localId: String,
        localFilePath: String
    ): LocalDocumentReference {
        return LocalDocumentReference(
            localId = localId,
            serverId = id,
            patientId = patientId,
            documentId = documentId,
            type = type,
            title = title,
            description = description,
            localFilePath = localFilePath,
            contentUrl = contentUrl,
            contentType = contentType,
            size = size,
            date = java.time.Instant.parse(date).toEpochMilli(),
            authorId = authorId,
            authorName = authorName,
            authorType = authorType,
            status = status,
            fileUploadStatus = if (contentUrl != null) SyncStatus.SYNCED else SyncStatus.PENDING,
            fhirSyncStatus = if (id != null) SyncStatus.SYNCED else SyncStatus.PENDING
        )
    }

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
            date = java.time.Instant.ofEpochMilli(date).toString(),
            authorId = authorId,
            authorName = authorName,
            authorType = authorType,
            status = status
        )
    }
}

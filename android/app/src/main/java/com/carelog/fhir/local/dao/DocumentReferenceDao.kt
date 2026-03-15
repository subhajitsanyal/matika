package com.carelog.fhir.local.dao

import androidx.room.*
import com.carelog.fhir.client.DocumentType
import com.carelog.fhir.local.entities.LocalDocumentReference
import com.carelog.fhir.local.entities.SyncStatus
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for DocumentReference entities.
 */
@Dao
interface DocumentReferenceDao {

    // ==================== Insert/Update ====================

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(document: LocalDocumentReference)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(documents: List<LocalDocumentReference>)

    @Update
    suspend fun update(document: LocalDocumentReference)

    // ==================== Query by ID ====================

    @Query("SELECT * FROM document_references WHERE localId = :localId")
    suspend fun getById(localId: String): LocalDocumentReference?

    @Query("SELECT * FROM document_references WHERE server_id = :serverId")
    suspend fun getByServerId(serverId: String): LocalDocumentReference?

    @Query("SELECT * FROM document_references WHERE document_id = :documentId")
    suspend fun getByDocumentId(documentId: String): LocalDocumentReference?

    // ==================== Query by Patient ====================

    @Query("""
        SELECT * FROM document_references
        WHERE patient_id = :patientId
        ORDER BY date DESC
    """)
    fun getByPatientId(patientId: String): Flow<List<LocalDocumentReference>>

    @Query("""
        SELECT * FROM document_references
        WHERE patient_id = :patientId AND type = :type
        ORDER BY date DESC
    """)
    fun getByPatientIdAndType(patientId: String, type: DocumentType): Flow<List<LocalDocumentReference>>

    // ==================== File Upload Queue ====================

    @Query("""
        SELECT * FROM document_references
        WHERE file_upload_status = :status
        ORDER BY created_at ASC
        LIMIT :limit
    """)
    suspend fun getPendingFileUploads(
        status: SyncStatus = SyncStatus.PENDING,
        limit: Int = 10
    ): List<LocalDocumentReference>

    @Query("""
        UPDATE document_references
        SET file_upload_status = :status,
            content_url = :contentUrl,
            sync_error = NULL,
            updated_at = :updatedAt
        WHERE localId = :localId
    """)
    suspend fun markFileUploaded(
        localId: String,
        contentUrl: String,
        status: SyncStatus = SyncStatus.SYNCED,
        updatedAt: Long = System.currentTimeMillis()
    )

    @Query("""
        UPDATE document_references
        SET file_upload_status = :status,
            sync_error = :error,
            sync_attempts = sync_attempts + 1,
            updated_at = :timestamp
        WHERE localId = :localId
    """)
    suspend fun markFileUploadFailed(
        localId: String,
        error: String,
        status: SyncStatus = SyncStatus.FAILED,
        timestamp: Long = System.currentTimeMillis()
    )

    // ==================== FHIR Sync Queue ====================

    @Query("""
        SELECT * FROM document_references
        WHERE file_upload_status = 'SYNCED'
        AND fhir_sync_status = :status
        ORDER BY created_at ASC
        LIMIT :limit
    """)
    suspend fun getPendingFhirSync(
        status: SyncStatus = SyncStatus.PENDING,
        limit: Int = 50
    ): List<LocalDocumentReference>

    @Query("""
        UPDATE document_references
        SET fhir_sync_status = :status,
            server_id = :serverId,
            sync_error = NULL,
            updated_at = :updatedAt
        WHERE localId = :localId
    """)
    suspend fun markFhirSynced(
        localId: String,
        serverId: String,
        status: SyncStatus = SyncStatus.SYNCED,
        updatedAt: Long = System.currentTimeMillis()
    )

    @Query("""
        UPDATE document_references
        SET fhir_sync_status = :status,
            sync_error = :error,
            sync_attempts = sync_attempts + 1,
            updated_at = :timestamp
        WHERE localId = :localId
    """)
    suspend fun markFhirSyncFailed(
        localId: String,
        error: String,
        status: SyncStatus = SyncStatus.FAILED,
        timestamp: Long = System.currentTimeMillis()
    )

    @Query("SELECT COUNT(*) FROM document_references WHERE file_upload_status != :status")
    fun countPendingFileUploads(status: SyncStatus = SyncStatus.SYNCED): Flow<Int>

    @Query("SELECT COUNT(*) FROM document_references WHERE fhir_sync_status != :status")
    fun countPendingFhirSync(status: SyncStatus = SyncStatus.SYNCED): Flow<Int>

    // ==================== Delete ====================

    @Delete
    suspend fun delete(document: LocalDocumentReference)

    @Query("DELETE FROM document_references WHERE localId = :localId")
    suspend fun deleteById(localId: String)

    @Query("DELETE FROM document_references WHERE patient_id = :patientId")
    suspend fun deleteByPatientId(patientId: String)
}

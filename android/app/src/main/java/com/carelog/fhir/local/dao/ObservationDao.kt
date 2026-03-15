package com.carelog.fhir.local.dao

import androidx.room.*
import com.carelog.fhir.client.ObservationType
import com.carelog.fhir.local.entities.LocalObservation
import com.carelog.fhir.local.entities.SyncStatus
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for Observation entities.
 */
@Dao
interface ObservationDao {

    // ==================== Insert/Update ====================

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(observation: LocalObservation)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(observations: List<LocalObservation>)

    @Update
    suspend fun update(observation: LocalObservation)

    // ==================== Query by ID ====================

    @Query("SELECT * FROM observations WHERE localId = :localId")
    suspend fun getById(localId: String): LocalObservation?

    @Query("SELECT * FROM observations WHERE server_id = :serverId")
    suspend fun getByServerId(serverId: String): LocalObservation?

    // ==================== Query by Patient ====================

    @Query("""
        SELECT * FROM observations
        WHERE patient_id = :patientId
        ORDER BY effective_date_time DESC
    """)
    fun getByPatientId(patientId: String): Flow<List<LocalObservation>>

    @Query("""
        SELECT * FROM observations
        WHERE patient_id = :patientId AND type = :type
        ORDER BY effective_date_time DESC
    """)
    fun getByPatientIdAndType(patientId: String, type: ObservationType): Flow<List<LocalObservation>>

    @Query("""
        SELECT * FROM observations
        WHERE patient_id = :patientId
        AND effective_date_time >= :startTime
        AND effective_date_time <= :endTime
        ORDER BY effective_date_time DESC
    """)
    fun getByPatientIdAndDateRange(
        patientId: String,
        startTime: Long,
        endTime: Long
    ): Flow<List<LocalObservation>>

    @Query("""
        SELECT * FROM observations
        WHERE patient_id = :patientId AND type = :type
        ORDER BY effective_date_time DESC
        LIMIT 1
    """)
    suspend fun getLatestByType(patientId: String, type: ObservationType): LocalObservation?

    // ==================== Sync Queue ====================

    @Query("""
        SELECT * FROM observations
        WHERE sync_status = :syncStatus
        ORDER BY created_at ASC
        LIMIT :limit
    """)
    suspend fun getPendingSync(
        syncStatus: SyncStatus = SyncStatus.PENDING,
        limit: Int = 50
    ): List<LocalObservation>

    @Query("""
        SELECT * FROM observations
        WHERE sync_status IN (:statuses)
        AND sync_attempts < :maxAttempts
        ORDER BY created_at ASC
    """)
    suspend fun getRetryableSync(
        statuses: List<SyncStatus> = listOf(SyncStatus.PENDING, SyncStatus.FAILED),
        maxAttempts: Int = 5
    ): List<LocalObservation>

    @Query("""
        UPDATE observations
        SET sync_status = :status,
            server_id = :serverId,
            sync_error = NULL,
            updated_at = :updatedAt
        WHERE localId = :localId
    """)
    suspend fun markSynced(
        localId: String,
        serverId: String,
        status: SyncStatus = SyncStatus.SYNCED,
        updatedAt: Long = System.currentTimeMillis()
    )

    @Query("""
        UPDATE observations
        SET sync_status = :status,
            sync_error = :error,
            sync_attempts = sync_attempts + 1,
            last_sync_attempt = :timestamp,
            updated_at = :timestamp
        WHERE localId = :localId
    """)
    suspend fun markSyncFailed(
        localId: String,
        error: String,
        status: SyncStatus = SyncStatus.FAILED,
        timestamp: Long = System.currentTimeMillis()
    )

    @Query("SELECT COUNT(*) FROM observations WHERE sync_status = :status")
    fun countByStatus(status: SyncStatus): Flow<Int>

    @Query("SELECT COUNT(*) FROM observations WHERE sync_status != :status")
    fun countPendingSync(status: SyncStatus = SyncStatus.SYNCED): Flow<Int>

    // ==================== Delete ====================

    @Delete
    suspend fun delete(observation: LocalObservation)

    @Query("DELETE FROM observations WHERE localId = :localId")
    suspend fun deleteById(localId: String)

    @Query("DELETE FROM observations WHERE patient_id = :patientId")
    suspend fun deleteByPatientId(patientId: String)

    @Query("DELETE FROM observations WHERE sync_status = :status")
    suspend fun deleteByStatus(status: SyncStatus)
}

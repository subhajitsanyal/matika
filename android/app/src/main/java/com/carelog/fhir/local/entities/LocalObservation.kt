package com.carelog.fhir.local.entities

import androidx.room.*
import com.carelog.fhir.client.InterpretationCode
import com.carelog.fhir.client.ObservationType
import com.carelog.fhir.models.MeasurementContext
import com.carelog.fhir.models.ObservationStatus
import com.carelog.fhir.models.PerformerType

/**
 * Room entity for locally stored FHIR Observation.
 */
@Entity(
    tableName = "observations",
    indices = [
        Index(value = ["patient_id"]),
        Index(value = ["sync_status"]),
        Index(value = ["effective_date_time"])
    ]
)
data class LocalObservation(
    @PrimaryKey
    val localId: String,  // UUID generated locally

    @ColumnInfo(name = "server_id")
    val serverId: String? = null,  // FHIR resource ID from server

    @ColumnInfo(name = "patient_id")
    val patientId: String,

    @ColumnInfo(name = "type")
    val type: ObservationType,

    @ColumnInfo(name = "effective_date_time")
    val effectiveDateTime: Long,  // Unix timestamp

    @ColumnInfo(name = "value")
    val value: Double? = null,

    @ColumnInfo(name = "unit")
    val unit: String? = null,

    @ColumnInfo(name = "systolic_value")
    val systolicValue: Double? = null,  // For blood pressure

    @ColumnInfo(name = "diastolic_value")
    val diastolicValue: Double? = null,  // For blood pressure

    @ColumnInfo(name = "interpretation")
    val interpretation: InterpretationCode? = null,

    @ColumnInfo(name = "performer_id")
    val performerId: String? = null,

    @ColumnInfo(name = "performer_type")
    val performerType: PerformerType = PerformerType.RELATED_PERSON,

    @ColumnInfo(name = "note")
    val note: String? = null,

    @ColumnInfo(name = "is_fasting")
    val isFasting: Boolean = false,

    @ColumnInfo(name = "is_post_meal")
    val isPostMeal: Boolean = false,

    @ColumnInfo(name = "status")
    val status: ObservationStatus = ObservationStatus.FINAL,

    @ColumnInfo(name = "sync_status")
    val syncStatus: SyncStatus = SyncStatus.PENDING,

    @ColumnInfo(name = "sync_error")
    val syncError: String? = null,

    @ColumnInfo(name = "sync_attempts")
    val syncAttempts: Int = 0,

    @ColumnInfo(name = "last_sync_attempt")
    val lastSyncAttempt: Long? = null,

    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),

    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis()
)

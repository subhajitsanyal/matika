package com.carelog.fhir.local.database

import android.content.Context
import androidx.room.*
import com.carelog.fhir.client.DocumentType
import com.carelog.fhir.client.InterpretationCode
import com.carelog.fhir.client.ObservationType
import com.carelog.fhir.local.dao.DocumentReferenceDao
import com.carelog.fhir.local.dao.ObservationDao
import com.carelog.fhir.local.entities.LocalDocumentReference
import com.carelog.fhir.local.entities.LocalObservation
import com.carelog.fhir.local.entities.SyncStatus
import com.carelog.fhir.models.DocumentStatus
import com.carelog.fhir.models.ObservationStatus
import com.carelog.fhir.models.PerformerType

/**
 * Room database for local FHIR resource storage.
 *
 * Provides offline-first persistence for FHIR resources
 * with sync status tracking.
 */
@Database(
    entities = [
        LocalObservation::class,
        LocalDocumentReference::class
    ],
    version = 1,
    exportSchema = true
)
@TypeConverters(FhirTypeConverters::class)
abstract class FhirDatabase : RoomDatabase() {

    abstract fun observationDao(): ObservationDao
    abstract fun documentReferenceDao(): DocumentReferenceDao

    companion object {
        private const val DATABASE_NAME = "carelog_fhir.db"

        @Volatile
        private var INSTANCE: FhirDatabase? = null

        fun getInstance(context: Context): FhirDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: buildDatabase(context).also { INSTANCE = it }
            }
        }

        private fun buildDatabase(context: Context): FhirDatabase {
            return Room.databaseBuilder(
                context.applicationContext,
                FhirDatabase::class.java,
                DATABASE_NAME
            )
                .fallbackToDestructiveMigration()
                .build()
        }
    }
}

/**
 * Type converters for Room database.
 */
class FhirTypeConverters {

    // SyncStatus
    @TypeConverter
    fun fromSyncStatus(status: SyncStatus): String = status.name

    @TypeConverter
    fun toSyncStatus(value: String): SyncStatus = SyncStatus.valueOf(value)

    // ObservationType
    @TypeConverter
    fun fromObservationType(type: ObservationType): String = type.name

    @TypeConverter
    fun toObservationType(value: String): ObservationType = ObservationType.valueOf(value)

    // ObservationStatus
    @TypeConverter
    fun fromObservationStatus(status: ObservationStatus): String = status.name

    @TypeConverter
    fun toObservationStatus(value: String): ObservationStatus = ObservationStatus.valueOf(value)

    // PerformerType
    @TypeConverter
    fun fromPerformerType(type: PerformerType): String = type.name

    @TypeConverter
    fun toPerformerType(value: String): PerformerType = PerformerType.valueOf(value)

    // InterpretationCode
    @TypeConverter
    fun fromInterpretationCode(code: InterpretationCode?): String? = code?.name

    @TypeConverter
    fun toInterpretationCode(value: String?): InterpretationCode? =
        value?.let { InterpretationCode.valueOf(it) }

    // DocumentType
    @TypeConverter
    fun fromDocumentType(type: DocumentType): String = type.name

    @TypeConverter
    fun toDocumentType(value: String): DocumentType = DocumentType.valueOf(value)

    // DocumentStatus
    @TypeConverter
    fun fromDocumentStatus(status: DocumentStatus): String = status.name

    @TypeConverter
    fun toDocumentStatus(value: String): DocumentStatus = DocumentStatus.valueOf(value)
}

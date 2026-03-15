package com.carelog.fhir.local.entities

import androidx.room.*
import com.carelog.fhir.client.DocumentType
import com.carelog.fhir.models.DocumentStatus
import com.carelog.fhir.models.PerformerType

/**
 * Room entity for locally stored FHIR DocumentReference.
 */
@Entity(
    tableName = "document_references",
    indices = [
        Index(value = ["patient_id"]),
        Index(value = ["sync_status"]),
        Index(value = ["date"])
    ]
)
data class LocalDocumentReference(
    @PrimaryKey
    val localId: String,  // UUID generated locally

    @ColumnInfo(name = "server_id")
    val serverId: String? = null,  // FHIR resource ID from server

    @ColumnInfo(name = "patient_id")
    val patientId: String,

    @ColumnInfo(name = "document_id")
    val documentId: String,  // UUID for S3 reference

    @ColumnInfo(name = "type")
    val type: DocumentType,

    @ColumnInfo(name = "title")
    val title: String,

    @ColumnInfo(name = "description")
    val description: String? = null,

    @ColumnInfo(name = "local_file_path")
    val localFilePath: String,  // Local file path before upload

    @ColumnInfo(name = "content_url")
    val contentUrl: String? = null,  // S3 URL after upload

    @ColumnInfo(name = "content_type")
    val contentType: String,  // MIME type

    @ColumnInfo(name = "size")
    val size: Long? = null,

    @ColumnInfo(name = "date")
    val date: Long,  // Unix timestamp

    @ColumnInfo(name = "author_id")
    val authorId: String? = null,

    @ColumnInfo(name = "author_name")
    val authorName: String? = null,

    @ColumnInfo(name = "author_type")
    val authorType: PerformerType = PerformerType.RELATED_PERSON,

    @ColumnInfo(name = "status")
    val status: DocumentStatus = DocumentStatus.CURRENT,

    @ColumnInfo(name = "file_upload_status")
    val fileUploadStatus: SyncStatus = SyncStatus.PENDING,  // S3 upload status

    @ColumnInfo(name = "fhir_sync_status")
    val fhirSyncStatus: SyncStatus = SyncStatus.PENDING,  // FHIR resource sync status

    @ColumnInfo(name = "sync_error")
    val syncError: String? = null,

    @ColumnInfo(name = "sync_attempts")
    val syncAttempts: Int = 0,

    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),

    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis()
)

package com.carelog.upload

import android.content.Context
import android.net.Uri
import com.carelog.auth.AuthRepository
import com.carelog.fhir.local.entities.SyncStatus
import com.carelog.fhir.models.FhirDocumentReference
import com.carelog.fhir.repository.LocalFhirRepository
import com.carelog.voice.VoiceAcknowledgementPlayer
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.InputStream
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Service for uploading unstructured data (photos, documents, audio, video).
 *
 * Flow:
 * 1. Request presigned URL from API
 * 2. Upload file directly to S3
 * 3. Create FHIR DocumentReference locally
 * 4. Add to sync queue
 * 5. Play voice acknowledgement
 */
@Singleton
class UploadService @Inject constructor(
    @ApplicationContext private val context: Context,
    private val authRepository: AuthRepository,
    private val localFhirRepository: LocalFhirRepository,
    private val voicePlayer: VoiceAcknowledgementPlayer
) {
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val apiBaseUrl = "https://api.carelog.app" // TODO: Get from config

    /**
     * Upload a file to S3 and create DocumentReference.
     */
    suspend fun uploadFile(
        uri: Uri,
        fileType: FileType,
        contentType: String,
        description: String? = null,
        onProgress: ((Float) -> Unit)? = null
    ): UploadResult = withContext(Dispatchers.IO) {
        try {
            val user = authRepository.getCurrentUser()
                ?: return@withContext UploadResult.Error("Not authenticated")

            val patientId = user.linkedPatientId
                ?: return@withContext UploadResult.Error("No patient ID")

            // 1. Get presigned URL
            val presignedResponse = getPresignedUrl(patientId, fileType, contentType)
            if (presignedResponse == null) {
                return@withContext UploadResult.Error("Failed to get upload URL")
            }

            // 2. Upload to S3
            val uploadSuccess = uploadToS3(
                presignedResponse.uploadUrl,
                uri,
                contentType,
                onProgress
            )

            if (!uploadSuccess) {
                voicePlayer.playFailure()
                return@withContext UploadResult.Error("Failed to upload file")
            }

            // 3. Create local DocumentReference
            val documentRef = FhirDocumentReference(
                id = UUID.randomUUID().toString(),
                patientId = patientId,
                type = fileType.fhirCode,
                contentType = contentType,
                s3Key = presignedResponse.s3Key,
                description = description ?: fileType.displayName,
                createdAt = Instant.now().toString(),
                authorName = user.name,
                syncStatus = SyncStatus.PENDING
            )

            // 4. Save to local store (adds to sync queue)
            localFhirRepository.saveDocumentReference(documentRef)

            // 5. Play success acknowledgement
            voicePlayer.playUploadSuccess()

            UploadResult.Success(
                documentId = documentRef.id,
                s3Key = presignedResponse.s3Key
            )
        } catch (e: Exception) {
            voicePlayer.playFailure()
            UploadResult.Error(e.message ?: "Upload failed")
        }
    }

    /**
     * Request presigned URL from API.
     */
    private suspend fun getPresignedUrl(
        patientId: String,
        fileType: FileType,
        contentType: String
    ): PresignedUrlResponse? = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext null

            val requestBody = JSONObject().apply {
                put("patientId", patientId)
                put("fileType", fileType.apiValue)
                put("contentType", contentType)
            }.toString()

            val request = Request.Builder()
                .url("$apiBaseUrl/upload/presigned-url")
                .header("Authorization", "Bearer $token")
                .header("Content-Type", "application/json")
                .post(requestBody.toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()

            if (!response.isSuccessful) {
                return@withContext null
            }

            val responseBody = response.body?.string() ?: return@withContext null
            val json = JSONObject(responseBody)

            PresignedUrlResponse(
                uploadUrl = json.getString("uploadUrl"),
                s3Key = json.getString("s3Key"),
                expiresIn = json.getInt("expiresIn")
            )
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Upload file to S3 using presigned URL.
     */
    private suspend fun uploadToS3(
        presignedUrl: String,
        uri: Uri,
        contentType: String,
        onProgress: ((Float) -> Unit)?
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val inputStream: InputStream = context.contentResolver.openInputStream(uri)
                ?: return@withContext false

            val bytes = inputStream.readBytes()
            inputStream.close()

            val request = Request.Builder()
                .url(presignedUrl)
                .put(bytes.toRequestBody(contentType.toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }
}

/**
 * File types supported for upload.
 */
enum class FileType(
    val apiValue: String,
    val fhirCode: String,
    val displayName: String
) {
    PRESCRIPTION("prescription", "prescription", "Prescription"),
    WOUND_PHOTO("wound_photo", "wound-photo", "Wound Photo"),
    URINE_PHOTO("urine_photo", "urine-photo", "Urine Photo"),
    STOOL_PHOTO("stool_photo", "stool-photo", "Stool Photo"),
    VOMIT_PHOTO("vomit_photo", "vomit-photo", "Vomit Photo"),
    MEDICAL_PHOTO("medical_photo", "medical-photo", "Medical Photo"),
    VOICE_NOTE("voice_note", "voice-note", "Voice Note"),
    VIDEO_NOTE("video_note", "video-note", "Video Note"),
    DOCUMENT("document", "document", "Document")
}

/**
 * Presigned URL response.
 */
data class PresignedUrlResponse(
    val uploadUrl: String,
    val s3Key: String,
    val expiresIn: Int
)

/**
 * Upload result.
 */
sealed class UploadResult {
    data class Success(
        val documentId: String,
        val s3Key: String
    ) : UploadResult()

    data class Error(val message: String) : UploadResult()
}

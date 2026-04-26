package com.carelog.network

import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part

/**
 * Retrofit interface for the Mac Mini Vision service on port 8004.
 *
 * Extracts readings from photos of medical devices (BP monitors, glucometers, etc.).
 */
interface MacMiniVisionApi {

    /**
     * Extract readings from a device photo.
     *
     * @param image JPEG or PNG image file.
     * @param deviceHint Optional hint about the device type (e.g., "glucometer").
     * @return Extracted readings with confidence scores and bounding boxes.
     */
    @Multipart
    @POST("extract")
    suspend fun extractReadings(
        @Part image: MultipartBody.Part,
        @Part("device_hint") deviceHint: RequestBody?
    ): VisionExtractResponse
}

// ── Response Models ──────────────────────────────────────────

data class VisionExtractResponse(
    val device_type: String,
    val confidence: Double,
    val readings: List<VisionReading>,
    val raw_text_detected: String?
)

data class VisionReading(
    val label: String,
    val value: Double,
    val unit: String,
    val bounding_box: VisionBoundingBox?
)

data class VisionBoundingBox(
    val x: Int,
    val y: Int,
    val w: Int,
    val h: Int
)

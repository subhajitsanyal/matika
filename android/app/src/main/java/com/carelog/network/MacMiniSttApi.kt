package com.carelog.network

import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

/**
 * Retrofit interface for the Mac Mini STT (Speech-to-Text) service on port 8001.
 *
 * Batch mode: POST raw PCM audio bytes to /transcribe.
 * Streaming mode: WebSocket at /transcribe/stream (handled separately via OkHttp WebSocket).
 */
interface MacMiniSttApi {

    /**
     * Transcribe audio in batch mode.
     *
     * @param sampleRate PCM sample rate (e.g., "16000")
     * @param language Language code: "en", "hi", or "bn"
     * @param audioBody Raw PCM audio bytes with Content-Type: audio/pcm
     * @return Transcription result with text, language, duration, and segments
     */
    @POST("transcribe")
    suspend fun transcribe(
        @Header("X-Sample-Rate") sampleRate: String,
        @Header("X-Language") language: String,
        @Body audioBody: RequestBody
    ): SttTranscribeResponse
}

// ── Response Models ──────────────────────────────────────────

data class SttTranscribeResponse(
    val text: String,
    val language: String,
    val duration_ms: Long,
    val segments: List<SttSegment>?
)

data class SttSegment(
    val start_ms: Long,
    val end_ms: Long,
    val text: String,
    val confidence: Double
)

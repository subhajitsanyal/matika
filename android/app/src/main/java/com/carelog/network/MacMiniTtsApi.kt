package com.carelog.network

import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * Retrofit interface for the Mac Mini TTS (Text-to-Speech) service on port 8003.
 *
 * Batch mode: POST text to /synthesize, receive raw PCM audio bytes.
 * Streaming mode: WebSocket at /synthesize/stream (handled separately via OkHttp WebSocket).
 */
interface MacMiniTtsApi {

    /**
     * Synthesize text to speech in batch mode.
     *
     * @param request Text, language, format, and sample rate.
     * @return Raw PCM audio bytes. Check response headers for X-Sample-Rate and X-Duration-Ms.
     */
    @POST("synthesize")
    suspend fun synthesize(
        @Body request: TtsSynthesizeRequest
    ): ResponseBody
}

// ── Request Models ───────────────────────────────────────────

data class TtsSynthesizeRequest(
    val text: String,
    val language: String,
    val format: String = "pcm",
    val sample_rate: Int = 16000
)

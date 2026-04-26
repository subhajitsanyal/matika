package com.carelog.conversation

import android.util.Log
import com.carelog.conversation.audio.AudioCaptureManager
import com.carelog.conversation.audio.AudioPlayerManager
import com.carelog.conversation.audio.AudioStreamManager
import com.carelog.conversation.audio.SttStreamEvent
import com.carelog.conversation.instrumentation.LatencyTracker
import com.carelog.conversation.instrumentation.PipelineTimingBuilder
import com.carelog.conversation.session.ConversationTurn
import com.carelog.conversation.session.ExtractedValue
import com.carelog.core.config.AppSettings
import com.carelog.core.config.AudioMode
import com.carelog.network.CloudApiService
import com.carelog.network.LlmCreateSessionRequest
import com.carelog.network.LlmCreateSessionResponse
import com.carelog.network.LlmEndSessionResponse
import com.carelog.network.LlmParameter
import com.carelog.network.LlmSessionConfig
import com.carelog.network.LlmTopic
import com.carelog.network.LlmUtteranceRequest
import com.carelog.network.MacMiniLlmApi
import com.carelog.network.MacMiniSttApi
import com.carelog.network.MacMiniTtsApi
import com.carelog.network.SessionConfigResponse
import com.carelog.network.TtsSynthesizeRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Coordinates the STT -> LLM -> TTS conversation pipeline.
 *
 * In batch mode, audio is fully recorded then sent to STT, the transcript
 * goes to the LLM, and the response is synthesized then played back.
 *
 * In streaming mode, audio chunks flow through WebSockets for STT and TTS
 * with lower latency.
 */
@Singleton
class ConversationRepository @Inject constructor(
    private val sttApi: MacMiniSttApi,
    private val llmApi: MacMiniLlmApi,
    private val ttsApi: MacMiniTtsApi,
    private val cloudApiService: CloudApiService,
    private val audioCaptureManager: AudioCaptureManager,
    private val audioPlayerManager: AudioPlayerManager,
    private val audioStreamManager: AudioStreamManager,
    private val appSettings: AppSettings,
    private val latencyTracker: LatencyTracker
) {

    companion object {
        private const val TAG = "ConversationRepository"
        private const val PCM_MEDIA_TYPE = "audio/pcm"
    }

    /**
     * Create a new LLM session using the cloud-provided configuration.
     */
    suspend fun createSession(config: SessionConfigResponse): LlmCreateSessionResponse {
        val request = LlmCreateSessionRequest(
            session_type = "daily_checkin",
            patient_id = config.patient_id,
            language = config.language,
            config = LlmSessionConfig(
                parameters = config.parameters.map { p ->
                    LlmParameter(
                        name = p.name,
                        loinc_codes = p.loinc_codes,
                        unit = p.unit,
                        frequency_days = p.frequency_days,
                        threshold_min = p.threshold_min,
                        threshold_max = p.threshold_max
                    )
                },
                topics = config.topics?.map { t ->
                    LlmTopic(
                        id = t.id,
                        name = t.name,
                        description = t.description,
                        status = t.status,
                        last_collected = t.last_collected
                    )
                },
                system_prompt = config.system_prompt,
                patient_name = config.patient_name,
                last_session_summary = config.last_session_summary
            )
        )

        return llmApi.createSession(request)
    }

    /**
     * Process audio through the batch STT -> LLM -> TTS pipeline.
     *
     * @param audioData Raw PCM audio bytes.
     * @param language Language code for STT/TTS.
     * @param sessionId Active LLM session ID.
     * @param turnNumber Current turn number.
     * @return A [ConversationTurn] with transcript, response, and extracted values.
     */
    suspend fun processAudio(
        audioData: ByteArray,
        language: String,
        sessionId: String,
        turnNumber: Int
    ): ConversationTurn {
        val timer = PipelineTimingBuilder(turnNumber)

        // t0: VAD silence detected (utterance end — caller already recorded audio)
        timer.markUtteranceEnd()

        // 1. Send audio to STT
        timer.markSttRequestSent()
        val audioBody = audioData.toRequestBody(PCM_MEDIA_TYPE.toMediaType())
        val sttResponse = sttApi.transcribe(
            sampleRate = "16000",
            language = language,
            audioBody = audioBody
        )
        timer.markSttResponseReceived()
        Log.d(TAG, "STT result: ${sttResponse.text.take(50)}...")

        // 2. Send transcript to LLM
        timer.markLlmRequestSent()
        val llmResponse = llmApi.sendUtterance(
            sessionId = sessionId,
            request = LlmUtteranceRequest(
                text = sttResponse.text,
                turn_number = turnNumber
            )
        )
        timer.markLlmResponseReceived()
        Log.d(TAG, "LLM action: ${llmResponse.action}")

        // 3. Synthesize response via TTS and play
        timer.markTtsRequestSent()
        playTtsInstrumented(llmResponse.response_text, language, timer)

        // 4. Record pipeline timing
        timer.build()?.let { timing ->
            latencyTracker.recordTiming(timing)
        }

        // 5. Build and return combined result
        return ConversationTurn(
            turnNumber = turnNumber,
            patientText = sttResponse.text,
            systemText = llmResponse.response_text,
            extractedValues = llmResponse.extracted_values.map { v ->
                ExtractedValue(
                    parameter = v.parameter,
                    loincCode = v.loinc_code,
                    value = v.value,
                    unit = v.unit,
                    status = v.status
                )
            },
            action = llmResponse.action
        )
    }

    /**
     * Process text input (skips STT) -> LLM -> TTS pipeline.
     */
    suspend fun processText(
        text: String,
        language: String,
        sessionId: String,
        turnNumber: Int
    ): ConversationTurn {
        // Skip STT, go directly to LLM
        val llmResponse = llmApi.sendUtterance(
            sessionId = sessionId,
            request = LlmUtteranceRequest(
                text = text,
                turn_number = turnNumber
            )
        )

        // Synthesize and play response
        playTts(llmResponse.response_text, language)

        return ConversationTurn(
            turnNumber = turnNumber,
            patientText = text,
            systemText = llmResponse.response_text,
            extractedValues = llmResponse.extracted_values.map { v ->
                ExtractedValue(
                    parameter = v.parameter,
                    loincCode = v.loinc_code,
                    value = v.value,
                    unit = v.unit,
                    status = v.status
                )
            },
            action = llmResponse.action
        )
    }

    /**
     * Synthesize text to speech and play the audio.
     */
    suspend fun playTts(text: String, language: String) {
        try {
            val audioMode = appSettings.audioMode.first()

            if (audioMode == AudioMode.STREAMING) {
                playTtsStreaming(text, language)
            } else {
                playTtsBatch(text, language)
            }
        } catch (e: Exception) {
            Log.e(TAG, "TTS playback failed", e)
            // Non-fatal: conversation continues without audio
        }
    }

    /**
     * Play greeting audio for session start.
     */
    suspend fun playGreeting(greetingText: String, language: String) {
        playTts(greetingText, language)
    }

    /**
     * Store raw interaction data to cloud (audio, transcript, photos).
     * This is a best-effort operation; failure does not block FHIR upload.
     */
    suspend fun storeRawInteraction(sessionId: String, endResponse: LlmEndSessionResponse) {
        // Build metadata JSON
        val metadata = """
            {
                "session_id": "$sessionId",
                "turn_count": ${endResponse.summary.turn_count},
                "duration_ms": ${endResponse.summary.duration_ms},
                "language": "${endResponse.summary.language}",
                "status": "${endResponse.summary.status}"
            }
        """.trimIndent()

        val metadataBody = metadata.toRequestBody("application/json".toMediaType())

        // Build transcript part if available
        val transcriptPart = endResponse.full_transcript?.let { entries ->
            val transcriptJson = entries.joinToString(",\n") { entry ->
                """{"turn":${entry.turn},"role":"${entry.role}","text":"${entry.text.replace("\"", "\\\"")}"}"""
            }
            val body = "[$transcriptJson]".toRequestBody("application/json".toMediaType())
            okhttp3.MultipartBody.Part.createFormData("transcript", "transcript.json", body)
        }

        cloudApiService.storeInteraction(
            metadata = metadataBody,
            audio = null, // Audio files handled separately if needed
            transcript = transcriptPart,
            photos = null
        )
    }

    /**
     * Reset latency tracking for a new session.
     */
    fun resetLatencyTracking() {
        latencyTracker.reset()
    }

    /**
     * Release audio resources when session ends.
     */
    fun release() {
        audioCaptureManager.release()
        audioPlayerManager.release()
        audioStreamManager.disconnectAll()
    }

    // ── Private Helpers ─────────────────────────────────────────

    /**
     * Synthesize text to speech with pipeline timing instrumentation.
     * Marks t6 (first byte) and t7 (playback start) on the timing builder.
     */
    private suspend fun playTtsInstrumented(
        text: String,
        language: String,
        timer: PipelineTimingBuilder
    ) {
        try {
            val audioMode = appSettings.audioMode.first()
            if (audioMode == AudioMode.STREAMING) {
                // For streaming, first byte comes earlier
                timer.markTtsFirstByte()
                playTtsStreaming(text, language)
                timer.markAudioPlaybackStart()
            } else {
                val responseBody = ttsApi.synthesize(
                    TtsSynthesizeRequest(
                        text = text,
                        language = language,
                        format = "pcm",
                        sample_rate = 16000
                    )
                )
                timer.markTtsFirstByte()
                val audioBytes = responseBody.bytes()
                if (audioBytes.isNotEmpty()) {
                    timer.markAudioPlaybackStart()
                    audioPlayerManager.playBuffer(audioBytes)
                } else {
                    timer.markAudioPlaybackStart()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Instrumented TTS playback failed", e)
            // Mark remaining timestamps to avoid null build
            if (timer.t6 == 0L) timer.markTtsFirstByte()
            if (timer.t7 == 0L) timer.markAudioPlaybackStart()
        }
    }

    private suspend fun playTtsBatch(text: String, language: String) {
        val responseBody = ttsApi.synthesize(
            TtsSynthesizeRequest(
                text = text,
                language = language,
                format = "pcm",
                sample_rate = 16000
            )
        )
        val audioBytes = responseBody.bytes()
        if (audioBytes.isNotEmpty()) {
            audioPlayerManager.playBuffer(audioBytes)
        }
    }

    private suspend fun playTtsStreaming(text: String, language: String) {
        val macMiniUrl = appSettings.macMiniBaseUrl.first() ?: return
        // Replace port for TTS service (8003)
        val ttsUrl = macMiniUrl.replace(Regex(":\\d+$"), ":8003")
        audioStreamManager.connectTts(ttsUrl, language)
        audioPlayerManager.startStreamingPlayback()

        // Collect audio chunks and play them
        val collectJob = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
            audioStreamManager.ttsAudioChunks.collect { chunk ->
                audioPlayerManager.writeStreamingChunk(chunk)
            }
        }

        audioStreamManager.sendTextForSynthesis(text)

        // Wait for TTS completion
        audioStreamManager.ttsComplete.first()
        collectJob.cancel()
        audioPlayerManager.stopStreamingPlayback()
        audioStreamManager.disconnectTts()
    }
}

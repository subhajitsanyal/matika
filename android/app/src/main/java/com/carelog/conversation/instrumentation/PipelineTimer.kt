package com.carelog.conversation.instrumentation

/**
 * Timestamps captured at each stage of the STT -> LLM -> TTS pipeline
 * for a single conversation turn.
 *
 * All timestamps are in milliseconds from [System.currentTimeMillis].
 *
 * t0: VAD silence detected (utterance end)
 * t1: STT request sent
 * t2: STT response received
 * t3: LLM request sent
 * t4: LLM response received
 * t5: TTS request sent
 * t6: TTS first audio byte received
 * t7: Audio playback begins
 */
data class PipelineTiming(
    val turnNumber: Int,
    val t0_utterance_end: Long,
    val t1_stt_request_sent: Long,
    val t2_stt_response_received: Long,
    val t3_llm_request_sent: Long,
    val t4_llm_response_received: Long,
    val t5_tts_request_sent: Long,
    val t6_tts_first_byte: Long,
    val t7_audio_playback_start: Long
) {
    /** STT component latency in milliseconds. */
    val sttLatency: Long get() = t2_stt_response_received - t1_stt_request_sent

    /** LLM component latency in milliseconds. */
    val llmLatency: Long get() = t4_llm_response_received - t3_llm_request_sent

    /** TTS component latency in milliseconds. */
    val ttsLatency: Long get() = t6_tts_first_byte - t5_tts_request_sent

    /** Total end-to-end latency from utterance end to audio playback start. */
    val totalLatency: Long get() = t7_audio_playback_start - t0_utterance_end
}

/**
 * Mutable builder for [PipelineTiming] that captures timestamps
 * incrementally as each pipeline stage completes.
 */
class PipelineTimingBuilder(private val turnNumber: Int) {
    var t0: Long = 0L; private set
    var t1: Long = 0L; private set
    var t2: Long = 0L; private set
    var t3: Long = 0L; private set
    var t4: Long = 0L; private set
    var t5: Long = 0L; private set
    var t6: Long = 0L; private set
    var t7: Long = 0L; private set

    fun markUtteranceEnd() { t0 = now() }
    fun markSttRequestSent() { t1 = now() }
    fun markSttResponseReceived() { t2 = now() }
    fun markLlmRequestSent() { t3 = now() }
    fun markLlmResponseReceived() { t4 = now() }
    fun markTtsRequestSent() { t5 = now() }
    fun markTtsFirstByte() { t6 = now() }
    fun markAudioPlaybackStart() { t7 = now() }

    /**
     * Build the immutable [PipelineTiming] snapshot.
     * Returns null if critical timestamps are missing (t0 or t7 == 0).
     */
    fun build(): PipelineTiming? {
        if (t0 == 0L || t7 == 0L) return null
        return PipelineTiming(
            turnNumber = turnNumber,
            t0_utterance_end = t0,
            t1_stt_request_sent = t1,
            t2_stt_response_received = t2,
            t3_llm_request_sent = t3,
            t4_llm_response_received = t4,
            t5_tts_request_sent = t5,
            t6_tts_first_byte = t6,
            t7_audio_playback_start = t7
        )
    }

    private fun now(): Long = System.currentTimeMillis()
}

package com.carelog.conversation.instrumentation

import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Percentile-based latency statistics for the conversation pipeline.
 */
data class LatencyStats(
    val sttP50: Long = 0L,
    val sttP95: Long = 0L,
    val sttP99: Long = 0L,
    val llmP50: Long = 0L,
    val llmP95: Long = 0L,
    val llmP99: Long = 0L,
    val ttsP50: Long = 0L,
    val ttsP95: Long = 0L,
    val ttsP99: Long = 0L,
    val totalP50: Long = 0L,
    val totalP95: Long = 0L,
    val totalP99: Long = 0L,
    val turnCount: Int = 0
)

/**
 * Collects [PipelineTiming] for each conversation turn within a session
 * and computes running P50/P95/P99 latency statistics.
 *
 * Logs a warning when total latency exceeds the 2000ms target (spec Section 12.5).
 */
@Singleton
class LatencyTracker @Inject constructor() {

    companion object {
        private const val TAG = "CareLog"
        private const val LATENCY_WARN_THRESHOLD_MS = 2000L
    }

    private val _timings = MutableStateFlow<List<PipelineTiming>>(emptyList())
    /** All pipeline timings for the current session. */
    val timings: StateFlow<List<PipelineTiming>> = _timings.asStateFlow()

    private val _stats = MutableStateFlow(LatencyStats())
    /** Running percentile statistics for the current session. */
    val stats: StateFlow<LatencyStats> = _stats.asStateFlow()

    /**
     * Record a completed pipeline timing and recompute statistics.
     */
    fun recordTiming(timing: PipelineTiming) {
        _timings.update { current -> current + timing }

        // Log warning if total latency exceeds target
        if (timing.totalLatency > LATENCY_WARN_THRESHOLD_MS) {
            Log.w(
                TAG,
                "Pipeline latency exceeded target: " +
                    "total=${timing.totalLatency}ms " +
                    "(STT=${timing.sttLatency}ms, " +
                    "LLM=${timing.llmLatency}ms, " +
                    "TTS=${timing.ttsLatency}ms) " +
                    "turn=${timing.turnNumber}"
            )
        } else {
            Log.d(
                TAG,
                "Pipeline timing: " +
                    "total=${timing.totalLatency}ms " +
                    "(STT=${timing.sttLatency}ms, " +
                    "LLM=${timing.llmLatency}ms, " +
                    "TTS=${timing.ttsLatency}ms) " +
                    "turn=${timing.turnNumber}"
            )
        }

        recomputeStats()
    }

    /**
     * Reset all timings and statistics for a new session.
     */
    fun reset() {
        _timings.value = emptyList()
        _stats.value = LatencyStats()
    }

    private fun recomputeStats() {
        val allTimings = _timings.value
        if (allTimings.isEmpty()) return

        val sttLatencies = allTimings.map { it.sttLatency }.sorted()
        val llmLatencies = allTimings.map { it.llmLatency }.sorted()
        val ttsLatencies = allTimings.map { it.ttsLatency }.sorted()
        val totalLatencies = allTimings.map { it.totalLatency }.sorted()

        _stats.value = LatencyStats(
            sttP50 = percentile(sttLatencies, 50),
            sttP95 = percentile(sttLatencies, 95),
            sttP99 = percentile(sttLatencies, 99),
            llmP50 = percentile(llmLatencies, 50),
            llmP95 = percentile(llmLatencies, 95),
            llmP99 = percentile(llmLatencies, 99),
            ttsP50 = percentile(ttsLatencies, 50),
            ttsP95 = percentile(ttsLatencies, 95),
            ttsP99 = percentile(ttsLatencies, 99),
            totalP50 = percentile(totalLatencies, 50),
            totalP95 = percentile(totalLatencies, 95),
            totalP99 = percentile(totalLatencies, 99),
            turnCount = allTimings.size
        )
    }

    /**
     * Compute the Pth percentile from a sorted list using nearest-rank.
     */
    private fun percentile(sorted: List<Long>, p: Int): Long {
        if (sorted.isEmpty()) return 0L
        val index = ((p / 100.0) * sorted.size).toInt().coerceIn(0, sorted.size - 1)
        return sorted[index]
    }
}

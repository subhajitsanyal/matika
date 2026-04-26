package com.carelog.conversation.session

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Handles the 5-minute auto-stop timeout when a session is paused.
 *
 * When a session is paused, starts a countdown. If not resumed within
 * [PAUSE_TIMEOUT_MS], invokes [onTimeout] to auto-end the session.
 */
class PauseTimeoutHandler(
    private val scope: CoroutineScope,
    private val onTimeout: suspend () -> Unit
) {

    companion object {
        private const val TAG = "PauseTimeoutHandler"
        /** 5 minutes in milliseconds. */
        const val PAUSE_TIMEOUT_MS = 5 * 60 * 1000L
    }

    private var timeoutJob: Job? = null

    /**
     * Start the pause timeout countdown.
     * Cancels any existing countdown first.
     */
    fun startTimeout() {
        cancelTimeout()
        Log.i(TAG, "Pause timeout started: ${PAUSE_TIMEOUT_MS / 1000}s")

        timeoutJob = scope.launch {
            delay(PAUSE_TIMEOUT_MS)
            Log.i(TAG, "Pause timeout expired, auto-ending session")
            onTimeout()
        }
    }

    /**
     * Cancel the pause timeout. Called when the session is resumed.
     */
    fun cancelTimeout() {
        timeoutJob?.cancel()
        timeoutJob = null
    }

    /**
     * Whether a timeout countdown is currently active.
     */
    val isActive: Boolean
        get() = timeoutJob?.isActive == true
}

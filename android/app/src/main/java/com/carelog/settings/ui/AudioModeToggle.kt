package com.carelog.settings.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.carelog.core.config.AppSettings
import com.carelog.core.config.AudioMode
import kotlinx.coroutines.launch

/**
 * Toggle between Batch and Streaming audio modes.
 *
 * - **Batch**: Records full utterance, waits for silence, then sends
 *   to STT as one request. Simpler and more reliable.
 * - **Streaming**: Sends audio chunks in real-time via WebSocket.
 *   Lower latency but requires stable network connection.
 *
 * Selection is persisted to DataStore via [AppSettings].
 */
@Composable
fun AudioModeToggle(
    appSettings: AppSettings,
    modifier: Modifier = Modifier
) {
    val audioMode by appSettings.audioMode.collectAsState(initial = AudioMode.BATCH)
    val scope = rememberCoroutineScope()

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Text(
                text = "Audio Mode",
                style = MaterialTheme.typography.titleMedium
            )

            Spacer(modifier = Modifier.height(8.dp))

            SingleChoiceSegmentedButtonRow(
                modifier = Modifier.fillMaxWidth()
            ) {
                SegmentedButton(
                    selected = audioMode == AudioMode.BATCH,
                    onClick = {
                        scope.launch {
                            appSettings.setAudioMode(AudioMode.BATCH)
                            appSettings.setStreamingEnabled(false)
                        }
                    },
                    shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2)
                ) {
                    Text("Batch")
                }

                SegmentedButton(
                    selected = audioMode == AudioMode.STREAMING,
                    onClick = {
                        scope.launch {
                            appSettings.setAudioMode(AudioMode.STREAMING)
                            appSettings.setStreamingEnabled(true)
                        }
                    },
                    shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2)
                ) {
                    Text("Streaming")
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = if (audioMode == AudioMode.BATCH) {
                    "Records your full response before processing. More reliable on slower networks."
                } else {
                    "Processes speech in real-time for faster responses. Requires stable network."
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

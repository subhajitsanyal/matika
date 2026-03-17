package com.carelog.ui.upload

import android.media.AudioManager
import android.media.ToneGenerator
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * Full-screen success acknowledgement overlay for media operations.
 * Shows a checkmark with message, plays a confirmation tone,
 * then auto-dismisses after a delay.
 */
@Composable
fun MediaAcknowledgement(
    visible: Boolean,
    message: String,
    onDismiss: () -> Unit
) {
    if (visible) {
        LaunchedEffect(Unit) {
            try {
                val toneGenerator = ToneGenerator(AudioManager.STREAM_MUSIC, 100)
                toneGenerator.startTone(ToneGenerator.TONE_PROP_ACK, 200)
                delay(300)
                toneGenerator.startTone(ToneGenerator.TONE_PROP_ACK, 150)
                delay(1800)
                toneGenerator.release()
            } catch (_: Exception) {}
            onDismiss()
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.95f)),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(96.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF4CAF50)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = "Success",
                        tint = Color.White,
                        modifier = Modifier.size(56.dp)
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = message,
                    style = MaterialTheme.typography.headlineSmall,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
        }
    }
}

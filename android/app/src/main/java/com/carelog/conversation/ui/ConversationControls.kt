package com.carelog.conversation.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.carelog.conversation.session.SessionPhase

/**
 * Conversation control buttons matching the session phase.
 *
 * - NOT_STARTED: Large green Start (mic) button (72dp)
 * - ACTIVE: Mic (record), Pause, Stop buttons
 * - PAUSED: Resume, Stop buttons
 * - STARTING/ENDING: Processing spinner with step labels
 *
 * All buttons meet minimum 48dp touch targets (72dp for primary).
 * Haptic feedback is provided on button press.
 */
@Composable
fun ConversationControls(
    sessionPhase: SessionPhase,
    isRecording: Boolean,
    isProcessing: Boolean,
    isPlayingAudio: Boolean,
    onStartPressed: () -> Unit,
    onRecordPressed: () -> Unit,
    onStopRecordingPressed: () -> Unit,
    onPausePressed: () -> Unit,
    onResumePressed: () -> Unit,
    onStopPressed: () -> Unit,
    processingStep: ProcessingStep = ProcessingStep.NONE,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        AnimatedContent(
            targetState = sessionPhase,
            transitionSpec = {
                fadeIn(animationSpec = tween(300)) togetherWith
                    fadeOut(animationSpec = tween(300))
            },
            label = "session_phase_transition"
        ) { phase ->
            Box(
                modifier = Modifier.fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                when (phase) {
                    SessionPhase.NOT_STARTED -> {
                        StartButton(onClick = onStartPressed)
                    }

                    SessionPhase.STARTING -> {
                        ProcessingIndicator(label = "Starting session...")
                    }

                    SessionPhase.ENDING -> {
                        ProcessingIndicator(label = "Saving your data...")
                    }

                    SessionPhase.ACTIVE -> {
                        ActiveControls(
                            isRecording = isRecording,
                            isProcessing = isProcessing,
                            isPlayingAudio = isPlayingAudio,
                            processingStep = processingStep,
                            onRecordPressed = onRecordPressed,
                            onStopRecordingPressed = onStopRecordingPressed,
                            onPausePressed = onPausePressed,
                            onStopPressed = onStopPressed
                        )
                    }

                    SessionPhase.PAUSED -> {
                        PausedControls(
                            onResumePressed = onResumePressed,
                            onStopPressed = onStopPressed
                        )
                    }

                    SessionPhase.ENDED -> {
                        // No controls; session summary screen handles this
                    }
                }
            }
        }
    }
}

/**
 * Processing step labels for the conversation pipeline.
 */
enum class ProcessingStep {
    NONE,
    TRANSCRIBING,
    THINKING,
    SPEAKING
}

/**
 * Large green Start button (72dp) with mic icon and haptic feedback.
 */
@Composable
private fun StartButton(onClick: () -> Unit) {
    val haptic = LocalHapticFeedback.current

    FilledIconButton(
        onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onClick()
        },
        modifier = Modifier
            .size(72.dp)
            .semantics {
                contentDescription = "Start conversation"
            },
        shape = CircleShape,
        colors = IconButtonDefaults.filledIconButtonColors(
            containerColor = Color(0xFF4CAF50),
            contentColor = Color.White
        )
    ) {
        Icon(
            imageVector = Icons.Filled.Mic,
            contentDescription = null, // Covered by button-level description
            modifier = Modifier.size(32.dp)
        )
    }
}

/**
 * Controls shown during an active session: Record, Pause, Stop.
 * Includes pipeline step indicator when processing.
 */
@Composable
private fun ActiveControls(
    isRecording: Boolean,
    isProcessing: Boolean,
    isPlayingAudio: Boolean,
    processingStep: ProcessingStep,
    onRecordPressed: () -> Unit,
    onStopRecordingPressed: () -> Unit,
    onPausePressed: () -> Unit,
    onStopPressed: () -> Unit
) {
    val haptic = LocalHapticFeedback.current

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(24.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Pause button (yellow, 48dp)
            FilledIconButton(
                onClick = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onPausePressed()
                },
                modifier = Modifier
                    .size(48.dp)
                    .semantics {
                        contentDescription = "Pause recording"
                    },
                shape = CircleShape,
                enabled = !isRecording && !isProcessing,
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = Color(0xFFFFC107),
                    contentColor = Color.White
                )
            ) {
                Icon(
                    imageVector = Icons.Filled.Pause,
                    contentDescription = null,
                    modifier = Modifier.size(24.dp)
                )
            }

            // Record / Stop Recording / Processing button (72dp)
            if (isProcessing) {
                ProcessingIndicatorWithStep(processingStep)
            } else if (isRecording) {
                RecordingButton(onClick = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onStopRecordingPressed()
                })
            } else {
                FilledIconButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        onRecordPressed()
                    },
                    modifier = Modifier
                        .size(72.dp)
                        .semantics {
                            contentDescription = "Record your response"
                        },
                    shape = CircleShape,
                    enabled = !isPlayingAudio,
                    colors = IconButtonDefaults.filledIconButtonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = Color.White
                    )
                ) {
                    Icon(
                        imageVector = Icons.Filled.Mic,
                        contentDescription = null,
                        modifier = Modifier.size(32.dp)
                    )
                }
            }

            // Stop button (red, 48dp)
            FilledIconButton(
                onClick = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onStopPressed()
                },
                modifier = Modifier
                    .size(48.dp)
                    .semantics {
                        contentDescription = "Stop conversation"
                    },
                shape = RoundedCornerShape(8.dp),
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = Color(0xFFF44336),
                    contentColor = Color.White
                )
            ) {
                Icon(
                    imageVector = Icons.Filled.Stop,
                    contentDescription = null,
                    modifier = Modifier.size(24.dp)
                )
            }
        }

        // Listening animation when recording
        if (isRecording) {
            ListeningAnimation()
        }
    }
}

/**
 * Animated pulsing dots indicating active listening.
 */
@Composable
private fun ListeningAnimation() {
    val infiniteTransition = rememberInfiniteTransition(label = "listening_dots")

    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .semantics { contentDescription = "Listening for your response" }
            .padding(top = 4.dp)
    ) {
        repeat(3) { index ->
            val offsetY by infiniteTransition.animateFloat(
                initialValue = 0f,
                targetValue = -6f,
                animationSpec = infiniteRepeatable(
                    animation = tween(400, delayMillis = index * 150),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "dot_bounce_$index"
            )

            Box(
                modifier = Modifier
                    .size(8.dp)
                    .offset(y = offsetY.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary)
            )
        }

        Text(
            text = "Listening...",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp)
        )
    }
}

/**
 * Pulsing red recording indicator button.
 */
@Composable
private fun RecordingButton(onClick: () -> Unit) {
    val infiniteTransition = rememberInfiniteTransition(label = "recording_pulse")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 0.6f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(600),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse_alpha"
    )

    FilledIconButton(
        onClick = onClick,
        modifier = Modifier
            .size(72.dp)
            .alpha(alpha)
            .semantics {
                contentDescription = "Stop recording. Tap to finish your response."
            },
        shape = CircleShape,
        colors = IconButtonDefaults.filledIconButtonColors(
            containerColor = Color(0xFFF44336),
            contentColor = Color.White
        )
    ) {
        // Pulsing red dot
        Box(
            modifier = Modifier
                .size(16.dp)
                .clip(CircleShape)
                .background(Color.White)
        )
    }
}

/**
 * Controls shown when session is paused: Resume and Stop.
 */
@Composable
private fun PausedControls(
    onResumePressed: () -> Unit,
    onStopPressed: () -> Unit
) {
    val haptic = LocalHapticFeedback.current

    Row(
        horizontalArrangement = Arrangement.spacedBy(24.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Resume button (green, 72dp)
        FilledIconButton(
            onClick = {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                onResumePressed()
            },
            modifier = Modifier
                .size(72.dp)
                .semantics {
                    contentDescription = "Resume conversation"
                },
            shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = Color(0xFF4CAF50),
                contentColor = Color.White
            )
        ) {
            Icon(
                imageVector = Icons.Filled.PlayArrow,
                contentDescription = null,
                modifier = Modifier.size(32.dp)
            )
        }

        // Stop button (red, 48dp)
        FilledIconButton(
            onClick = {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                onStopPressed()
            },
            modifier = Modifier
                .size(48.dp)
                .semantics {
                    contentDescription = "Stop conversation"
                },
            shape = RoundedCornerShape(8.dp),
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = Color(0xFFF44336),
                contentColor = Color.White
            )
        ) {
            Icon(
                imageVector = Icons.Filled.Stop,
                contentDescription = null,
                modifier = Modifier.size(24.dp)
            )
        }
    }
}

/**
 * Processing spinner with pipeline step label.
 */
@Composable
private fun ProcessingIndicatorWithStep(step: ProcessingStep) {
    val stepLabel = when (step) {
        ProcessingStep.NONE -> "Processing"
        ProcessingStep.TRANSCRIBING -> "Transcribing..."
        ProcessingStep.THINKING -> "Thinking..."
        ProcessingStep.SPEAKING -> "Speaking..."
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.semantics {
            contentDescription = stepLabel
        }
    ) {
        Box(
            modifier = Modifier.size(72.dp),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(48.dp),
                color = MaterialTheme.colorScheme.primary,
                strokeWidth = 4.dp
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        AnimatedContent(
            targetState = stepLabel,
            transitionSpec = {
                fadeIn(tween(200)) togetherWith fadeOut(tween(200))
            },
            label = "step_label"
        ) { label ->
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * Processing spinner shown during session start/end.
 */
@Composable
private fun ProcessingIndicator(label: String = "Processing") {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.semantics {
            contentDescription = label
        }
    ) {
        Box(
            modifier = Modifier.size(72.dp),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(48.dp),
                color = MaterialTheme.colorScheme.primary,
                strokeWidth = 4.dp
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

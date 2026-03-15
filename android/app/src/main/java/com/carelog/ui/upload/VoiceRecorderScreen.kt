package com.carelog.ui.upload

import android.Manifest
import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.carelog.ui.theme.CareLogColors
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import kotlinx.coroutines.delay
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

/**
 * Voice note recording screen.
 */
@OptIn(ExperimentalPermissionsApi::class, ExperimentalMaterial3Api::class)
@Composable
fun VoiceRecorderScreen(
    onNavigateBack: () -> Unit,
    onRecordingComplete: (Uri) -> Unit
) {
    val context = LocalContext.current
    val micPermissionState = rememberPermissionState(Manifest.permission.RECORD_AUDIO)

    var isRecording by remember { mutableStateOf(false) }
    var recordingDuration by remember { mutableLongStateOf(0L) }
    var recordedFile by remember { mutableStateOf<File?>(null) }
    var showPlayback by remember { mutableStateOf(false) }

    var mediaRecorder by remember { mutableStateOf<MediaRecorder?>(null) }

    LaunchedEffect(Unit) {
        if (!micPermissionState.status.isGranted) {
            micPermissionState.launchPermissionRequest()
        }
    }

    // Timer for recording duration
    LaunchedEffect(isRecording) {
        while (isRecording) {
            delay(100)
            recordingDuration += 100
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            mediaRecorder?.release()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Voice Note") },
                navigationIcon = {
                    IconButton(onClick = {
                        mediaRecorder?.release()
                        recordedFile?.delete()
                        onNavigateBack()
                    }) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CareLogColors.Upload,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White
                )
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            if (!micPermissionState.status.isGranted) {
                // Permission denied
                PermissionRequiredContent(
                    icon = Icons.Default.Mic,
                    message = "Microphone permission required",
                    onRequestPermission = { micPermissionState.launchPermissionRequest() }
                )
            } else if (showPlayback && recordedFile != null) {
                // Playback mode
                PlaybackContent(
                    context = context,
                    recordedFile = recordedFile!!,
                    duration = recordingDuration,
                    onRetake = {
                        showPlayback = false
                        recordedFile?.delete()
                        recordedFile = null
                        recordingDuration = 0
                    },
                    onUse = {
                        recordedFile?.let { file ->
                            onRecordingComplete(Uri.fromFile(file))
                        }
                    }
                )
            } else {
                // Recording mode
                RecordingContent(
                    isRecording = isRecording,
                    duration = recordingDuration,
                    onStartRecording = {
                        val file = createAudioFile(context)
                        mediaRecorder = createMediaRecorder(context, file)
                        try {
                            mediaRecorder?.prepare()
                            mediaRecorder?.start()
                            recordedFile = file
                            isRecording = true
                            recordingDuration = 0
                        } catch (e: Exception) {
                            Log.e("VoiceRecorder", "Recording failed", e)
                        }
                    },
                    onStopRecording = {
                        try {
                            mediaRecorder?.stop()
                            mediaRecorder?.release()
                            mediaRecorder = null
                            isRecording = false
                            showPlayback = true
                        } catch (e: Exception) {
                            Log.e("VoiceRecorder", "Stop recording failed", e)
                        }
                    }
                )
            }
        }
    }
}

@Composable
private fun PermissionRequiredContent(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    message: String,
    onRequestPermission: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            icon,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = CareLogColors.OnSurfaceVariant
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            message,
            style = MaterialTheme.typography.titleMedium
        )

        Spacer(modifier = Modifier.height(24.dp))

        Button(onClick = onRequestPermission) {
            Text("Grant Permission")
        }
    }
}

@Composable
private fun RecordingContent(
    isRecording: Boolean,
    duration: Long,
    onStartRecording: () -> Unit,
    onStopRecording: () -> Unit
) {
    // Pulse animation for recording indicator
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.1f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "scale"
    )

    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Spacer(modifier = Modifier.weight(1f))

        // Recording indicator
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(200.dp)
                .scale(if (isRecording) scale else 1f)
        ) {
            // Outer circle
            Box(
                modifier = Modifier
                    .size(200.dp)
                    .clip(CircleShape)
                    .background(
                        if (isRecording) CareLogColors.Error.copy(alpha = 0.2f)
                        else CareLogColors.OnSurfaceVariant.copy(alpha = 0.1f)
                    )
            )

            // Mic icon
            Icon(
                Icons.Default.Mic,
                contentDescription = "Microphone",
                modifier = Modifier.size(60.dp),
                tint = if (isRecording) CareLogColors.Error else CareLogColors.OnSurfaceVariant
            )
        }

        Spacer(modifier = Modifier.height(32.dp))

        // Timer
        Text(
            formatDuration(duration),
            style = MaterialTheme.typography.displayMedium.copy(
                fontFamily = FontFamily.Monospace,
                fontSize = 48.sp
            ),
            color = if (isRecording) CareLogColors.Error else CareLogColors.OnSurface
        )

        Spacer(modifier = Modifier.weight(1f))

        // Record button
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(bottom = 48.dp)
        ) {
            IconButton(
                onClick = {
                    if (isRecording) onStopRecording() else onStartRecording()
                },
                modifier = Modifier
                    .size(80.dp)
                    .clip(CircleShape)
                    .background(if (isRecording) CareLogColors.Error else CareLogColors.Primary)
            ) {
                if (isRecording) {
                    // Stop icon (square)
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color.White)
                    )
                } else {
                    // Record icon (circle)
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(Color.White)
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                if (isRecording) "Tap to stop" else "Tap to record",
                style = MaterialTheme.typography.bodyMedium,
                color = CareLogColors.OnSurfaceVariant
            )
        }
    }
}

@Composable
private fun PlaybackContent(
    context: Context,
    recordedFile: File,
    duration: Long,
    onRetake: () -> Unit,
    onUse: () -> Unit
) {
    var isPlaying by remember { mutableStateOf(false) }
    var playbackPosition by remember { mutableLongStateOf(0L) }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }

    // Playback position update
    LaunchedEffect(isPlaying) {
        while (isPlaying) {
            delay(100)
            mediaPlayer?.let {
                playbackPosition = it.currentPosition.toLong()
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            mediaPlayer?.release()
        }
    }

    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Spacer(modifier = Modifier.weight(1f))

        // Play button
        IconButton(
            onClick = {
                if (isPlaying) {
                    mediaPlayer?.pause()
                    isPlaying = false
                } else {
                    if (mediaPlayer == null) {
                        mediaPlayer = MediaPlayer().apply {
                            setDataSource(recordedFile.absolutePath)
                            prepare()
                            setOnCompletionListener {
                                isPlaying = false
                                playbackPosition = 0
                                seekTo(0)
                            }
                        }
                    }
                    mediaPlayer?.start()
                    isPlaying = true
                }
            },
            modifier = Modifier
                .size(80.dp)
                .clip(CircleShape)
                .background(CareLogColors.Primary.copy(alpha = 0.1f))
        ) {
            Icon(
                if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                contentDescription = if (isPlaying) "Pause" else "Play",
                modifier = Modifier.size(40.dp),
                tint = CareLogColors.Primary
            )
        }

        Spacer(modifier = Modifier.height(32.dp))

        // Progress
        Column(
            modifier = Modifier.padding(horizontal = 48.dp)
        ) {
            LinearProgressIndicator(
                progress = { playbackPosition.toFloat() / duration.coerceAtLeast(1) },
                modifier = Modifier.fillMaxWidth(),
                color = CareLogColors.Primary
            )

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    formatDuration(playbackPosition),
                    style = MaterialTheme.typography.bodySmall,
                    color = CareLogColors.OnSurfaceVariant
                )
                Text(
                    formatDuration(duration),
                    style = MaterialTheme.typography.bodySmall,
                    color = CareLogColors.OnSurfaceVariant
                )
            }
        }

        Spacer(modifier = Modifier.weight(1f))

        // Action buttons
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 48.dp, vertical = 48.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            // Retake button
            Column(
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                IconButton(
                    onClick = {
                        mediaPlayer?.release()
                        mediaPlayer = null
                        isPlaying = false
                        onRetake()
                    },
                    modifier = Modifier
                        .size(56.dp)
                        .clip(CircleShape)
                        .background(CareLogColors.OnSurfaceVariant.copy(alpha = 0.2f))
                ) {
                    Icon(
                        Icons.Default.Refresh,
                        contentDescription = "Retake",
                        tint = CareLogColors.OnSurfaceVariant
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text("Retake", style = MaterialTheme.typography.bodySmall)
            }

            // Use button
            Column(
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                IconButton(
                    onClick = {
                        mediaPlayer?.release()
                        onUse()
                    },
                    modifier = Modifier
                        .size(56.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(CareLogColors.Primary)
                ) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = "Use",
                        tint = Color.White
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text("Use", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

private fun formatDuration(millis: Long): String {
    val minutes = (millis / 1000) / 60
    val seconds = (millis / 1000) % 60
    return String.format("%02d:%02d", minutes, seconds)
}

private fun createAudioFile(context: Context): File {
    val fileName = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".m4a"
    return File(context.cacheDir, fileName)
}

@Suppress("DEPRECATION")
private fun createMediaRecorder(context: Context, outputFile: File): MediaRecorder {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        MediaRecorder(context)
    } else {
        MediaRecorder()
    }.apply {
        setAudioSource(MediaRecorder.AudioSource.MIC)
        setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        setAudioSamplingRate(44100)
        setAudioEncodingBitRate(128000)
        setOutputFile(outputFile.absolutePath)
    }
}

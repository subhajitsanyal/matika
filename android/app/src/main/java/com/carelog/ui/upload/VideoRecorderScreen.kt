package com.carelog.ui.upload

import android.Manifest
import android.content.Context
import android.net.Uri
import android.os.Build
import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.*
import androidx.camera.view.PreviewView
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.carelog.ui.theme.CareLogColors
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberMultiplePermissionsState
import kotlinx.coroutines.delay
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/**
 * Video note recording screen.
 */
@OptIn(ExperimentalPermissionsApi::class, ExperimentalMaterial3Api::class)
@Composable
fun VideoRecorderScreen(
    onNavigateBack: () -> Unit,
    onRecordingComplete: (Uri) -> Unit
) {
    val context = LocalContext.current
    @Suppress("UNUSED_VARIABLE")
    val lifecycleOwner = LocalLifecycleOwner.current

    val permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
    } else {
        listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
    }

    val permissionsState = rememberMultiplePermissionsState(permissions)

    var isRecording by remember { mutableStateOf(false) }
    var recordingDuration by remember { mutableLongStateOf(0L) }
    var recordedUri by remember { mutableStateOf<Uri?>(null) }
    var showPreview by remember { mutableStateOf(false) }
    var lensFacing by remember { mutableIntStateOf(CameraSelector.LENS_FACING_BACK) }

    var videoCapture by remember { mutableStateOf<VideoCapture<Recorder>?>(null) }
    var activeRecording by remember { mutableStateOf<Recording?>(null) }

    val maxDurationMs = 120_000L // 2 minutes

    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }

    // Timer for recording duration
    LaunchedEffect(isRecording) {
        while (isRecording && recordingDuration < maxDurationMs) {
            delay(100)
            recordingDuration += 100
            if (recordingDuration >= maxDurationMs) {
                activeRecording?.stop()
            }
        }
    }

    LaunchedEffect(Unit) {
        if (!permissionsState.allPermissionsGranted) {
            permissionsState.launchMultiplePermissionRequest()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            cameraExecutor.shutdown()
            activeRecording?.stop()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Video Note") },
                navigationIcon = {
                    IconButton(onClick = {
                        activeRecording?.stop()
                        onNavigateBack()
                    }) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Black,
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
                .background(Color.Black)
        ) {
            if (!permissionsState.allPermissionsGranted) {
                // Permission denied
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Icon(
                        Icons.Default.Videocam,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = Color.White
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    Text(
                        "Camera and microphone permissions required",
                        color = Color.White,
                        style = MaterialTheme.typography.titleMedium
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    Button(onClick = { permissionsState.launchMultiplePermissionRequest() }) {
                        Text("Grant Permissions")
                    }
                }
            } else if (showPreview && recordedUri != null) {
                // Show preview
                VideoPreviewContent(
                    context = context,
                    videoUri = recordedUri!!,
                    onRetake = {
                        showPreview = false
                        recordedUri = null
                        recordingDuration = 0
                    },
                    onUse = {
                        recordedUri?.let { onRecordingComplete(it) }
                    }
                )
            } else {
                // Camera preview
                VideoRecordingContent(
                    context = context,
                    lensFacing = lensFacing,
                    isRecording = isRecording,
                    recordingDuration = recordingDuration,
                    maxDuration = maxDurationMs,
                    cameraExecutor = cameraExecutor,
                    onVideoCaptureReady = { videoCapture = it },
                    onSwitchCamera = {
                        if (!isRecording) {
                            lensFacing = if (lensFacing == CameraSelector.LENS_FACING_BACK) {
                                CameraSelector.LENS_FACING_FRONT
                            } else {
                                CameraSelector.LENS_FACING_BACK
                            }
                        }
                    },
                    onStartRecording = {
                        val file = createVideoFile(context)
                        val outputOptions = FileOutputOptions.Builder(file).build()

                        videoCapture?.let { vc ->
                            activeRecording = vc.output
                                .prepareRecording(context, outputOptions)
                                .withAudioEnabled()
                                .start(ContextCompat.getMainExecutor(context)) { event ->
                                    when (event) {
                                        is VideoRecordEvent.Finalize -> {
                                            if (!event.hasError()) {
                                                recordedUri = Uri.fromFile(file)
                                                showPreview = true
                                            } else {
                                                Log.e("VideoRecorder", "Recording error: ${event.error}")
                                            }
                                            isRecording = false
                                        }
                                    }
                                }
                            isRecording = true
                            recordingDuration = 0
                        }
                    },
                    onStopRecording = {
                        activeRecording?.stop()
                        activeRecording = null
                    }
                )
            }
        }
    }
}

@Suppress("UNUSED_PARAMETER")
@Composable
private fun VideoRecordingContent(
    context: Context,
    lensFacing: Int,
    isRecording: Boolean,
    recordingDuration: Long,
    maxDuration: Long,
    cameraExecutor: ExecutorService,
    onVideoCaptureReady: (VideoCapture<Recorder>) -> Unit,
    onSwitchCamera: () -> Unit,
    onStartRecording: () -> Unit,
    onStopRecording: () -> Unit
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context) }

    LaunchedEffect(lensFacing) {
        val cameraProvider = context.getCameraProvider()
        cameraProvider.unbindAll()

        val preview = Preview.Builder().build().also {
            it.setSurfaceProvider(previewView.surfaceProvider)
        }

        val recorder = Recorder.Builder()
            .setQualitySelector(QualitySelector.from(Quality.HD))
            .build()

        val videoCapture = VideoCapture.withOutput(recorder)

        val cameraSelector = CameraSelector.Builder()
            .requireLensFacing(lensFacing)
            .build()

        try {
            cameraProvider.bindToLifecycle(
                lifecycleOwner,
                cameraSelector,
                preview,
                videoCapture
            )
            onVideoCaptureReady(videoCapture)
        } catch (e: Exception) {
            Log.e("VideoRecorder", "Camera binding failed", e)
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        // Camera preview
        AndroidView(
            factory = { previewView },
            modifier = Modifier.fillMaxSize()
        )

        // Timer overlay
        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = 16.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Color.Black.copy(alpha = 0.5f))
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (isRecording) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(Color.Red)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                }

                Text(
                    formatDuration(recordingDuration),
                    color = Color.White,
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.titleMedium
                )

                Text(
                    " / ${formatDuration(maxDuration)}",
                    color = Color.White.copy(alpha = 0.7f),
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }

        // Controls
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.BottomCenter)
                .padding(bottom = 32.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Spacer for balance
                Spacer(modifier = Modifier.size(56.dp))

                // Record button
                IconButton(
                    onClick = {
                        if (isRecording) onStopRecording() else onStartRecording()
                    },
                    modifier = Modifier
                        .size(72.dp)
                        .clip(CircleShape)
                        .background(if (isRecording) Color.Red else Color.Red)
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

                // Switch camera
                IconButton(
                    onClick = onSwitchCamera,
                    enabled = !isRecording,
                    modifier = Modifier
                        .size(56.dp)
                        .clip(CircleShape)
                        .background(
                            if (!isRecording) Color.White.copy(alpha = 0.3f)
                            else Color.White.copy(alpha = 0.1f)
                        )
                ) {
                    Icon(
                        Icons.Default.Cameraswitch,
                        contentDescription = "Switch camera",
                        tint = Color.White
                    )
                }
            }
        }
    }
}

@Composable
private fun VideoPreviewContent(
    context: Context,
    videoUri: Uri,
    onRetake: () -> Unit,
    onUse: () -> Unit
) {
    val exoPlayer = remember {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(videoUri))
            prepare()
            playWhenReady = true
            repeatMode = ExoPlayer.REPEAT_MODE_ALL
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            exoPlayer.release()
        }
    }

    Column(
        modifier = Modifier.fillMaxSize()
    ) {
        // Video player
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    player = exoPlayer
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                    useController = true
                }
            },
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        )

        // Action buttons
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.9f))
                .padding(vertical = 24.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            // Retake button
            Column(
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                IconButton(
                    onClick = {
                        exoPlayer.stop()
                        onRetake()
                    },
                    modifier = Modifier
                        .size(56.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.2f))
                ) {
                    Icon(
                        Icons.Default.Refresh,
                        contentDescription = "Retake",
                        tint = Color.White
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text("Retake", color = Color.White, style = MaterialTheme.typography.bodySmall)
            }

            // Use button
            Column(
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                IconButton(
                    onClick = {
                        exoPlayer.stop()
                        onUse()
                    },
                    modifier = Modifier
                        .size(56.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(CareLogColors.Primary)
                ) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = "Use video",
                        tint = Color.White
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text("Use Video", color = Color.White, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

private fun formatDuration(millis: Long): String {
    val minutes = (millis / 1000) / 60
    val seconds = (millis / 1000) % 60
    return String.format("%02d:%02d", minutes, seconds)
}

private fun createVideoFile(context: Context): File {
    val fileName = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".mp4"
    return File(context.cacheDir, fileName)
}

private suspend fun Context.getCameraProvider(): ProcessCameraProvider =
    suspendCoroutine { continuation ->
        ProcessCameraProvider.getInstance(this).also { future ->
            future.addListener({
                continuation.resume(future.get())
            }, ContextCompat.getMainExecutor(this))
        }
    }

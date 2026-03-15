package com.carelog.ui.upload

import android.Manifest
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.util.Log
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.carelog.ui.theme.CareLogColors
import com.carelog.upload.FileType
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/**
 * Camera screen for capturing medical photos.
 */
@OptIn(ExperimentalPermissionsApi::class, ExperimentalMaterial3Api::class)
@Composable
fun CameraScreen(
    fileType: FileType,
    onNavigateBack: () -> Unit,
    onImageCaptured: (Uri) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    val cameraPermissionState = rememberPermissionState(Manifest.permission.CAMERA)

    var capturedBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var capturedUri by remember { mutableStateOf<Uri?>(null) }
    var showPreview by remember { mutableStateOf(false) }
    var lensFacing by remember { mutableIntStateOf(CameraSelector.LENS_FACING_BACK) }

    val imageCapture = remember { ImageCapture.Builder().build() }
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }

    DisposableEffect(Unit) {
        onDispose {
            cameraExecutor.shutdown()
        }
    }

    LaunchedEffect(Unit) {
        if (!cameraPermissionState.status.isGranted) {
            cameraPermissionState.launchPermissionRequest()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(fileType.displayName) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
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
            if (!cameraPermissionState.status.isGranted) {
                // Permission denied
                PermissionDeniedContent(
                    onRequestPermission = { cameraPermissionState.launchPermissionRequest() }
                )
            } else if (showPreview && capturedBitmap != null) {
                // Show preview
                ImagePreviewContent(
                    bitmap = capturedBitmap!!,
                    onRetake = {
                        showPreview = false
                        capturedBitmap = null
                        capturedUri = null
                    },
                    onUse = {
                        capturedUri?.let { onImageCaptured(it) }
                    }
                )
            } else {
                // Camera preview
                CameraPreviewContent(
                    imageCapture = imageCapture,
                    lensFacing = lensFacing,
                    cameraExecutor = cameraExecutor,
                    onSwitchCamera = {
                        lensFacing = if (lensFacing == CameraSelector.LENS_FACING_BACK) {
                            CameraSelector.LENS_FACING_FRONT
                        } else {
                            CameraSelector.LENS_FACING_BACK
                        }
                    },
                    onCapture = {
                        capturePhoto(
                            context = context,
                            imageCapture = imageCapture,
                            executor = cameraExecutor,
                            lensFacing = lensFacing
                        ) { bitmap, uri ->
                            capturedBitmap = bitmap
                            capturedUri = uri
                            showPreview = true
                        }
                    }
                )
            }
        }
    }
}

@Composable
private fun PermissionDeniedContent(
    onRequestPermission: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.CameraAlt,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = Color.White
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            "Camera permission required",
            color = Color.White,
            style = MaterialTheme.typography.titleMedium
        )

        Spacer(modifier = Modifier.height(24.dp))

        Button(onClick = onRequestPermission) {
            Text("Grant Permission")
        }
    }
}

@Composable
private fun CameraPreviewContent(
    imageCapture: ImageCapture,
    lensFacing: Int,
    cameraExecutor: ExecutorService,
    onSwitchCamera: () -> Unit,
    onCapture: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context) }

    LaunchedEffect(lensFacing) {
        val cameraProvider = context.getCameraProvider()
        cameraProvider.unbindAll()

        val preview = Preview.Builder().build().also {
            it.setSurfaceProvider(previewView.surfaceProvider)
        }

        val cameraSelector = CameraSelector.Builder()
            .requireLensFacing(lensFacing)
            .build()

        try {
            cameraProvider.bindToLifecycle(
                lifecycleOwner,
                cameraSelector,
                preview,
                imageCapture
            )
        } catch (e: Exception) {
            Log.e("CameraScreen", "Camera binding failed", e)
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        // Camera preview
        AndroidView(
            factory = { previewView },
            modifier = Modifier.fillMaxSize()
        )

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

                // Capture button
                IconButton(
                    onClick = onCapture,
                    modifier = Modifier
                        .size(72.dp)
                        .clip(CircleShape)
                        .background(Color.White)
                ) {
                    Box(
                        modifier = Modifier
                            .size(60.dp)
                            .clip(CircleShape)
                            .background(Color.White)
                    )
                }

                // Switch camera
                IconButton(
                    onClick = onSwitchCamera,
                    modifier = Modifier
                        .size(56.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.3f))
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
private fun ImagePreviewContent(
    bitmap: Bitmap,
    onRetake: () -> Unit,
    onUse: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize()
    ) {
        // Image preview
        Image(
            bitmap = bitmap.asImageBitmap(),
            contentDescription = "Captured photo",
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentScale = ContentScale.Fit
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
                    onClick = onRetake,
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
                    onClick = onUse,
                    modifier = Modifier
                        .size(56.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(CareLogColors.Primary)
                ) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = "Use photo",
                        tint = Color.White
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text("Use Photo", color = Color.White, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

private fun capturePhoto(
    context: Context,
    imageCapture: ImageCapture,
    executor: ExecutorService,
    lensFacing: Int,
    onPhotoCaptured: (Bitmap, Uri) -> Unit
) {
    val photoFile = File(
        context.cacheDir,
        SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".jpg"
    )

    val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()

    imageCapture.takePicture(
        outputOptions,
        executor,
        object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                val uri = Uri.fromFile(photoFile)
                val bitmap = BitmapFactory.decodeFile(photoFile.absolutePath)

                // Rotate if needed for front camera
                val finalBitmap = if (lensFacing == CameraSelector.LENS_FACING_FRONT) {
                    val matrix = Matrix().apply { postScale(-1f, 1f) }
                    Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                } else {
                    bitmap
                }

                onPhotoCaptured(finalBitmap, uri)
            }

            override fun onError(exception: ImageCaptureException) {
                Log.e("CameraScreen", "Photo capture failed", exception)
            }
        }
    )
}

private suspend fun Context.getCameraProvider(): ProcessCameraProvider =
    suspendCoroutine { continuation ->
        ProcessCameraProvider.getInstance(this).also { future ->
            future.addListener({
                continuation.resume(future.get())
            }, ContextCompat.getMainExecutor(this))
        }
    }

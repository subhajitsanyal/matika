package com.carelog.ui.upload

import android.Manifest
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.carelog.ui.theme.CareLogColors
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
 * Prescription scan screen with camera capture and file picker.
 */
@OptIn(ExperimentalPermissionsApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PrescriptionScanScreen(
    onNavigateBack: () -> Unit,
    onDocumentSelected: (Uri, String) -> Unit // (uri, contentType)
) {
    val context = LocalContext.current

    var showCamera by remember { mutableStateOf(false) }
    var capturedBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var capturedUri by remember { mutableStateOf<Uri?>(null) }
    var showPreview by remember { mutableStateOf(false) }

    // Document picker launcher
    val documentPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            val contentType = context.contentResolver.getType(it) ?: "application/pdf"
            onDocumentSelected(it, contentType)
        }
    }

    // Image picker launcher
    val imagePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            onDocumentSelected(it, "image/jpeg")
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Prescription") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CareLogColors.Primary,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White
                )
            )
        }
    ) { paddingValues ->
        when {
            showPreview && capturedBitmap != null -> {
                // Show captured image preview
                ImagePreviewContent(
                    bitmap = capturedBitmap!!,
                    modifier = Modifier.padding(paddingValues),
                    onRetake = {
                        showPreview = false
                        capturedBitmap = null
                        capturedUri = null
                    },
                    onUse = {
                        capturedUri?.let { uri ->
                            onDocumentSelected(uri, "image/jpeg")
                        }
                    }
                )
            }
            showCamera -> {
                // Show camera
                CameraCaptureContent(
                    modifier = Modifier.padding(paddingValues),
                    onCapture = { bitmap, uri ->
                        capturedBitmap = bitmap
                        capturedUri = uri
                        showPreview = true
                        showCamera = false
                    },
                    onCancel = {
                        showCamera = false
                    }
                )
            }
            else -> {
                // Show options
                OptionsContent(
                    modifier = Modifier.padding(paddingValues),
                    onScanDocument = { showCamera = true },
                    onChooseFromGallery = { imagePickerLauncher.launch("image/*") },
                    onUploadPDF = { documentPickerLauncher.launch("application/pdf") }
                )
            }
        }
    }
}

@Composable
private fun OptionsContent(
    modifier: Modifier = Modifier,
    onScanDocument: () -> Unit,
    onChooseFromGallery: () -> Unit,
    onUploadPDF: () -> Unit
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Spacer(modifier = Modifier.weight(1f))

        // Icon
        Icon(
            Icons.Default.DocumentScanner,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = CareLogColors.Primary
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            "Scan or Upload Prescription",
            style = MaterialTheme.typography.titleLarge
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            "Choose how you'd like to add your prescription",
            style = MaterialTheme.typography.bodyMedium,
            color = CareLogColors.OnSurfaceVariant
        )

        Spacer(modifier = Modifier.weight(1f))

        // Options
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            OptionCard(
                icon = Icons.Default.DocumentScanner,
                title = "Scan Document",
                subtitle = "Use camera to scan",
                color = CareLogColors.Primary,
                onClick = onScanDocument
            )

            OptionCard(
                icon = Icons.Default.PhotoLibrary,
                title = "Choose from Gallery",
                subtitle = "Select existing photo",
                color = CareLogColors.Glucose,
                onClick = onChooseFromGallery
            )

            OptionCard(
                icon = Icons.Default.PictureAsPdf,
                title = "Upload PDF",
                subtitle = "Select from files",
                color = CareLogColors.SpO2,
                onClick = onUploadPDF
            )
        }

        Spacer(modifier = Modifier.weight(1f))
    }
}

@Composable
private fun OptionCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    color: Color,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(color.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    modifier = Modifier.size(28.dp),
                    tint = color
                )
            }

            Spacer(modifier = Modifier.width(16.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = CareLogColors.OnSurfaceVariant
                )
            }

            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = CareLogColors.OnSurfaceVariant
            )
        }
    }
}

@OptIn(ExperimentalPermissionsApi::class)
@Composable
private fun CameraCaptureContent(
    modifier: Modifier = Modifier,
    onCapture: (Bitmap, Uri) -> Unit,
    onCancel: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraPermissionState = rememberPermissionState(Manifest.permission.CAMERA)

    val imageCapture = remember { ImageCapture.Builder().build() }
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }
    val previewView = remember { PreviewView(context) }

    LaunchedEffect(Unit) {
        if (!cameraPermissionState.status.isGranted) {
            cameraPermissionState.launchPermissionRequest()
        }
    }

    LaunchedEffect(cameraPermissionState.status.isGranted) {
        if (cameraPermissionState.status.isGranted) {
            val cameraProvider = context.getCameraProvider()
            cameraProvider.unbindAll()

            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }

            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

            try {
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    cameraSelector,
                    preview,
                    imageCapture
                )
            } catch (e: Exception) {
                Log.e("PrescriptionScan", "Camera binding failed", e)
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            cameraExecutor.shutdown()
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        if (!cameraPermissionState.status.isGranted) {
            // Permission required
            Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Icon(
                    Icons.Default.CameraAlt,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = CareLogColors.OnSurfaceVariant
                )

                Spacer(modifier = Modifier.height(16.dp))

                Text("Camera permission required")

                Spacer(modifier = Modifier.height(16.dp))

                Button(onClick = { cameraPermissionState.launchPermissionRequest() }) {
                    Text("Grant Permission")
                }
            }
        } else {
            // Camera preview
            AndroidView(
                factory = { previewView },
                modifier = Modifier.fillMaxSize()
            )

            // Cancel button
            IconButton(
                onClick = onCancel,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(16.dp)
                    .size(48.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.Black.copy(alpha = 0.5f))
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "Cancel",
                    tint = Color.White
                )
            }

            // Capture button
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 48.dp)
            ) {
                IconButton(
                    onClick = {
                        capturePhoto(context, imageCapture, cameraExecutor, onCapture)
                    },
                    modifier = Modifier
                        .size(72.dp)
                        .clip(androidx.compose.foundation.shape.CircleShape)
                        .background(Color.White)
                ) {
                    Box(
                        modifier = Modifier
                            .size(60.dp)
                            .clip(androidx.compose.foundation.shape.CircleShape)
                            .background(Color.White)
                    )
                }
            }

            // Document guide frame
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(0.75f) // A4 ratio approximation
                        .background(Color.Transparent)
                ) {
                    // Corner indicators
                    // Top-left
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .align(Alignment.TopStart)
                            .background(Color.Transparent)
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(3.dp)
                                .background(CareLogColors.Primary)
                        )
                        Box(
                            modifier = Modifier
                                .width(3.dp)
                                .fillMaxHeight()
                                .background(CareLogColors.Primary)
                        )
                    }

                    // Top-right
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .align(Alignment.TopEnd)
                            .background(Color.Transparent)
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(3.dp)
                                .background(CareLogColors.Primary)
                        )
                        Box(
                            modifier = Modifier
                                .width(3.dp)
                                .fillMaxHeight()
                                .align(Alignment.TopEnd)
                                .background(CareLogColors.Primary)
                        )
                    }

                    // Bottom-left
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .align(Alignment.BottomStart)
                            .background(Color.Transparent)
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(3.dp)
                                .align(Alignment.BottomStart)
                                .background(CareLogColors.Primary)
                        )
                        Box(
                            modifier = Modifier
                                .width(3.dp)
                                .fillMaxHeight()
                                .background(CareLogColors.Primary)
                        )
                    }

                    // Bottom-right
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .align(Alignment.BottomEnd)
                            .background(Color.Transparent)
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(3.dp)
                                .align(Alignment.BottomEnd)
                                .background(CareLogColors.Primary)
                        )
                        Box(
                            modifier = Modifier
                                .width(3.dp)
                                .fillMaxHeight()
                                .align(Alignment.BottomEnd)
                                .background(CareLogColors.Primary)
                        )
                    }
                }
            }

            // Hint text
            Text(
                "Position prescription within the frame",
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 80.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color.Black.copy(alpha = 0.6f))
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                color = Color.White,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

@Composable
private fun ImagePreviewContent(
    bitmap: Bitmap,
    modifier: Modifier = Modifier,
    onRetake: () -> Unit,
    onUse: () -> Unit
) {
    Column(
        modifier = modifier.fillMaxSize()
    ) {
        // Image preview
        Image(
            bitmap = bitmap.asImageBitmap(),
            contentDescription = "Captured prescription",
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(Color.Black),
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
                        .clip(androidx.compose.foundation.shape.CircleShape)
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
    onPhotoCaptured: (Bitmap, Uri) -> Unit
) {
    val photoFile = File(
        context.cacheDir,
        "prescription_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.jpg"
    )

    val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()

    imageCapture.takePicture(
        outputOptions,
        executor,
        object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                val uri = Uri.fromFile(photoFile)
                val bitmap = BitmapFactory.decodeFile(photoFile.absolutePath)
                onPhotoCaptured(bitmap, uri)
            }

            override fun onError(exception: ImageCaptureException) {
                Log.e("PrescriptionScan", "Photo capture failed", exception)
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

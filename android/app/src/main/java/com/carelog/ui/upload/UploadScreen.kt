package com.carelog.ui.upload

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.ui.theme.CareLogColors
import com.carelog.upload.FileType

/**
 * Upload screen with options for different media types.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UploadScreen(
    onNavigateBack: () -> Unit,
    onNavigateToCamera: (FileType) -> Unit,
    onNavigateToVoiceRecorder: () -> Unit,
    onNavigateToVideoRecorder: () -> Unit,
    viewModel: UploadViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    // Document picker launcher
    val documentPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { viewModel.uploadDocument(context, it) }
    }

    // Image picker launcher
    val imagePicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { viewModel.uploadImage(context, it, uiState.selectedFileType) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Upload Media") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
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
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                items(uploadOptions) { option ->
                    UploadOptionCard(
                        option = option,
                        onClick = {
                            when (option.type) {
                                UploadOptionType.PRESCRIPTION -> {
                                    viewModel.setSelectedFileType(FileType.PRESCRIPTION)
                                    documentPicker.launch("application/pdf")
                                }
                                UploadOptionType.WOUND_PHOTO -> {
                                    onNavigateToCamera(FileType.WOUND_PHOTO)
                                }
                                UploadOptionType.MEDICAL_PHOTO -> {
                                    viewModel.setSelectedFileType(FileType.MEDICAL_PHOTO)
                                    imagePicker.launch("image/*")
                                }
                                UploadOptionType.VOICE_NOTE -> {
                                    onNavigateToVoiceRecorder()
                                }
                                UploadOptionType.VIDEO_NOTE -> {
                                    onNavigateToVideoRecorder()
                                }
                                UploadOptionType.GALLERY -> {
                                    viewModel.setSelectedFileType(FileType.MEDICAL_PHOTO)
                                    imagePicker.launch("image/*")
                                }
                            }
                        }
                    )
                }
            }

            // Upload progress overlay
            if (uiState.isUploading) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.5f)),
                    contentAlignment = Alignment.Center
                ) {
                    Card(
                        modifier = Modifier.padding(32.dp)
                    ) {
                        Column(
                            modifier = Modifier.padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            CircularProgressIndicator()
                            Spacer(modifier = Modifier.height(16.dp))
                            Text("Uploading...")
                            uiState.uploadProgress?.let { progress ->
                                Spacer(modifier = Modifier.height(8.dp))
                                LinearProgressIndicator(
                                    progress = { progress },
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // Show error snackbar
    uiState.error?.let { error ->
        LaunchedEffect(error) {
            // Show snackbar
        }
    }

    // Show success and navigate back
    LaunchedEffect(uiState.uploadSuccess) {
        if (uiState.uploadSuccess) {
            onNavigateBack()
        }
    }
}

@Composable
fun UploadOptionCard(
    option: UploadOption,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = option.color.copy(alpha = 0.12f)
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(option.color),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = option.icon,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(28.dp)
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = option.title,
                style = MaterialTheme.typography.titleSmall,
                color = CareLogColors.OnSurface
            )

            Text(
                text = option.subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = CareLogColors.OnSurfaceVariant
            )
        }
    }
}

enum class UploadOptionType {
    PRESCRIPTION,
    WOUND_PHOTO,
    MEDICAL_PHOTO,
    VOICE_NOTE,
    VIDEO_NOTE,
    GALLERY
}

data class UploadOption(
    val type: UploadOptionType,
    val title: String,
    val subtitle: String,
    val icon: ImageVector,
    val color: Color
)

private val uploadOptions = listOf(
    UploadOption(
        type = UploadOptionType.PRESCRIPTION,
        title = "Prescription",
        subtitle = "Scan or upload",
        icon = Icons.Default.Description,
        color = CareLogColors.Primary
    ),
    UploadOption(
        type = UploadOptionType.WOUND_PHOTO,
        title = "Wound Photo",
        subtitle = "Take photo",
        icon = Icons.Default.CameraAlt,
        color = CareLogColors.Error
    ),
    UploadOption(
        type = UploadOptionType.MEDICAL_PHOTO,
        title = "Medical Photo",
        subtitle = "Urine, stool, etc.",
        icon = Icons.Default.Photo,
        color = CareLogColors.Warning
    ),
    UploadOption(
        type = UploadOptionType.VOICE_NOTE,
        title = "Voice Note",
        subtitle = "Record audio",
        icon = Icons.Default.Mic,
        color = CareLogColors.Glucose
    ),
    UploadOption(
        type = UploadOptionType.VIDEO_NOTE,
        title = "Video Note",
        subtitle = "Record video",
        icon = Icons.Default.Videocam,
        color = CareLogColors.SpO2
    ),
    UploadOption(
        type = UploadOptionType.GALLERY,
        title = "From Gallery",
        subtitle = "Choose existing",
        icon = Icons.Default.PhotoLibrary,
        color = CareLogColors.Weight
    )
)

package com.carelog.ui.upload

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.upload.FileType
import com.carelog.upload.UploadResult
import com.carelog.upload.UploadService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for upload screen.
 */
@HiltViewModel
class UploadViewModel @Inject constructor(
    private val uploadService: UploadService
) : ViewModel() {

    private val _uiState = MutableStateFlow(UploadUiState())
    val uiState: StateFlow<UploadUiState> = _uiState.asStateFlow()

    fun setSelectedFileType(type: FileType) {
        _uiState.update { it.copy(selectedFileType = type) }
    }

    fun uploadDocument(context: Context, uri: Uri) {
        viewModelScope.launch {
            _uiState.update { it.copy(isUploading = true, error = null) }

            val contentType = context.contentResolver.getType(uri) ?: "application/pdf"

            val result = uploadService.uploadFile(
                uri = uri,
                fileType = FileType.PRESCRIPTION,
                contentType = contentType,
                description = "Prescription"
            ) { progress ->
                _uiState.update { it.copy(uploadProgress = progress) }
            }

            when (result) {
                is UploadResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isUploading = false,
                            uploadSuccess = true,
                            uploadProgress = null
                        )
                    }
                }
                is UploadResult.Error -> {
                    _uiState.update {
                        it.copy(
                            isUploading = false,
                            error = result.message,
                            uploadProgress = null
                        )
                    }
                }
            }
        }
    }

    fun uploadImage(context: Context, uri: Uri, fileType: FileType) {
        viewModelScope.launch {
            _uiState.update { it.copy(isUploading = true, error = null) }

            val contentType = context.contentResolver.getType(uri) ?: "image/jpeg"

            val result = uploadService.uploadFile(
                uri = uri,
                fileType = fileType,
                contentType = contentType,
                description = fileType.displayName
            ) { progress ->
                _uiState.update { it.copy(uploadProgress = progress) }
            }

            when (result) {
                is UploadResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isUploading = false,
                            uploadSuccess = true,
                            uploadProgress = null
                        )
                    }
                }
                is UploadResult.Error -> {
                    _uiState.update {
                        it.copy(
                            isUploading = false,
                            error = result.message,
                            uploadProgress = null
                        )
                    }
                }
            }
        }
    }

    fun uploadAudio(uri: Uri) {
        viewModelScope.launch {
            _uiState.update { it.copy(isUploading = true, error = null) }

            val result = uploadService.uploadFile(
                uri = uri,
                fileType = FileType.VOICE_NOTE,
                contentType = "audio/mp4",
                description = "Voice Note"
            ) { progress ->
                _uiState.update { it.copy(uploadProgress = progress) }
            }

            when (result) {
                is UploadResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isUploading = false,
                            uploadSuccess = true,
                            uploadProgress = null
                        )
                    }
                }
                is UploadResult.Error -> {
                    _uiState.update {
                        it.copy(
                            isUploading = false,
                            error = result.message,
                            uploadProgress = null
                        )
                    }
                }
            }
        }
    }

    fun uploadVideo(uri: Uri) {
        viewModelScope.launch {
            _uiState.update { it.copy(isUploading = true, error = null) }

            val result = uploadService.uploadFile(
                uri = uri,
                fileType = FileType.VIDEO_NOTE,
                contentType = "video/mp4",
                description = "Video Note"
            ) { progress ->
                _uiState.update { it.copy(uploadProgress = progress) }
            }

            when (result) {
                is UploadResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isUploading = false,
                            uploadSuccess = true,
                            uploadProgress = null
                        )
                    }
                }
                is UploadResult.Error -> {
                    _uiState.update {
                        it.copy(
                            isUploading = false,
                            error = result.message,
                            uploadProgress = null
                        )
                    }
                }
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun resetUploadSuccess() {
        _uiState.update { it.copy(uploadSuccess = false) }
    }
}

/**
 * UI state for upload screen.
 */
data class UploadUiState(
    val selectedFileType: FileType = FileType.MEDICAL_PHOTO,
    val isUploading: Boolean = false,
    val uploadProgress: Float? = null,
    val uploadSuccess: Boolean = false,
    val error: String? = null
)

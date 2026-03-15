package com.carelog.ui.relative

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carelog.api.*
import com.carelog.auth.AuthRepository
import com.carelog.ui.theme.CareLogColors
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Threshold configuration screen for relatives to set vital thresholds.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThresholdConfigScreen(
    onNavigateBack: () -> Unit,
    viewModel: ThresholdConfigViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Threshold Settings") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                uiState.isLoading -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                uiState.error != null -> {
                    ErrorContent(
                        message = uiState.error!!,
                        onRetry = { viewModel.loadThresholds() },
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        item {
                            Text(
                                text = "Set threshold limits for vital readings. When readings fall outside these limits, you'll receive an alert.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(bottom = 8.dp)
                            )
                        }

                        items(uiState.thresholds) { threshold ->
                            ThresholdCard(
                                threshold = threshold,
                                onUpdateThreshold = { min, max ->
                                    viewModel.updateThreshold(threshold.vitalType, min, max)
                                }
                            )
                        }
                    }
                }
            }

            // Success snackbar
            if (uiState.saveSuccess) {
                LaunchedEffect(Unit) {
                    kotlinx.coroutines.delay(2000)
                    viewModel.clearSuccess()
                }
            }
        }
    }

    // Show success message
    if (uiState.saveSuccess) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(bottom = 32.dp),
            contentAlignment = Alignment.BottomCenter
        ) {
            Surface(
                color = CareLogColors.Success,
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.padding(16.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Check,
                        contentDescription = null,
                        tint = Color.White
                    )
                    Text(
                        text = "Threshold saved successfully",
                        color = Color.White
                    )
                }
            }
        }
    }
}

@Composable
private fun ThresholdCard(
    threshold: VitalThreshold,
    onUpdateThreshold: (Double?, Double?) -> Unit
) {
    var minValue by remember(threshold) {
        mutableStateOf(threshold.minValue?.toString() ?: "")
    }
    var maxValue by remember(threshold) {
        mutableStateOf(threshold.maxValue?.toString() ?: "")
    }
    var isEditing by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(getVitalColor(threshold.vitalType).copy(alpha = 0.1f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = getVitalIcon(threshold.vitalType),
                            style = MaterialTheme.typography.titleMedium
                        )
                    }

                    Column {
                        Text(
                            text = threshold.vitalType.displayName,
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            text = threshold.unit,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                if (threshold.setByDoctor) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Lock,
                            contentDescription = "Set by doctor",
                            modifier = Modifier.size(16.dp),
                            tint = CareLogColors.Primary
                        )
                        Text(
                            text = "Doctor set",
                            style = MaterialTheme.typography.labelSmall,
                            color = CareLogColors.Primary
                        )
                    }
                }
            }

            // Threshold inputs
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                OutlinedTextField(
                    value = minValue,
                    onValueChange = {
                        minValue = it
                        isEditing = true
                    },
                    label = { Text("Min") },
                    enabled = !threshold.setByDoctor,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = CareLogColors.Warning,
                        focusedLabelColor = CareLogColors.Warning
                    )
                )

                OutlinedTextField(
                    value = maxValue,
                    onValueChange = {
                        maxValue = it
                        isEditing = true
                    },
                    label = { Text("Max") },
                    enabled = !threshold.setByDoctor,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = CareLogColors.Error,
                        focusedLabelColor = CareLogColors.Error
                    )
                )
            }

            // Save button
            if (isEditing && !threshold.setByDoctor) {
                Button(
                    onClick = {
                        val min = minValue.toDoubleOrNull()
                        val max = maxValue.toDoubleOrNull()
                        onUpdateThreshold(min, max)
                        isEditing = false
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = CareLogColors.Primary
                    )
                ) {
                    Text("Save Changes")
                }
            }

            // Doctor override notice
            if (threshold.setByDoctor) {
                Surface(
                    color = CareLogColors.Primary.copy(alpha = 0.1f),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        text = "This threshold was set by a doctor and cannot be modified.",
                        style = MaterialTheme.typography.bodySmall,
                        color = CareLogColors.Primary,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun ErrorContent(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.error
        )
        Button(onClick = onRetry) {
            Text("Retry")
        }
    }
}

private fun getVitalColor(vitalType: VitalType): Color {
    return when (vitalType) {
        VitalType.BLOOD_PRESSURE -> CareLogColors.BloodPressure
        VitalType.GLUCOSE -> CareLogColors.Glucose
        VitalType.TEMPERATURE -> CareLogColors.Temperature
        VitalType.WEIGHT -> CareLogColors.Weight
        VitalType.PULSE -> CareLogColors.Pulse
        VitalType.SPO2 -> CareLogColors.SpO2
    }
}

private fun getVitalIcon(vitalType: VitalType): String {
    return when (vitalType) {
        VitalType.BLOOD_PRESSURE -> "❤️"
        VitalType.GLUCOSE -> "🩸"
        VitalType.TEMPERATURE -> "🌡️"
        VitalType.WEIGHT -> "⚖️"
        VitalType.PULSE -> "💓"
        VitalType.SPO2 -> "🫁"
    }
}

/**
 * ViewModel for threshold configuration.
 */
@HiltViewModel
class ThresholdConfigViewModel @Inject constructor(
    private val apiService: RelativeApiService,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ThresholdConfigUiState())
    val uiState: StateFlow<ThresholdConfigUiState> = _uiState.asStateFlow()

    init {
        loadThresholds()
    }

    fun loadThresholds() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                val user = authRepository.currentUser.value
                val patientId = user?.linkedPatientId ?: return@launch

                val thresholds = apiService.getThresholds(patientId)

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        thresholds = thresholds,
                        patientId = patientId
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isLoading = false, error = e.message ?: "Failed to load thresholds")
                }
            }
        }
    }

    fun updateThreshold(vitalType: VitalType, minValue: Double?, maxValue: Double?) {
        viewModelScope.launch {
            val patientId = _uiState.value.patientId ?: return@launch

            try {
                val success = apiService.updateThreshold(
                    patientId = patientId,
                    vitalType = vitalType,
                    minValue = minValue,
                    maxValue = maxValue
                )

                if (success) {
                    _uiState.update { it.copy(saveSuccess = true) }
                    loadThresholds() // Refresh data
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(error = e.message ?: "Failed to save threshold")
                }
            }
        }
    }

    fun clearSuccess() {
        _uiState.update { it.copy(saveSuccess = false) }
    }
}

/**
 * UI state for threshold configuration.
 */
data class ThresholdConfigUiState(
    val isLoading: Boolean = false,
    val thresholds: List<VitalThreshold> = emptyList(),
    val patientId: String? = null,
    val saveSuccess: Boolean = false,
    val error: String? = null
)

package com.carelog.ui.sync

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.carelog.ui.theme.CareLogColors

/**
 * Sync status indicator for dashboard.
 *
 * Shows: "All synced" / "X pending" / "Sync error"
 * Tap for details or manual sync trigger.
 */
@Composable
fun SyncStatusIndicator(
    viewModel: SyncStatusViewModel = hiltViewModel(),
    onTap: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()

    val (icon, color, text) = when (uiState.status) {
        SyncState.SYNCED -> Triple(Icons.Default.CloudDone, CareLogColors.Success, "All synced")
        SyncState.SYNCING -> Triple(Icons.Default.Sync, CareLogColors.Info, "Syncing...")
        SyncState.PENDING -> Triple(
            Icons.Default.CloudUpload,
            CareLogColors.Warning,
            "${uiState.pendingCount} pending"
        )
        SyncState.ERROR -> Triple(Icons.Default.CloudOff, CareLogColors.Error, "Sync error")
        SyncState.OFFLINE -> Triple(Icons.Default.WifiOff, CareLogColors.OnSurfaceVariant, "Offline")
    }

    // Rotation animation for syncing state
    val infiniteTransition = rememberInfiniteTransition(label = "sync_rotation")
    val rotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "rotation"
    )

    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onTap)
            .background(color.copy(alpha = 0.1f))
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = color,
            modifier = Modifier
                .size(18.dp)
                .then(
                    if (uiState.status == SyncState.SYNCING) {
                        Modifier.rotate(rotation)
                    } else {
                        Modifier
                    }
                )
        )

        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = color
        )
    }
}

/**
 * Sync status detail screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncStatusDetailScreen(
    onNavigateBack: () -> Unit,
    viewModel: SyncStatusViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Sync Status") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Status card
            Card(
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        val (icon, color) = when (uiState.status) {
                            SyncState.SYNCED -> Icons.Default.CloudDone to CareLogColors.Success
                            SyncState.SYNCING -> Icons.Default.Sync to CareLogColors.Info
                            SyncState.PENDING -> Icons.Default.CloudUpload to CareLogColors.Warning
                            SyncState.ERROR -> Icons.Default.CloudOff to CareLogColors.Error
                            SyncState.OFFLINE -> Icons.Default.WifiOff to CareLogColors.OnSurfaceVariant
                        }

                        Icon(
                            imageVector = icon,
                            contentDescription = null,
                            tint = color,
                            modifier = Modifier.size(32.dp)
                        )

                        Column {
                            Text(
                                text = uiState.status.displayName,
                                style = MaterialTheme.typography.titleMedium
                            )
                            uiState.lastSyncTime?.let {
                                Text(
                                    text = "Last sync: $it",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = CareLogColors.OnSurfaceVariant
                                )
                            }
                        }
                    }

                    if (uiState.pendingCount > 0) {
                        Divider()
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Pending observations")
                            Text(
                                text = "${uiState.pendingObservations}",
                                color = CareLogColors.Warning
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Pending documents")
                            Text(
                                text = "${uiState.pendingDocuments}",
                                color = CareLogColors.Warning
                            )
                        }
                    }

                    if (uiState.failedCount > 0) {
                        Divider()
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Failed items")
                            Text(
                                text = "${uiState.failedCount}",
                                color = CareLogColors.Error
                            )
                        }
                    }
                }
            }

            // Manual sync button
            Button(
                onClick = { viewModel.triggerManualSync() },
                modifier = Modifier.fillMaxWidth(),
                enabled = uiState.status != SyncState.SYNCING && uiState.status != SyncState.OFFLINE
            ) {
                Icon(Icons.Default.Sync, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Sync Now")
            }

            // Network status
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Icon(
                        imageVector = if (uiState.isWifi) Icons.Default.Wifi else Icons.Default.SignalCellularAlt,
                        contentDescription = null,
                        tint = if (uiState.isConnected) CareLogColors.Success else CareLogColors.OnSurfaceVariant
                    )
                    Column {
                        Text(
                            text = when {
                                uiState.isWifi -> "Connected via WiFi"
                                uiState.isConnected -> "Connected via mobile data"
                                else -> "No connection"
                            },
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Text(
                            text = if (uiState.isWifi) "Sync enabled" else "WiFi required for sync",
                            style = MaterialTheme.typography.bodySmall,
                            color = CareLogColors.OnSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

enum class SyncState(val displayName: String) {
    SYNCED("All Synced"),
    SYNCING("Syncing"),
    PENDING("Pending Sync"),
    ERROR("Sync Error"),
    OFFLINE("Offline")
}

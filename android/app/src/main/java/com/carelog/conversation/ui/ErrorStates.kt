package com.carelog.conversation.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Error card shown when the device cannot reach the CareLog Mac Mini.
 *
 * Displays a WiFi-off icon with instructions to check network connectivity.
 */
@Composable
fun NetworkErrorCard(
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    ErrorCard(
        icon = Icons.Filled.WifiOff,
        iconTint = Color(0xFFF44336),
        title = "Cannot reach CareLog device",
        message = "Check your WiFi connection and make sure the CareLog device is powered on and on the same network.",
        primaryAction = "Retry" to onRetry,
        secondaryAction = "Dismiss" to onDismiss,
        contentDesc = "Network error. Cannot reach CareLog device. Check your WiFi connection.",
        modifier = modifier
    )
}

/**
 * Error card shown when an unexpected session error occurs.
 *
 * Offers a retry action to restart the failed operation.
 */
@Composable
fun SessionErrorCard(
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    ErrorCard(
        icon = Icons.Filled.Error,
        iconTint = Color(0xFFF44336),
        title = "Something went wrong",
        message = "An unexpected error occurred during the conversation. Would you like to try again?",
        primaryAction = "Try Again" to onRetry,
        secondaryAction = "Dismiss" to onDismiss,
        contentDesc = "Session error. Something went wrong. You can try again.",
        modifier = modifier
    )
}

/**
 * Error card shown when data upload fails after a session.
 *
 * Reassures the user that readings were saved locally and will be retried.
 */
@Composable
fun UploadErrorCard(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    ErrorCard(
        icon = Icons.Filled.CloudOff,
        iconTint = Color(0xFFFFC107),
        title = "Upload pending",
        message = "Your readings were saved but we couldn't upload the recording. We'll retry automatically when the connection is restored.",
        primaryAction = null,
        secondaryAction = "OK" to onDismiss,
        contentDesc = "Upload pending. Your readings were saved locally and will be uploaded automatically.",
        modifier = modifier
    )
}

/**
 * Reusable error card with icon, title, message, and action buttons.
 */
@Composable
private fun ErrorCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    iconTint: Color,
    title: String,
    message: String,
    primaryAction: Pair<String, () -> Unit>?,
    secondaryAction: Pair<String, () -> Unit>?,
    contentDesc: String,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = contentDesc
                liveRegion = LiveRegionMode.Polite
            },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = iconTint,
                    modifier = Modifier.size(28.dp)
                )

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            if (primaryAction != null || secondaryAction != null) {
                Spacer(modifier = Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    secondaryAction?.let { (label, onClick) ->
                        TextButton(
                            onClick = onClick,
                            modifier = Modifier.height(48.dp)
                        ) {
                            Text(label)
                        }
                    }

                    if (primaryAction != null && secondaryAction != null) {
                        Spacer(modifier = Modifier.width(8.dp))
                    }

                    primaryAction?.let { (label, onClick) ->
                        Button(
                            onClick = onClick,
                            modifier = Modifier.height(48.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Refresh,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(label)
                        }
                    }
                }
            }
        }
    }
}

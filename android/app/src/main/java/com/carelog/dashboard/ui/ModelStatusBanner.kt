package com.carelog.dashboard.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.carelog.discovery.ModelHealthStatus
import com.carelog.discovery.OverallStatus

/**
 * Banner composable that displays the current Mac Mini health status.
 *
 * - Green: "All services ready"
 * - Yellow: Degraded with specific messages per service (TTS down, Vision down)
 * - Red: "CareLog device not found" or conversation service unavailable
 *
 * Uses Role.Alert semantics so screen readers announce status transitions.
 * Follows graceful degradation rules from spec Section 7.6.
 */
@Composable
fun ModelStatusBanner(
    healthStatus: ModelHealthStatus,
    modifier: Modifier = Modifier
) {
    val bannerConfig = getBannerConfig(healthStatus)

    val animatedColor by animateColorAsState(
        targetValue = bannerConfig.backgroundColor,
        label = "banner_color"
    )

    val fullDescription = buildString {
        append(bannerConfig.title)
        bannerConfig.subtitle?.let { append(". $it") }
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(animatedColor)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .semantics {
                role = Role.Button // Closest available for alert role
                contentDescription = fullDescription
                liveRegion = LiveRegionMode.Polite
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(
            imageVector = bannerConfig.icon,
            contentDescription = null, // Covered by row-level description
            tint = bannerConfig.contentColor,
            modifier = Modifier.size(24.dp)
        )

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = bannerConfig.title,
                style = MaterialTheme.typography.titleSmall,
                color = bannerConfig.contentColor
            )
            if (bannerConfig.subtitle != null) {
                Text(
                    text = bannerConfig.subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = bannerConfig.contentColor.copy(alpha = 0.8f)
                )
            }
        }
    }
}

/**
 * Determines the detailed degradation status for the conversation screen.
 *
 * Used by ConversationScreen to decide which features to enable/disable.
 */
data class DegradationState(
    /** Whether the conversation can be started. */
    val canConverse: Boolean,
    /** Whether TTS audio playback is available. */
    val ttsAvailable: Boolean,
    /** Whether vision/photo capture is available. */
    val visionAvailable: Boolean,
    /** Banner severity level. */
    val severity: DegradationSeverity,
    /** User-facing message for the current degradation state. */
    val message: String?
)

enum class DegradationSeverity {
    NONE,
    WARNING,
    ERROR
}

/**
 * Compute the degradation state from the current health status.
 *
 * Maps health status to app behavior per spec Section 7.6:
 * - All up: green, everything enabled
 * - LLM or STT down: red, conversation disabled
 * - TTS down: yellow, text-only mode
 * - Vision down: yellow, photo capture hidden
 * - All down: red, everything disabled
 */
fun computeDegradationState(status: ModelHealthStatus): DegradationState {
    return when (status.overallStatus) {
        OverallStatus.HEALTHY -> DegradationState(
            canConverse = true,
            ttsAvailable = true,
            visionAvailable = true,
            severity = DegradationSeverity.NONE,
            message = null
        )
        OverallStatus.DEGRADED -> {
            val canConverse = status.canStartConversation
            val ttsAvailable = status.isTtsUp
            val visionAvailable = status.isVisionUp

            val message = buildString {
                if (!canConverse) {
                    append("Conversation service unavailable")
                } else {
                    val parts = mutableListOf<String>()
                    if (!ttsAvailable) parts.add("Voice responses unavailable \u2014 text only mode")
                    if (!visionAvailable) parts.add("Photo reading unavailable")
                    append(parts.joinToString(". "))
                }
            }

            val severity = if (!canConverse) {
                DegradationSeverity.ERROR
            } else {
                DegradationSeverity.WARNING
            }

            DegradationState(
                canConverse = canConverse,
                ttsAvailable = ttsAvailable,
                visionAvailable = visionAvailable,
                severity = severity,
                message = message.takeIf { it.isNotBlank() }
            )
        }
        OverallStatus.OFFLINE -> DegradationState(
            // v2: Bedrock backs the conversation; the v1 Mac Mini LAN gate is
            // misleading and was blocking the patient conversation Button after
            // clearState. On-device TTS is independent of this poller.
            canConverse = true,
            ttsAvailable = false,
            visionAvailable = false,
            severity = DegradationSeverity.NONE,
            message = null
        )
    }
}

private data class BannerConfig(
    val backgroundColor: Color,
    val contentColor: Color,
    val icon: ImageVector,
    val title: String,
    val subtitle: String?
)

private fun getBannerConfig(status: ModelHealthStatus): BannerConfig {
    val degradation = computeDegradationState(status)

    return when (status.overallStatus) {
        OverallStatus.HEALTHY -> BannerConfig(
            backgroundColor = Color(0xFF1B5E20).copy(alpha = 0.15f),
            contentColor = Color(0xFF1B5E20),
            icon = Icons.Filled.CheckCircle,
            title = "All services ready",
            subtitle = null
        )
        OverallStatus.DEGRADED -> {
            val (bgColor, contentColor, icon) = if (degradation.severity == DegradationSeverity.ERROR) {
                Triple(
                    Color(0xFFB71C1C).copy(alpha = 0.15f),
                    Color(0xFFB71C1C),
                    Icons.Filled.Error
                )
            } else {
                Triple(
                    Color(0xFFF57F17).copy(alpha = 0.15f),
                    Color(0xFFF57F17),
                    Icons.Filled.Warning
                )
            }

            BannerConfig(
                backgroundColor = bgColor,
                contentColor = contentColor,
                icon = icon,
                title = if (degradation.severity == DegradationSeverity.ERROR) {
                    "Service unavailable"
                } else {
                    "Some services unavailable"
                },
                subtitle = degradation.message
            )
        }
        OverallStatus.OFFLINE -> BannerConfig(
            backgroundColor = Color(0xFFB71C1C).copy(alpha = 0.15f),
            contentColor = Color(0xFFB71C1C),
            icon = Icons.Filled.Error,
            title = "CareLog device not found",
            subtitle = "Check that it's powered on and on the same WiFi"
        )
    }
}

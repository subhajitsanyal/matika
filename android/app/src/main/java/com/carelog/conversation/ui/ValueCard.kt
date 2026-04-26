package com.carelog.conversation.ui

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.carelog.conversation.session.ConfirmedValue
import com.carelog.conversation.session.ExtractedValue

/**
 * Card displaying a confirmed clinical value.
 *
 * Green border with checkmark indicating the value has been
 * confirmed by the patient during the conversation.
 *
 * Accessibility: announces "Confirmed: [parameter] [value] [unit]"
 * to screen readers with LiveRegion for new confirmations.
 */
@Composable
fun ConfirmedValueCard(
    value: ConfirmedValue,
    modifier: Modifier = Modifier
) {
    val greenColor = Color(0xFF4CAF50)
    val formattedValue = formatValue(value.value)
    val cardDescription = "Confirmed: ${value.parameter} $formattedValue ${value.unit}"

    Card(
        modifier = modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = cardDescription
                liveRegion = LiveRegionMode.Polite
            },
        border = BorderStroke(2.dp, greenColor),
        colors = CardDefaults.cardColors(
            containerColor = greenColor.copy(alpha = 0.05f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Filled.CheckCircle,
                contentDescription = null, // Covered by card-level description
                tint = greenColor,
                modifier = Modifier.size(24.dp)
            )

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = value.parameter,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        text = formattedValue,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = value.unit,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

/**
 * Card displaying a pending (unconfirmed) extracted value.
 *
 * Yellow border with hourglass icon indicating the value is
 * awaiting patient confirmation.
 *
 * Accessibility: announces "Pending confirmation: [parameter] [value] [unit]"
 * to screen readers.
 */
@Composable
fun PendingValueCard(
    value: ExtractedValue,
    modifier: Modifier = Modifier
) {
    val yellowColor = Color(0xFFFFC107)
    val formattedValue = formatValue(value.value)
    val cardDescription = "Pending confirmation: ${value.parameter} $formattedValue ${value.unit}"

    Card(
        modifier = modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = cardDescription
                liveRegion = LiveRegionMode.Polite
            },
        border = BorderStroke(2.dp, yellowColor),
        colors = CardDefaults.cardColors(
            containerColor = yellowColor.copy(alpha = 0.05f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Filled.HourglassTop,
                contentDescription = null, // Covered by card-level description
                tint = yellowColor,
                modifier = Modifier.size(24.dp)
            )

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = value.parameter,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        text = formattedValue,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = value.unit,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = "Awaiting confirmation",
                    style = MaterialTheme.typography.labelSmall,
                    color = yellowColor
                )
            }
        }
    }
}

/**
 * Horizontal row of value cards (confirmed + pending) for display
 * in the conversation screen.
 */
@Composable
fun ValueCardsSection(
    confirmedValues: List<ConfirmedValue>,
    pendingValues: List<ExtractedValue>,
    modifier: Modifier = Modifier
) {
    if (confirmedValues.isEmpty() && pendingValues.isEmpty()) return

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .semantics {
                contentDescription = "Extracted values: ${confirmedValues.size} confirmed, ${pendingValues.size} pending"
            },
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Pending values first (more attention needed)
        pendingValues.forEach { value ->
            PendingValueCard(value = value)
        }

        // Confirmed values
        confirmedValues.forEach { value ->
            ConfirmedValueCard(value = value)
        }
    }
}

/**
 * Format a numeric value, removing trailing zeros for clean display.
 */
private fun formatValue(value: Double): String {
    return if (value == value.toLong().toDouble()) {
        value.toLong().toString()
    } else {
        "%.1f".format(value)
    }
}

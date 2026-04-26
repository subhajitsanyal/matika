package com.carelog.conversation.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.carelog.conversation.session.ConversationTurn

/**
 * Scrollable transcript view showing conversation turns as chat bubbles.
 *
 * - Patient utterances appear on the right (primary color).
 * - System responses appear on the left (surface variant).
 * - Auto-scrolls to the latest turn.
 * - Announces new messages via LiveRegion for TalkBack accessibility.
 * - Uses list semantics for screen reader navigation.
 */
@Composable
fun TranscriptView(
    turns: List<ConversationTurn>,
    currentTranscript: String,
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()

    // Auto-scroll to latest turn
    LaunchedEffect(turns.size, currentTranscript) {
        if (turns.isNotEmpty()) {
            // Scroll to the last item (or beyond for live transcript)
            val targetIndex = if (currentTranscript.isNotEmpty()) {
                turns.size // Account for the live transcript item
            } else {
                turns.size - 1
            }
            listState.animateScrollToItem(targetIndex.coerceAtLeast(0))
        }
    }

    LazyColumn(
        state = listState,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp)
            .semantics {
                role = Role.Image // Closest available; list semantics
                contentDescription = "Conversation transcript, ${turns.size} messages"
            },
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(turns, key = { it.turnNumber }) { turn ->
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // Patient bubble (right-aligned)
                if (turn.patientText.isNotBlank()) {
                    ChatBubble(
                        text = turn.patientText,
                        isPatient = true,
                        // Only announce the latest message
                        announceAsNew = turn.turnNumber == turns.lastOrNull()?.turnNumber
                    )
                }

                // System bubble (left-aligned)
                if (turn.systemText.isNotBlank()) {
                    ChatBubble(
                        text = turn.systemText,
                        isPatient = false,
                        announceAsNew = turn.turnNumber == turns.lastOrNull()?.turnNumber
                    )
                }
            }
        }

        // Live transcript (partial STT result)
        if (currentTranscript.isNotBlank()) {
            item(key = "live_transcript") {
                ChatBubble(
                    text = currentTranscript,
                    isPatient = true,
                    isLive = true,
                    announceAsNew = false
                )
            }
        }
    }
}

/**
 * A single chat bubble. Patient messages are right-aligned with primary
 * color; system messages are left-aligned with surface variant.
 *
 * Includes contentDescription for screen readers with role and text,
 * and LiveRegion announcements for new messages.
 */
@Composable
private fun ChatBubble(
    text: String,
    isPatient: Boolean,
    isLive: Boolean = false,
    announceAsNew: Boolean = false,
    modifier: Modifier = Modifier
) {
    val roleLabel = if (isPatient) "You" else "CareLog"
    val liveLabel = if (isLive) " (listening)" else ""
    val bubbleDescription = "$roleLabel said: $text$liveLabel"

    Row(
        modifier = modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = bubbleDescription
                if (announceAsNew) {
                    liveRegion = LiveRegionMode.Polite
                }
            },
        horizontalArrangement = if (isPatient) Arrangement.End else Arrangement.Start
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .clip(
                    RoundedCornerShape(
                        topStart = 16.dp,
                        topEnd = 16.dp,
                        bottomStart = if (isPatient) 16.dp else 4.dp,
                        bottomEnd = if (isPatient) 4.dp else 16.dp
                    )
                )
                .background(
                    if (isPatient) {
                        if (isLive) {
                            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
                        } else {
                            MaterialTheme.colorScheme.primaryContainer
                        }
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant
                    }
                )
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            Column {
                Text(
                    text = text,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isPatient) {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
                if (isLive) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "Listening...",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.6f)
                    )
                }
            }
        }
    }
}

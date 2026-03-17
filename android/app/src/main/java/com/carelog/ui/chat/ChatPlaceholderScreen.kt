package com.carelog.ui.chat

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.carelog.ui.theme.CareLogColors

/**
 * LLM Chat placeholder screen.
 *
 * Simple "Coming Soon" screen with illustration.
 * No functionality in v1.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatPlaceholderScreen(
    onNavigateBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Health Chat") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CareLogColors.Chat,
                    titleContentColor = androidx.compose.ui.graphics.Color.White,
                    navigationIconContentColor = androidx.compose.ui.graphics.Color.White
                )
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(MaterialTheme.colorScheme.surface),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(32.dp)
            ) {
                // Chat icon
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Chat,
                    contentDescription = null,
                    modifier = Modifier.size(120.dp),
                    tint = CareLogColors.Chat.copy(alpha = 0.6f)
                )

                Spacer(modifier = Modifier.height(32.dp))

                // Coming Soon text
                Text(
                    text = "Coming Soon",
                    style = MaterialTheme.typography.headlineMedium,
                    color = CareLogColors.OnSurface
                )

                Spacer(modifier = Modifier.height(16.dp))

                // Description
                Text(
                    text = "Ask questions about your health data and get insights from our AI assistant.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = CareLogColors.OnSurfaceVariant,
                    textAlign = TextAlign.Center
                )

                Spacer(modifier = Modifier.height(32.dp))

                // Feature list
                Column(
                    horizontalAlignment = Alignment.Start,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    FeatureItem("Understand your vital trends")
                    FeatureItem("Get health tips and reminders")
                    FeatureItem("Ask questions about readings")
                }
            }
        }
    }
}

@Composable
private fun FeatureItem(text: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.AutoMirrored.Filled.Chat,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = CareLogColors.Chat
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = CareLogColors.OnSurface
        )
    }
}

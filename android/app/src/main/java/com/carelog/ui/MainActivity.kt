package com.carelog.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import com.carelog.ui.theme.CareLogTheme
import dagger.hilt.android.AndroidEntryPoint

/**
 * Main entry point for the CareLog Android application.
 *
 * This activity hosts the Jetpack Compose navigation graph and serves
 * as the single activity for the entire app following single-activity architecture.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            CareLogTheme {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        // Maestro / UiAutomator address Compose elements
                        // through Android's `resource-id`. By default
                        // Modifier.testTag(...) is *not* exposed there —
                        // it lives only on the SemanticsNode. Setting
                        // testTagsAsResourceId at the root of the tree
                        // makes every downstream testTag visible to
                        // Maestro's `id:` selector. Without this, all
                        // testTagged Composables look invisible to UI
                        // tests.
                        .semantics { testTagsAsResourceId = true },
                    color = MaterialTheme.colorScheme.background
                ) {
                    CareLogNavHost()
                }
            }
        }
    }
}

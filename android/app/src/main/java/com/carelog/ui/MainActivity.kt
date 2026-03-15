package com.carelog.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            CareLogTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    // Navigation will be implemented in subsequent tasks
                    CareLogNavHost()
                }
            }
        }
    }
}

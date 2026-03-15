package com.carelog.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

// Primary Colors - Accessible, high contrast (WCAG AA compliant)
val Primary = Color(0xFF1565C0)
val PrimaryVariant = Color(0xFF0D47A1)
val OnPrimary = Color.White

// Secondary Colors
val Secondary = Color(0xFF00897B)
val SecondaryVariant = Color(0xFF00695C)
val OnSecondary = Color.White

// Background Colors
val Background = Color.White
val OnBackground = Color(0xFF1C1B1F)
val Surface = Color.White
val OnSurface = Color(0xFF1C1B1F)

// Error Colors
val Error = Color(0xFFB3261E)
val OnError = Color.White

// Status Colors for Vitals
val StatusNormal = Color(0xFF2E7D32)
val StatusWarning = Color(0xFFF57C00)
val StatusCritical = Color(0xFFC62828)

// Vital Type Colors
val VitalBP = Color(0xFFE53935)
val VitalGlucose = Color(0xFF8E24AA)
val VitalTemp = Color(0xFFFB8C00)
val VitalWeight = Color(0xFF43A047)
val VitalPulse = Color(0xFFD81B60)
val VitalSpO2 = Color(0xFF1E88E5)

private val LightColorScheme = lightColorScheme(
    primary = Primary,
    onPrimary = OnPrimary,
    primaryContainer = PrimaryVariant,
    secondary = Secondary,
    onSecondary = OnSecondary,
    secondaryContainer = SecondaryVariant,
    background = Background,
    onBackground = OnBackground,
    surface = Surface,
    onSurface = OnSurface,
    error = Error,
    onError = OnError
)

/**
 * CareLog application theme.
 *
 * Designed for accessibility with high contrast colors
 * meeting WCAG AA requirements (4.5:1 contrast ratio).
 */
@Composable
fun CareLogTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    // For v1, we only support light theme for accessibility
    // Dark theme can be added in future releases
    val colorScheme = LightColorScheme

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = PrimaryVariant.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}

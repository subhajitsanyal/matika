package com.carelog.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

/**
 * CareLog Color Palette - WCAG AA Compliant
 *
 * Primary colors chosen for high contrast and accessibility.
 * Minimum contrast ratio: 4.5:1 for normal text, 3:1 for large text.
 */
object CareLogColors {
    // Primary - Medical blue (trustworthy, calming)
    val Primary = Color(0xFF1565C0)
    val PrimaryDark = Color(0xFF0D47A1)
    val PrimaryLight = Color(0xFF42A5F5)
    val OnPrimary = Color.White

    // Secondary - Teal (health, vitality)
    val Secondary = Color(0xFF00897B)
    val SecondaryDark = Color(0xFF00695C)
    val SecondaryLight = Color(0xFF4DB6AC)
    val OnSecondary = Color.White

    // Background & Surface
    val Background = Color(0xFFF5F5F5)
    val Surface = Color.White
    val SurfaceVariant = Color(0xFFE8E8E8)

    // Text colors (high contrast)
    val OnBackground = Color(0xFF1A1A1A)
    val OnSurface = Color(0xFF1A1A1A)
    val OnSurfaceVariant = Color(0xFF5C5C5C)

    // Vital type colors (distinct, accessible)
    val BloodPressure = Color(0xFFE53935)      // Red
    val Glucose = Color(0xFF8E24AA)             // Purple
    val Temperature = Color(0xFFFF6F00)         // Orange
    val Weight = Color(0xFF43A047)              // Green
    val Pulse = Color(0xFFD81B60)               // Pink
    val SpO2 = Color(0xFF1E88E5)                // Blue
    val Upload = Color(0xFF546E7A)              // Blue-gray
    val Chat = Color(0xFF00ACC1)                // Cyan

    // Status colors
    val Success = Color(0xFF2E7D32)
    val Warning = Color(0xFFF57C00)
    val Error = Color(0xFFC62828)
    val Info = Color(0xFF1565C0)

    // Alert thresholds
    val Normal = Color(0xFF4CAF50)
    val Elevated = Color(0xFFFFC107)
    val Critical = Color(0xFFF44336)
}

/**
 * Typography scale for accessibility.
 * Large, readable fonts with clear hierarchy.
 */
val CareLogTypography = Typography(
    // Display - used for large numbers in vital input
    displayLarge = TextStyle(
        fontSize = 64.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 72.sp,
        letterSpacing = (-0.5).sp
    ),
    displayMedium = TextStyle(
        fontSize = 48.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 56.sp
    ),
    displaySmall = TextStyle(
        fontSize = 36.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 44.sp
    ),

    // Headlines - section titles
    headlineLarge = TextStyle(
        fontSize = 32.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 40.sp
    ),
    headlineMedium = TextStyle(
        fontSize = 28.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 36.sp
    ),
    headlineSmall = TextStyle(
        fontSize = 24.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 32.sp
    ),

    // Titles - card titles, button labels
    titleLarge = TextStyle(
        fontSize = 22.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 28.sp
    ),
    titleMedium = TextStyle(
        fontSize = 18.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 24.sp
    ),
    titleSmall = TextStyle(
        fontSize = 16.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 22.sp
    ),

    // Body - readable body text
    bodyLarge = TextStyle(
        fontSize = 18.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 26.sp
    ),
    bodyMedium = TextStyle(
        fontSize = 16.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 24.sp
    ),
    bodySmall = TextStyle(
        fontSize = 14.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 20.sp
    ),

    // Labels
    labelLarge = TextStyle(
        fontSize = 16.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 22.sp
    ),
    labelMedium = TextStyle(
        fontSize = 14.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 18.sp
    ),
    labelSmall = TextStyle(
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 16.sp
    )
)

private val LightColorScheme = lightColorScheme(
    primary = CareLogColors.Primary,
    onPrimary = CareLogColors.OnPrimary,
    primaryContainer = CareLogColors.PrimaryLight,
    onPrimaryContainer = CareLogColors.PrimaryDark,
    secondary = CareLogColors.Secondary,
    onSecondary = CareLogColors.OnSecondary,
    secondaryContainer = CareLogColors.SecondaryLight,
    onSecondaryContainer = CareLogColors.SecondaryDark,
    background = CareLogColors.Background,
    onBackground = CareLogColors.OnBackground,
    surface = CareLogColors.Surface,
    onSurface = CareLogColors.OnSurface,
    surfaceVariant = CareLogColors.SurfaceVariant,
    onSurfaceVariant = CareLogColors.OnSurfaceVariant,
    error = CareLogColors.Error,
    onError = Color.White
)

private val DarkColorScheme = darkColorScheme(
    primary = CareLogColors.PrimaryLight,
    onPrimary = CareLogColors.PrimaryDark,
    primaryContainer = CareLogColors.Primary,
    onPrimaryContainer = Color.White,
    secondary = CareLogColors.SecondaryLight,
    onSecondary = CareLogColors.SecondaryDark,
    secondaryContainer = CareLogColors.Secondary,
    onSecondaryContainer = Color.White,
    background = Color(0xFF121212),
    onBackground = Color.White,
    surface = Color(0xFF1E1E1E),
    onSurface = Color.White,
    surfaceVariant = Color(0xFF2C2C2C),
    onSurfaceVariant = Color(0xFFB0B0B0),
    error = Color(0xFFCF6679),
    onError = Color.Black
)

@Composable
fun CareLogTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.primary.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = CareLogTypography,
        content = content
    )
}

package ai.nuphos.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val LightScheme = lightColorScheme(
    primary = BrandLight,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE9DDFF),
    onPrimaryContainer = Color(0xFF25005A),
    secondary = Color(0xFF625B71),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE8DEF8),
    onSecondaryContainer = Color(0xFF1E192B),
    tertiary = Color(0xFFB45309),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFFE0B2),
    onTertiaryContainer = Color(0xFF3E1F00),
    error = Color(0xFFBA1A1A),
    onError = Color.White,
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
    background = CanvasLight,
    onBackground = Color(0xFF18181B),
    surface = SurfaceLight,
    onSurface = Color(0xFF18181B),
    surfaceVariant = Color(0xFFE7E0EC),
    onSurfaceVariant = Color(0xFF52525B),
    outline = Color(0xFF84848C),
    outlineVariant = Color(0xFFCAC4D0),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFF7F2FA),
    surfaceContainer = Color(0xFFF1ECF4),
    surfaceContainerHigh = Color(0xFFEBE6EE),
    surfaceContainerHighest = Color(0xFFE6E0E9),
    inverseSurface = Color(0xFF313033),
    inverseOnSurface = Color(0xFFF4EFF4),
    inversePrimary = BrandDark,
)

private val DarkScheme = darkColorScheme(
    primary = BrandDark,
    onPrimary = Color(0xFF3B0091),
    primaryContainer = Color(0xFF5600C9),
    onPrimaryContainer = Color(0xFFE9DDFF),
    secondary = Color(0xFFCBC2DB),
    onSecondary = Color(0xFF332D41),
    secondaryContainer = Color(0xFF4A4458),
    onSecondaryContainer = Color(0xFFE8DEF8),
    tertiary = Color(0xFFFFB74D),
    onTertiary = Color(0xFF4A2800),
    tertiaryContainer = Color(0xFF6B3C00),
    onTertiaryContainer = Color(0xFFFFE0B2),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    background = CanvasDark,
    onBackground = Color.White,
    surface = SurfaceDark,
    onSurface = Color.White,
    surfaceVariant = Color(0xFF49454E),
    onSurfaceVariant = Color(0xFFA1A1AA),
    outline = Color(0xFF71717A),
    outlineVariant = Color(0xFF49454E),
    surfaceContainerLowest = Color(0xFF0F0F12),
    surfaceContainerLow = Color(0xFF1C1B1F),
    surfaceContainer = Color(0xFF201F23),
    surfaceContainerHigh = Color(0xFF2A2A2E),
    surfaceContainerHighest = Color(0xFF353439),
    inverseSurface = Color(0xFFE6E1E5),
    inverseOnSurface = Color(0xFF313033),
    inversePrimary = BrandLight,
)

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun NuphosTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkScheme
        else -> LightScheme
    }

    MaterialExpressiveTheme(
        colorScheme = colorScheme,
        motionScheme = MotionScheme.expressive(),
        typography = NuphosTypography,
        shapes = NuphosShapes,
        content = content,
    )
}

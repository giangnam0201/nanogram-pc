package app.nanogram.pc.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Purple500 = Color(0xFF7C83FF)
val Purple700 = Color(0xFF5A62E0)
val DarkBg = Color(0xFF1A1A2E)
val DarkSurface = Color(0xFF16213E)
val DarkBorder = Color(0xFF2A2A4A)
val TextLight = Color(0xFFE0E0E0)
val TextDim = Color(0xFF888888)
val Green = Color(0xFF4ADE80)
val Red = Color(0xFFFF6B6B)

private val DarkColors = darkColorScheme(
    primary = Purple500,
    secondary = Purple700,
    background = DarkBg,
    surface = DarkSurface,
    onPrimary = Color.White,
    onSecondary = Color.White,
    onBackground = TextLight,
    onSurface = TextLight,
    outline = DarkBorder,
    error = Red
)

@Composable
fun NanogramTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColors,
        typography = Typography(),
        content = content
    )
}

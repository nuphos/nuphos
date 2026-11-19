package ai.nuphos.android.ui.theme

import androidx.compose.ui.graphics.Color

val BrandLight = Color(0xFF7D36EC)
val BrandDark = Color(0xFF8B4DFF)
val BrandTextLight = Color(0xFF6D28D9)
val BrandTextDark = Color(0xFFA469FF)
val Violet500 = Color(0xFF6300FF)
val Violet700 = Color(0xFF3E14A2)
val CanvasLight = Color(0xFFF7F7F7)
val CanvasDark = Color(0xFF141414)
val SurfaceLight = Color(0xFFFFFFFF)
val SurfaceDark = Color(0xFF202024)
val BubbleLight = Color(0xFFE9E9EC)
val BubbleDark = Color(0xFF2A2A2E)

/**
 * The tints a Bot's character may sit on (`avatar.*` in packages/design-tokens). The characters are
 * drawn for light discs, so the tints stay light in the dark theme.
 */
private val AvatarBackgrounds = mapOf(
    "sand" to Color(0xFFF2E7D3), "peach" to Color(0xFFF8DCCB), "rose" to Color(0xFFF6D5DE), "lilac" to Color(0xFFE5DCF5),
    "sky" to Color(0xFFD6E6F7), "mint" to Color(0xFFD3EEDF), "sage" to Color(0xFFE1E9D1), "slate" to Color(0xFFE1E4EA),
)

/** The color a Bot's picked background paints; null for none or a tint this build doesn't know. */
fun avatarBackground(name: String?): Color? = name?.let { AvatarBackgrounds[it] }

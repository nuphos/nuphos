package ai.nuphos.android

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.ui.components.NuphosAvatar
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class AvatarInitialsFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    @Test fun bothInitialsFitTheFixedProfileAvatarAtLargeFontScale() {
        val scale = mutableStateOf(1f)
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, scale.value)) {
                NuphosTheme {
                    NuphosAvatar(NuphosUser("avatar-fixture", "avatar@example.invalid", "Preview Workspace"), size = 28.dp)
                }
            }
        }
        for (fontScale in listOf(1f, 2f)) {
            compose.runOnIdle { scale.value = fontScale }
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText("PW").performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            val layout = layouts.single()
            assertEquals("Initials must not wrap inside the avatar at font scale $fontScale", 1, layout.lineCount)
            assertEquals("Both initials must remain in the first line at font scale $fontScale", 2, layout.getLineEnd(0))
            assertTrue("Initials must fit the avatar width at font scale $fontScale", layout.getLineRight(0) <= layout.layoutInput.constraints.maxWidth)
            assertTrue("Initials must fit the avatar height at font scale $fontScale", layout.multiParagraph.height <= layout.layoutInput.constraints.maxHeight)
        }
    }
}

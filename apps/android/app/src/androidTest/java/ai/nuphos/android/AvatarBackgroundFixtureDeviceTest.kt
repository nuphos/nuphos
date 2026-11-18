package ai.nuphos.android

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.model.BotFaces
import ai.nuphos.android.ui.components.AgentAvatar
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/** A Bot's picked background is a disc in its tint behind the character; None looks as before (#3515). */
@RunWith(AndroidJUnit4::class)
class AvatarBackgroundFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val tinted = "synthetic-tinted-bot"
    private val plain = "synthetic-plain-bot"
    @After fun forget() { BotFaces.learn(tinted, null); BotFaces.learn(plain, null) }

    @Test fun aTintedBotSitsOnItsDiscInBothThemesAndNoneDoesNot() {
        BotFaces.learn(tinted, "07-ada", "sky")
        BotFaces.learn(plain, "07-ada")
        var dark by mutableStateOf(false)
        compose.setContent {
            NuphosTheme(darkTheme = dark) { Surface(Modifier.fillMaxSize()) {
                Row(Modifier.padding(24.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                    for (size in listOf(16.dp, 36.dp)) {
                        Box(Modifier.testTag("tinted-$size")) { AgentAvatar(tinted, "codex", size) }
                        Box(Modifier.testTag("plain-$size")) { AgentAvatar(plain, "codex", size) }
                    }
                }
            } }
        }
        for (theme in listOf(false, true)) {
            dark = theme
            compose.waitForIdle()
            for (size in listOf(16.dp, 36.dp)) {
                val withTint = skyPixels("tinted-$size")
                assertTrue("dark=$theme $size: $withTint sky pixels behind a tinted Bot", withTint > 6)
                assertEquals("dark=$theme $size: None paints no disc", 0, skyPixels("plain-$size"))
            }
        }
    }

    /** Pixels of the Sky token (#D6E6F7), the same in both themes. */
    private fun skyPixels(tag: String): Int {
        val pixels = compose.onNodeWithTag(tag).captureToImage().toPixelMap()
        var count = 0
        for (x in 0 until pixels.width) for (y in 0 until pixels.height) {
            val c = pixels[x, y]
            if (abs(c.red * 255 - 0xD6) <= 3 && abs(c.green * 255 - 0xE6) <= 3 && abs(c.blue * 255 - 0xF7) <= 3) count++
        }
        return count
    }
}

package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.BotFaces
import ai.nuphos.android.ui.components.AgentAvatar
import ai.nuphos.android.ui.theme.NuphosTheme
import coil3.annotation.ExperimentalCoilApi
import coil3.asImage
import coil3.compose.AsyncImagePainter
import coil3.compose.AsyncImagePreviewHandler
import coil3.compose.LocalAsyncImagePreviewHandler
import coil3.compose.asPainter
import coil3.request.ErrorResult
import coil3.request.SuccessResult
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.abs

/**
 * A Bot whose avatar is a photo its owner uploaded shows that photo in a circle; until it loads,
 * or if it fails, the derived face. An untrusted URL and a catalog face look as before (#2825).
 * Coil's preview handler answers the photo requests, so no network is used.
 */
@OptIn(ExperimentalCoilApi::class)
@RunWith(AndroidJUnit4::class)
class BotPhotoAvatarFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val photo = "https://lh3.googleusercontent.com/a/synthetic-photo"
    private val broken = "https://lh3.googleusercontent.com/a/synthetic-broken"
    private val pending = "https://lh3.googleusercontent.com/a/synthetic-pending"
    private val bots = mapOf(
        "photo" to photo,
        "broken" to broken,
        "pending" to pending,
        "untrusted" to "https://example.com/avatars/synthetic.png",
        "catalog" to "07-ada",
    )
    private val sessionId = { name: String -> "synthetic-$name-bot" }

    @After fun forget() { bots.keys.forEach { BotFaces.learn(sessionId(it), null) } }

    @Test fun aTrustedPhotoShowsInACircleAndEverythingElseKeepsItsFace() {
        bots.forEach { (name, avatar) -> BotFaces.learn(sessionId(name), avatar) }
        val magenta = 0xFFE0457B.toInt()
        val handler = AsyncImagePreviewHandler { loader, request ->
            when (request.data) {
                photo -> {
                    val image = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888).apply { eraseColor(magenta) }.asImage()
                    AsyncImagePainter.State.Success(image.asPainter(request.context), SuccessResult(image, request))
                }
                broken -> AsyncImagePainter.State.Error(null, ErrorResult(null, request, IllegalStateException("synthetic")))
                pending -> AsyncImagePainter.State.Loading(null)
                else -> AsyncImagePreviewHandler.Default.handle(loader, request)
            }
        }
        compose.setContent {
            CompositionLocalProvider(LocalInspectionMode provides true, LocalAsyncImagePreviewHandler provides handler) {
                NuphosTheme(darkTheme = false) { Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                        for (name in bots.keys) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            Box(Modifier.testTag(name)) { AgentAvatar(sessionId(name), null, 64.dp) }
                            Text(name)
                        }
                    }
                } }
            }
        }
        compose.waitForIdle()

        // Only a trusted URL gets a photo node; the rest render exactly as before.
        for ((name, nodes) in mapOf("photo" to 1, "broken" to 1, "pending" to 1, "untrusted" to 0, "catalog" to 0)) {
            assertEquals("$name: photo nodes", nodes,
                compose.onAllNodes(hasTestTag("agent-photo-avatar") and hasAnyAncestor(hasTestTag(name))).fetchSemanticsNodes().size)
        }
        // The loaded photo fills a circle: its centre is the photo, its corner is not.
        val shown = compose.onNodeWithTag("photo").captureToImage().toPixelMap()
        assertTrue("The photo is not drawn", isMagenta(shown[shown.width / 2, shown.height / 2]))
        assertFalse("The photo is not clipped to a circle", isMagenta(shown[1, 1]))
        // A failed or unfinished photo draws nothing of itself, so the derived face shows.
        for (name in listOf("broken", "pending", "untrusted", "catalog")) {
            val pixels = compose.onNodeWithTag(name).captureToImage().toPixelMap()
            val drawn = (0 until pixels.width).sumOf { x -> (0 until pixels.height).count { y -> isMagenta(pixels[x, y]) } }
            assertEquals("$name shows photo pixels", 0, drawn)
        }
        capture("bot-photo-avatars")
    }

    /** #E0457B by its red and green channels, which no face or tint shares. */
    private fun isMagenta(c: Color) = abs(c.red * 255 - 0xE0) <= 3 && abs(c.green * 255 - 0x45) <= 3

    /** Saved to the additional test output, which CI uploads with the device test report. */
    private fun capture(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.externalMediaDirs.first(), "additional_test_output").apply { mkdirs() }
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "review-2825-$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}

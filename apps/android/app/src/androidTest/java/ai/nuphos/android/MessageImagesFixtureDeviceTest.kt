package ai.nuphos.android

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.Base64
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import ai.nuphos.android.ui.chat.MessageImages
import ai.nuphos.android.ui.chat.MessageImageDecoder
import ai.nuphos.android.ui.chat.MessageImagePager
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.ByteArrayOutputStream

/** Synthetic images only, no account, filesystem or network access. */
class MessageImagesFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private fun image(label: String, width: Int = 900, height: Int = 600): String {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).apply {
            drawColor(Color.rgb(30, 65, 110))
            val paint = Paint().apply { color = Color.WHITE; textSize = 50f }
            drawText("SYNTHETIC IMAGE $label", 30f, 90f, paint)
            paint.color = Color.CYAN
            drawRect(80f, 150f, width - 80f, height - 80f, paint)
        }
        val bytes = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        bitmap.recycle()
        return "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
    private fun screenshot(name: String) {
        compose.waitForIdle()
        android.os.SystemClock.sleep(400) // Wait for the platform dialog transition, outside Compose clock.
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        java.io.File(instrumentation.targetContext.cacheDir, "$name.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }
    private fun ready(index: Int = 1, count: Int = 5) {
        compose.waitUntil(5000) { compose.onAllNodesWithText("Loading image").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithText("$index / $count").assertIsDisplayed()
    }
    private fun page(index: Int, count: Int = 5) = compose.onNode(hasContentDescription("Image $index of $count") and SemanticsMatcher.keyIsDefined(SemanticsProperties.StateDescription))

    @Test fun thumbnailOpensAllImagesZoomPanResetSwipeAndClose() {
        val images = (1..5).map { image(it.toString()) }
        compose.setContent { NuphosTheme(darkTheme = false) { Column { MessageImages(images, "synthetic") } } }
        compose.onNodeWithContentDescription("Image 1 of 5").performClick()
        ready()
        screenshot("synthetic-image-fullscreen")
        page(1).performTouchInput { doubleClick() }
        page(1).assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "200 percent zoom"))
        screenshot("synthetic-image-zoom")
        page(1).performTouchInput { swipeLeft() }
        compose.onNodeWithText("1 / 5").assertIsDisplayed()
        compose.onNodeWithText("Reset zoom").performClick()
        page(1).assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "100 percent zoom"))
        page(1).performTouchInput { swipeLeft() }
        ready(2)
        compose.onNodeWithText("Previous image").performClick()
        ready(1)
        compose.onNodeWithText("Previous image").performClick()
        ready(5)
        screenshot("synthetic-image-fifth")
        compose.onNodeWithText("Next image").performClick()
        ready(1)
        compose.onNodeWithText("Close").performClick()
        compose.onNodeWithText("1 / 5").assertDoesNotExist()
    }

    @Test fun pinchZoomAndSystemBack() {
        val visible = mutableStateOf(true)
        val images = listOf(image("PINCH"))
        compose.setContent { NuphosTheme {
            if (visible.value) MessageImagePager(images, 0, onDismiss = { visible.value = false })
            else Text("Viewer dismissed")
        } }
        ready(1, 1)
        page(1, 1).performTouchInput {
            pinch(androidx.compose.ui.geometry.Offset(centerX - 30, centerY), androidx.compose.ui.geometry.Offset(centerX + 30, centerY),
                androidx.compose.ui.geometry.Offset(centerX - 180, centerY), androidx.compose.ui.geometry.Offset(centerX + 180, centerY))
        }
        page(1, 1).assert(SemanticsMatcher("pinch enlarges image") {
            it.config.getOrNull(SemanticsProperties.StateDescription) != "100 percent zoom"
        })
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
        compose.onNodeWithText("Viewer dismissed").assertIsDisplayed()
    }

    @Test fun malformedUnsupportedAndEmptyImagesRemainDismissible() {
        compose.setContent { NuphosTheme { MessageImagePager(listOf("https://example.invalid/private.png"), 0, onDismiss = {}) } }
        compose.waitUntil(5000) { compose.onAllNodesWithText("Image unavailable").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Image unavailable").assertIsDisplayed()
        screenshot("synthetic-image-unavailable")
        compose.onNodeWithText("Close").assertHasClickAction()
    }

    @Test fun noImagesHasClearCloseAction() {
        compose.setContent { NuphosTheme { MessageImagePager(emptyList(), 0, onDismiss = {}) } }
        compose.onNodeWithText("No images").assertIsDisplayed()
        compose.onNodeWithText("Close").assertHasClickAction()
    }

    @Test fun selectedPageSurvivesSavedStateRestoreInDarkTheme() {
        val restoration = StateRestorationTester(compose)
        val images = (1..5).map { image(it.toString()) }
        restoration.setContent { NuphosTheme(darkTheme = true) { Column { MessageImages(images, "restore") } } }
        compose.onNodeWithContentDescription("Image 3 of 5").performClick()
        ready(3)
        restoration.emulateSavedInstanceStateRestore()
        ready(3)
        screenshot("synthetic-image-dark-restored")
        compose.onNodeWithText("Next image").performClick()
        ready(4)
        compose.onNodeWithText("Close").performClick()
    }

    @Test fun decoderRejectsExternalMalformedAndOversizedDataAndSamplesLargeBitmap() {
        assertNull(MessageImageDecoder.decode("https://example.invalid/image.png", 2048))
        assertNull(MessageImageDecoder.decode("data:text/plain;base64,YQ==", 2048))
        assertNull(MessageImageDecoder.decode("data:image/png;base64,broken", 2048))
        assertNull(MessageImageDecoder.decode("data:image/png;base64," + "A".repeat(16 * 1024 * 1024), 2048))
        val bitmap = requireNotNull(MessageImageDecoder.decode(image("LARGE", 4096, 2048), 2048))
        assertTrue(bitmap.width <= 2048 && bitmap.height <= 2048)
    }
}

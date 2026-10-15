package ai.nuphos.android

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.Base64
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalContext
import androidx.core.view.WindowCompat
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
        compose.mainClock.advanceTimeBy(1000)
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
        compose.setContent { NuphosTheme(darkTheme = false) {
            val view = LocalView.current
            val activity = LocalContext.current as android.app.Activity
            SideEffect { WindowCompat.getInsetsController(activity.window, view).apply {
                isAppearanceLightStatusBars = true
                isAppearanceLightNavigationBars = true
            } }
            Surface(Modifier.fillMaxSize()) { Column { MessageImages(images, "synthetic") } }
        } }
        screenshot("synthetic-thumbnails-light")
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
        val dark = mutableStateOf(false)
        compose.setContent { NuphosTheme(darkTheme = dark.value) { MessageImagePager(listOf("https://example.invalid/private.png"), 0, onDismiss = {}) } }
        compose.waitUntil(5000) { compose.onAllNodesWithText("Image unavailable").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Image unavailable").assertIsDisplayed()
        screenshot("synthetic-image-unavailable-light")
        compose.runOnIdle { dark.value = true }
        screenshot("synthetic-image-unavailable-dark")
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
        restoration.setContent { NuphosTheme(darkTheme = true) { Surface(Modifier.fillMaxSize()) { Column { MessageImages(images, "restore") } } } }
        screenshot("synthetic-thumbnails-dark")
        compose.onNodeWithContentDescription("Image 3 of 5").performClick()
        ready(3)
        restoration.emulateSavedInstanceStateRestore()
        ready(3)
        screenshot("synthetic-image-dark-restored")
        page(3).performTouchInput { doubleClick() }
        screenshot("synthetic-image-dark-zoom")
        compose.onNodeWithText("Reset zoom").performClick()
        compose.onNodeWithText("Next image").performClick()
        ready(4)
        compose.onNodeWithText("Close").performClick()
    }

    @Test fun decoderRejectsPixelBombAndSniffedUnsupportedFormat() {
        // A PNG with an oversized IHDR must be rejected before raster decoding.
        val png = Base64.decode(image("HEADER").substringAfter(','), Base64.DEFAULT)
        java.nio.ByteBuffer.wrap(png).putInt(16, 8000).putInt(20, 8000)
        val crc = java.util.zip.CRC32().apply { update(png, 12, 17) }.value.toInt()
        java.nio.ByteBuffer.wrap(png).putInt(29, crc)
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(png, 0, png.size, bounds)
        assertEquals(8000, bounds.outWidth)
        assertEquals(8000, bounds.outHeight)
        assertNull(MessageImageDecoder.decode("data:image/png;base64," + Base64.encodeToString(png, Base64.NO_WRAP), 2048))
        // A valid 2x2 24-bit BMP falsely declared as PNG must not be decoded.
        val bmp = java.nio.ByteBuffer.allocate(70).order(java.nio.ByteOrder.LITTLE_ENDIAN).apply {
            put('B'.code.toByte()); put('M'.code.toByte()); putInt(70); putInt(0); putInt(54)
            putInt(40); putInt(2); putInt(2); putShort(1); putShort(24); putInt(0); putInt(16)
            putInt(0); putInt(0); putInt(0); putInt(0)
        }.array()
        android.graphics.BitmapFactory.decodeByteArray(bmp, 0, bmp.size, bounds)
        assertEquals("image/bmp", bounds.outMimeType)
        assertNull(MessageImageDecoder.decode("data:image/png;base64," + Base64.encodeToString(bmp, Base64.NO_WRAP), 2048))
        assertNull(MessageImageDecoder.decode("data:image/png;base64,非ASCII", 2048))
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

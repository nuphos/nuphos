package ai.nuphos.android

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.content.IntentFilter
import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.Color
import android.provider.MediaStore
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import ai.nuphos.android.data.*
import ai.nuphos.android.model.TransferUpload
import ai.nuphos.android.ui.chat.TransferCard
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import java.util.UUID

/** Synthetic responses and a temporary, owned scoped-storage document. Run in a separate fixture package. */
class SentAttachmentsFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val id = "0123456789abcdef01234567"
    private val attachment = TransferUpload(id, listOf("red.png", "blue.png", "report.txt"))
    private fun png(color: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888).apply { eraseColor(color) }
        return ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it); bitmap.recycle() }.toByteArray()
    }
    private val bytes = mapOf("red.png" to png(Color.RED), "blue.png" to png(Color.BLUE), "report.txt" to "synthetic document".toByteArray())
    private fun group() = TransferDownloadGroup(id, "2099-01-01T00:00:00Z", bytes.map { (name, data) ->
        TransferDownloadFile(name, name, "ready", if (name.endsWith("png")) "image/png" else "text/plain", "https://storage.example.test/$name", data.size.toLong())
    })
    private fun repository(status: () -> Int = { 200 }, calls: AtomicInteger = AtomicInteger()) = TransferDownloads(
        OkHttpClient.Builder().followRedirects(false).addInterceptor { chain ->
            calls.incrementAndGet()
            assertNull(chain.request().header("Authorization"))
            assertNull(chain.request().header("Cookie"))
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(status()).message("synthetic")
                .body(requireNotNull(bytes[chain.request().url.pathSegments.last()]).toResponseBody()).build()
        }.build())
    private fun screenshot(name: String) {
        compose.waitForIdle()
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(instrumentation.targetContext.cacheDir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    private fun loaded() = compose.waitUntil(10000) { compose.onAllNodesWithContentDescription("Save report.txt").fetchSemanticsNodes().isNotEmpty() }

    @Test fun imageCardsOpenPagerAndDocumentsSaveThroughSystemContract() {
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val resolver = instrumentation.targetContext.contentResolver
        val output = requireNotNull(resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, "nuphos-fixture-${UUID.randomUUID()}.txt")
            put(MediaStore.Downloads.MIME_TYPE, "text/plain")
        }))
        val monitor = instrumentation.addMonitor(IntentFilter(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            addDataType("*/*")
        },
            Instrumentation.ActivityResult(Activity.RESULT_OK, Intent().setData(output)), true)
        try {
            val repo = repository()
            compose.setContent { NuphosTheme { Surface(Modifier.fillMaxSize()) {
                Column(Modifier.verticalScroll(rememberScrollState())) { TransferCard(attachment, { group() }, true, { true }, repo, compact = true) }
            } } }
            loaded()
            screenshot("sent-attachment-card")
            compose.onNodeWithContentDescription("Save report.txt").performScrollTo().performClick()
            try {
                compose.waitUntil(10000) { runCatching { resolver.openInputStream(output)?.bufferedReader()?.use { it.readText() } }.getOrNull() == "synthetic document" }
            } catch (error: Throwable) {
                screenshot("sent-attachment-save-diagnostic")
                throw AssertionError("Document callback failed; monitor hits=${monitor.hits}", error)
            }
            assertEquals(1, monitor.hits)
            screenshot("sent-attachment-document-saved")
            compose.onNodeWithContentDescription("Image 1 of 2").performClick()
            compose.waitUntil(10000) { compose.onAllNodesWithText("Loading image").fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithText("1 / 2").assertIsDisplayed()
            screenshot("sent-attachment-pager")
            compose.onNodeWithText("Next image").performClick()
            compose.onNodeWithText("2 / 2").assertIsDisplayed()
            compose.onNodeWithText("Close").performClick()
            compose.onNodeWithText("2 / 2").assertDoesNotExist()
        } finally { instrumentation.removeMonitor(monitor); resolver.delete(output, null, null) }
    }

    @Test fun unavailableAndStorageFailureShowNamesAndAllowRetryWithoutInternalInstructions() {
        val readable = mutableStateOf(false)
        val status = AtomicInteger(403)
        val repo = repository({ status.get() })
        compose.setContent { NuphosTheme { Surface(Modifier.fillMaxSize()) {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                TransferCard(attachment, { if (!readable.value) error("synthetic unavailable") else group() }, true, { true }, repo)
            }
        } } }
        compose.waitUntil(10000) { compose.onAllNodesWithText("Attachments expired or unavailable").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("report.txt").assertIsDisplayed()
        compose.onAllNodesWithText("transfer-pull.sh", substring = true).assertCountEquals(0)
        screenshot("sent-attachment-expired")
        compose.runOnIdle { readable.value = true }
        compose.onNodeWithText("Retry attachments").performClick()
        loaded()
        compose.onNodeWithContentDescription("Save report.txt").performScrollTo().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("Couldn't save the file. Try again.").fetchSemanticsNodes().isNotEmpty() }
        screenshot("sent-attachment-save-failed")
        compose.onNodeWithText("Retry attachments").assertHasClickAction()
    }

    @Test fun revokedAccessClosesImageViewerAndRemovesRemoteContent() {
        val allowed = mutableStateOf(true)
        val repo = repository()
        compose.setContent { NuphosTheme { Surface {
            TransferCard(attachment, { group() }, allowed.value, { allowed.value }, repo)
        } } }
        loaded()
        compose.onNodeWithContentDescription("Image 1 of 2").performClick()
        compose.onNodeWithText("1 / 2").assertIsDisplayed()
        compose.runOnIdle { allowed.value = false }
        compose.onNodeWithText("Attachments unavailable").assertIsDisplayed()
        compose.onNodeWithText("1 / 2").assertDoesNotExist()
        compose.onNodeWithText("Save report.txt").assertDoesNotExist()
    }
}

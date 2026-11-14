package ai.nuphos.android

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.TransferDownloadFile
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.data.TransferDownloads
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChannelPost
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.model.TransferUpload
import ai.nuphos.android.session.ChannelSession
import ai.nuphos.android.ui.chats.ChannelTranscript
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/** Synthetic files only: groups come from a fake chat and images from a fake storage call, never the network. */
@RunWith(AndroidJUnit4::class)
class ChannelFilesFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val dark get() = InstrumentationRegistry.getArguments().getString("darkTheme") == "true"
    private val fetched = ConcurrentHashMap<String, AtomicInteger>()

    private fun png(label: String, color: Int, width: Int = 300, height: Int = 300): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).apply {
            drawColor(color)
            drawText(label, width / 2f, height / 2f + 60, Paint().apply {
                this.color = android.graphics.Color.WHITE; textSize = 180f; textAlign = Paint.Align.CENTER; isAntiAlias = true })
        }
        return ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }
    private val images = mapOf(
        "img1" to png("1", 0xFFE53935.toInt()), "img2" to png("2", 0xFF43A047.toInt()), "img3" to png("3", 0xFF1E88E5.toInt()),
        "img4" to png("4", 0xFFFB8C00.toInt()), "img5" to png("5", 0xFFD500F9.toInt(), 600, 400), "img6" to png("6", 0xFF00ACC1.toInt()),
        "wide" to png("W", 0xFF5E35B1.toInt(), 800, 200), "tall" to png("T", 0xFF6D4C41.toInt(), 360, 640), "long" to png("L", 0xFF546E7A.toInt(), 200, 800),
    )
    private val storage = TransferDownloads(OkHttpClient.Builder().addInterceptor { chain ->
        val request = chain.request()
        val name = request.url.pathSegments.last()
        fetched.getOrPut(name) { AtomicInteger() }.incrementAndGet()
        val bytes = images[name] ?: ByteArray(16)
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
            .body(bytes.toResponseBody(null)).build()
    }.build())

    private fun file(id: String, name: String, type: String) =
        TransferDownloadFile(id, name, "ready", type, "https://fixture.invalid/$id")
    private val groups = mutableMapOf(
        "gA1" to listOf(file("img1", "one.png", "image/png"), file("img2", "two.png", "image/png")),
        "gA2" to listOf(file("img3", "three.png", "image/png")),
        "gB1" to listOf(file("img4", "four.png", "image/png"), file("clip", "clip.mp4", "video/mp4")),
        "gB2" to listOf(file("pdf", "report.pdf", "application/pdf"), file("txt", "notes.txt", "text/plain")),
        "gC1" to listOf(file("img5", "five.png", "image/png")),
        "gD2" to listOf(file("img6", "six.png", "image/png")),
        "gW" to listOf(file("wide", "wide.png", "image/png")), "gT" to listOf(file("tall", "tall.png", "image/png")),
        "gL" to listOf(file("long", "long.png", "image/png")),
    )
    private val gone = mutableSetOf("gD1", "gE1", "gE2")

    private inner class Transport : ChannelSession.Transport {
        override suspend fun detail(tail: Int): AgentConversationDetail = error("Not read in this fixture")
        override suspend fun agents() = emptyList<ChannelAgent>()
        override suspend fun attachment(groupId: String): TransferDownloadGroup {
            if (groupId in gone) error("Synthetic expired group")
            return TransferDownloadGroup(groupId, "2099-01-01T00:00:00Z", groups.getValue(groupId))
        }
        override suspend fun upload(attachments: List<ComposerAttachment>): String = error("Not posting in this fixture")
        override suspend fun post(text: String, id: String, upload: String?, replyTo: String?) = error("Not posting in this fixture")
    }

    private fun post(id: String, minute: Int, text: String, downloads: List<String> = emptyList(), uploads: List<TransferUpload> = emptyList(),
                     agent: Boolean = true) = ChannelPost(id, if (agent) "agent-ops" else "diana", agent, if (agent) "Release ops" else "Diana Prince",
        text = text, uploads = uploads, downloads = downloads, sentAt = Instant.parse("2026-11-03T12:%02d:00Z".format(minute)))

    private fun render(posts: List<ChannelPost>? = null) {
        val session = ChannelSession("team", "chat-files", "release-planning", Transport())
        val posts = posts ?: listOf(
            post("p1", 0, "Single upload: the text sits below the image.", uploads = listOf(TransferUpload("gC1", listOf("five.png"))), agent = false),
            post("p2", 1, "Two groups, all images:", downloads = listOf("gA1", "gA2")),
            post("p3", 2, "Mixed groups:", downloads = listOf("gB1", "gB2")),
            post("p4", 3, "One group gone, one fine:", downloads = listOf("gD1", "gD2")),
            post("p5", 4, "Both groups gone:", uploads = listOf(TransferUpload("gE1", listOf("old-a.png")), TransferUpload("gE2", listOf("old-b.png"))), agent = false),
        )
        compose.setContent {
            NuphosTheme(darkTheme = dark) {
                androidx.compose.material3.Surface {
                    ChannelTranscript(session, ChannelPost.items(posts, emptyList(), emptyList()), viewerId = "me", onLink = {}, downloads = storage)
                }
            }
        }
    }

    private fun shot(name: String) {
        compose.waitForIdle()
        val inst = InstrumentationRegistry.getInstrumentation()
        java.io.File(inst.targetContext.getExternalFilesDir(null), "$name-${if (dark) "dark" else "light"}.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
    private fun bounds(name: String) = compose.onNodeWithContentDescription(name).fetchSemanticsNode().boundsInRoot
    private fun scrollTo(text: String) = compose.onNodeWithTag("channel-transcript").performScrollToNode(hasText(text))

    @Test fun aPostsGroupsShareOneGridAndOnePager() {
        render()
        scrollTo("Two groups, all images:")
        compose.waitUntil(5_000) { (fetched["img3"]?.get() ?: 0) > 0 }
        // Two groups, one row of three squares in posting order, below the agent's words.
        val one = bounds("one.png"); val two = bounds("two.png"); val three = bounds("three.png")
        assertEquals(one.top, three.top, 1f)
        assertTrue("$one $two $three", one.left < two.left && two.left < three.left)
        assertEquals(with(compose.density) { 84f * density }, one.width, 2f)
        assertTrue(compose.onNodeWithText("Two groups, all images:").fetchSemanticsNode().boundsInRoot.bottom <= one.top)
        shot("channel-files-grid")
        // The pager opens on the tapped image of the second group and pages across both groups.
        compose.onNodeWithContentDescription("three.png").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("3 / 3").fetchSemanticsNodes().isNotEmpty() }
        shot("channel-files-pager")
        compose.onNodeWithText("Next image").performClick()
        compose.onNodeWithText("1 / 3").assertExists()
        compose.onNodeWithText("Next image").performClick()
        compose.onNodeWithText("2 / 3").assertExists()
        compose.onNodeWithText("Close").performClick()
        compose.onNodeWithText("2 / 3").assertDoesNotExist()
    }

    @Test fun aLoneImageTakesItsOwnShape() {
        render(listOf(post("w", 0, "Wide", downloads = listOf("gW")), post("t", 1, "Tall", downloads = listOf("gT")),
            post("l", 2, "Long", downloads = listOf("gL")), post("s", 3, "Square", downloads = listOf("gD2"))))
        fun assertSize(name: String, text: String, width: Float, height: Float) {
            scrollTo(text)
            compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription(name).fetchSemanticsNodes().isNotEmpty() }
            compose.waitForIdle()
            val box = bounds(name)
            // The node's own size: a tall image can run past the bottom of the screen, which clips its bounds.
            val size = compose.onNodeWithContentDescription(name).fetchSemanticsNode().size
            with(compose.density) {
                assertEquals("$name width", width.dp.toPx(), size.width.toFloat(), 2f)
                assertEquals("$name height", height.dp.toPx(), size.height.toFloat(), 2f)
            }
            val words = compose.onNodeWithText(text).fetchSemanticsNode().boundsInRoot
            val gap = box.top - words.bottom
            with(compose.density) { assertTrue("$name has no band above it: $gap", gap >= 0f && gap <= 16.dp.toPx()) }
        }
        assertSize("wide.png", "Wide", 260f, 65f)
        assertSize("tall.png", "Tall", 146.25f, 260f)
        assertSize("long.png", "Long", 65f, 260f)
        assertSize("six.png", "Square", 260f, 260f)
    }
    @Test fun mixedGroupsLoneImagesAndGoneGroups() {
        render()
        // Mixed: images and videos in one grid, other files as chips below it; the pager holds the images and videos, as on iOS.
        scrollTo("Mixed groups:")
        val four = bounds("four.png"); val clip = bounds("clip.mp4")
        assertEquals(four.top, clip.top, 1f)
        val pdf = compose.onNodeWithText("report.pdf").fetchSemanticsNode().boundsInRoot
        assertTrue("$four $pdf", pdf.top >= four.bottom)
        compose.onNodeWithText("notes.txt").assertExists()
        compose.onNodeWithContentDescription("four.png").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("1 / 2").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Close").performClick()
        // One group gone: the other still shows, whole, and the gone one can be retried.
        scrollTo("One group gone, one fine:")
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("six.png").fetchSemanticsNodes().isNotEmpty() }
        assertTrue("A lone image is larger than a square", bounds("six.png").height > with(compose.density) { 200f * density })
        shot("channel-files-mixed")
        // Both gone: the names the post carried, above the person's words, and a retry.
        scrollTo("Both groups gone:")
        compose.waitUntil(5_000) { compose.onAllNodesWithText("old-a.png").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("old-b.png").assertExists()
        assertTrue(compose.onNodeWithText("old-b.png").fetchSemanticsNode().boundsInRoot.bottom <=
            compose.onNodeWithText("Both groups gone:").fetchSemanticsNode().boundsInRoot.top)
        shot("channel-files-gone")
        val retries = compose.onAllNodesWithText("Retry attachments").fetchSemanticsNodes().size
        assertTrue("Each post with a gone group offers a retry", retries >= 1)
        gone -= "gE1"; groups["gE1"] = listOf(file("img1", "back.png", "image/png"))
        // The retry of Diana's post: the closest one above her words.
        val words = compose.onNodeWithText("Both groups gone:").fetchSemanticsNode().boundsInRoot
        val nodes = compose.onAllNodesWithText("Retry attachments").fetchSemanticsNodes()
        val mine = nodes.indices.filter { nodes[it].boundsInRoot.bottom <= words.top }.maxBy { nodes[it].boundsInRoot.bottom }
        compose.onAllNodesWithText("Retry attachments")[mine].performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("back.png").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("old-a.png").assertDoesNotExist()
        // The upload shows whole above Diana's words.
        scrollTo("Single upload: the text sits below the image.")
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("five.png").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(bounds("five.png").bottom <= compose.onNodeWithText("Single upload: the text sits below the image.").fetchSemanticsNode().boundsInRoot.top)
    }
}

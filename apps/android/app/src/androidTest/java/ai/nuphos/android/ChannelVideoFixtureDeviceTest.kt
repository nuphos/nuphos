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
/** Synthetic files only: a tapped video opens in the viewer with the post's images and plays there, as on iOS. */
class ChannelVideoFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val fetched = ConcurrentHashMap<String, AtomicInteger>()
    @Volatile private var videoFails = false
    /** Served whole, with a 200, but not a video: the player is what fails. */
    @Volatile private var videoBroken = false
    // The repository's own two-second sample, served from this test's assets.
    private val clip: ByteArray = inst.context.assets.open("clip.mp4").use { it.readBytes() }
    private val image: ByteArray = run {
        val bitmap = Bitmap.createBitmap(400, 225, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).drawColor(0xFF5E35B1.toInt())
        ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }
    private val storage = TransferDownloads(OkHttpClient.Builder().addInterceptor { chain ->
        val request = chain.request()
        val name = request.url.pathSegments.last()
        fetched.getOrPut(name) { AtomicInteger() }.incrementAndGet()
        val builder = Response.Builder().request(request).protocol(Protocol.HTTP_1_1).message("fixture")
        if (name == "clip" && videoFails) builder.code(404).body(ByteArray(0).toResponseBody(null)).build()
        else if (name == "clip" && videoBroken) builder.code(200).body("not a video".toByteArray().toResponseBody(null)).build()
        else builder.code(200).body((if (name == "clip") clip else image).toResponseBody(null)).build()
    }.build())
    private fun file(id: String, name: String, type: String) = TransferDownloadFile(id, name, "ready", type, "https://fixture.invalid/$id")

    private inner class Transport : ChannelSession.Transport {
        override suspend fun detail(tail: Int): AgentConversationDetail = error("Not read in this fixture")
        override suspend fun agents() = emptyList<ChannelAgent>()
        override suspend fun attachment(groupId: String) =
            TransferDownloadGroup(groupId, "2099-01-01T00:00:00Z", listOf(file("wide", "wide.png", "image/png"), file("clip", "clip.mp4", "video/mp4")))
        override suspend fun upload(attachments: List<ComposerAttachment>): String = error("Not posting in this fixture")
        override suspend fun post(text: String, id: String, upload: String?, replyTo: String?) = error("Not posting in this fixture")
    }

    private fun render() {
        val session = ChannelSession("team", "chat-video", "release-planning", Transport())
        val posts = listOf(ChannelPost("p1", "agent-ops", true, "Release ops", text = "The recording and a still:",
            downloads = listOf("g1"), sentAt = Instant.parse("2026-11-03T12:00:00Z")))
        compose.setContent {
            NuphosTheme { androidx.compose.material3.Surface {
                ChannelTranscript(session, ChannelPost.items(posts, emptyList(), emptyList()), viewerId = "me", onLink = {}, downloads = storage)
            } }
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("clip.mp4").fetchSemanticsNodes().isNotEmpty() }
    }
    private fun has(text: String) = compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    private fun player() = compose.onAllNodesWithTag("video-player", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
    /** The player prepared the file: it can play, not just that a player is on screen. */
    private fun ready() = compose.onAllNodes(hasStateDescription("Ready to play"), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    @Test fun aTappedVideoOpensInTheViewerAndPlaysThere() {
        render()
        compose.onNodeWithContentDescription("clip.mp4").performClick()
        // The post's media in order: the still first, then the video, which is where it opens.
        compose.waitUntil(5_000) { has("2 / 2") }
        compose.waitUntil(8_000) { ready() }
        compose.onNodeWithContentDescription("Video 2 of 2", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Save video").assertExists()
        compose.onNodeWithText("Reset zoom").assertDoesNotExist()
        assertEquals("Fetched once for playing", 1, fetched["clip"]?.get())
    }

    @Test fun itPagesToTheImageBesideIt() {
        render()
        compose.onNodeWithContentDescription("clip.mp4").performClick()
        compose.waitUntil(8_000) { player() }
        compose.onNodeWithText("Next image").performClick()
        compose.waitUntil(3_000) { has("1 / 2") }
        compose.onNodeWithContentDescription("Image 1 of 2", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Reset zoom").assertExists()
        assertFalse("A page that goes takes its player with it", player())
        compose.onNodeWithText("Previous image").performClick()
        compose.waitUntil(8_000) { player() }
    }

    @Test fun aVideoThatCantLoadSaysSoAndCanBeTriedAgain() {
        videoFails = true
        render()
        compose.onNodeWithContentDescription("clip.mp4").performClick()
        compose.waitUntil(8_000) { has("Couldn't load the video. Try again.") }
        assertFalse(player())
        videoFails = false
        compose.onNodeWithText("Couldn't load the video. Try again.").performClick()
        compose.waitUntil(8_000) { ready() }
    }

    @Test fun aVideoThatWontPlayIsFetchedAgainOnTryAgain() {
        videoBroken = true
        render()
        compose.onNodeWithContentDescription("clip.mp4").performClick()
        // The download succeeds; the player is what can't use it.
        compose.waitUntil(10_000) { has("Couldn't load the video. Try again.") }
        assertFalse(ready())
        assertEquals(1, fetched["clip"]?.get())
        // The file is fixed on the server: trying again fetches it anew instead of replaying the copy that failed.
        videoBroken = false
        compose.onNodeWithText("Couldn't load the video. Try again.").performClick()
        compose.waitUntil(10_000) { ready() }
        assertEquals("Fetched again", 2, fetched["clip"]?.get())
    }

    @Test fun anImageStillOpensOnItself() {
        render()
        compose.onNodeWithContentDescription("wide.png").performClick()
        compose.waitUntil(5_000) { has("1 / 2") }
        assertFalse(player())
        assertNull("The video isn't fetched until its page shows", fetched["clip"])
    }
}

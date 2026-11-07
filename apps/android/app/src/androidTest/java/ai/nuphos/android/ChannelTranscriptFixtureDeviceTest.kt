package ai.nuphos.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChannelPost
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.session.ChannelSession
import ai.nuphos.android.ui.chats.ChannelTranscript
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Synthetic chat only; no account, network or preference. */
@RunWith(AndroidJUnit4::class)
class ChannelTranscriptFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    private class Transport : ChannelSession.Transport {
        var count = 30
        private fun post(i: Int): String {
            val (id, type, name, extra) = when {
                i % 7 == 0 -> listOf("agent-ops", "agent", "Release ops", ",\"sourceSessionId\":\"agent-ops\"")
                i % 2 == 0 -> listOf("me", "user", "Bruce Wayne", "")
                else -> listOf("diana", "user", "Diana Prince", "")
            }
            val minute = (i % 60).toString().padStart(2, '0')
            return """{"id":"m$i","role":"user","metadata":{"version":1,"sender":{"type":"$type","id":"$id","displayName":"$name"},"sentAt":"2026-11-03T09:$minute:00Z"$extra},"parts":[{"type":"text","text":"Post $i"}]}"""
        }
        override suspend fun detail(tail: Int): AgentConversationDetail = Http.json.decodeFromString(
            """{"kind":"channel","title":"release-planning","transcriptUpdatedAt":"t$count","messageCount":$count,""" +
                """"timelineEvents":[{"kind":"agents_paused","at":"2026-11-03T09:28:30Z","text":"Agents paused after 10 replies to each other."}],""" +
                """"messages":[${(1..count).joinToString(",") { post(it) }}]}""")
        override suspend fun agents() = listOf(ChannelAgent("agent-ops", "Release ops"))
        override suspend fun attachment(groupId: String): TransferDownloadGroup = error("No files in this fixture")
        override suspend fun upload(attachments: List<ai.nuphos.android.model.ComposerAttachment>): String = error("Not posting in this fixture")
        override suspend fun post(text: String, id: String, upload: String?, replyTo: String?) = error("Not posting in this fixture")
    }

    private val dark get() = InstrumentationRegistry.getArguments().getString("darkTheme") == "true"

    @Test fun opensAtLatestKeepsTheReadersPlaceAndJumpsBack() {
        val transport = Transport()
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        runBlocking { session.refresh(force = true) }
        compose.setContent {
            NuphosTheme(darkTheme = dark) {
                ChannelTranscript(session, ChannelPost.items(session.posts, session.events, emptyList()), viewerId = "me", onLink = {})
            }
        }
        compose.onNodeWithText("Post 30").assertIsDisplayed()
        compose.onNodeWithContentDescription("Scroll to latest").assertDoesNotExist()
        // Read older posts: the tagged agent run, the paused line and people's names show.
        compose.onNodeWithTag("channel-transcript").performScrollToNode(hasText("Agents paused after 10 replies to each other."))
        compose.onNodeWithText("Agents paused after 10 replies to each other.").assertIsDisplayed()
        compose.onNodeWithTag("channel-transcript").performScrollToNode(hasText("Post 28"))
        compose.onAllNodesWithText("Agent").onFirst().assertExists()
        compose.onNodeWithTag("channel-transcript").performScrollToNode(hasText("Post 1"))
        compose.onNodeWithText("Post 1").assertIsDisplayed()
        compose.onNodeWithContentDescription("Scroll to latest").assertIsDisplayed()
        // A new post while reading older ones does not move the reader.
        transport.count = 31
        runBlocking { session.refresh() }
        compose.waitForIdle()
        compose.onNodeWithText("Post 1").assertIsDisplayed()
        compose.onNodeWithContentDescription("Scroll to latest").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Post 31").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Post 31").assertIsDisplayed()
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("Scroll to latest").fetchSemanticsNodes().isEmpty() }
        // At the end, a new post is followed.
        transport.count = 32
        runBlocking { session.refresh() }
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Post 32").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Post 32").assertIsDisplayed()
        compose.waitForIdle()
        val inst = InstrumentationRegistry.getInstrumentation()
        java.io.File(inst.targetContext.getExternalFilesDir(null), "channel-transcript-${if (dark) "dark" else "light"}.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        // Your posts sit on the right, others on the left.
        val mine = compose.onNodeWithText("Post 32").fetchSemanticsNode().boundsInRoot
        val theirs = compose.onNodeWithText("Post 31").fetchSemanticsNode().boundsInRoot
        assertTrue("mine=$mine theirs=$theirs", mine.right > theirs.right)
    }
    private fun message(id: String, sender: String, name: String, at: String, text: String, agent: Boolean = false): ChannelPost {
        val type = if (agent) "agent" else "user"
        val source = if (agent) ",\"sourceSessionId\":\"$sender\"" else ""
        val json = """{"id":"$id","role":"user","metadata":{"version":1,"sender":{"type":"$type","id":"$sender","displayName":"$name"},"sentAt":"$at"$source},"parts":[{"type":"text","text":${Http.json.encodeToString(kotlinx.serialization.serializer<String>(), text)}}]}"""
        return ChannelPost.from(Http.json.decodeFromString<ChatMessage>(json))!!
    }

    /** iOS #1441: times between runs, no avatar on your posts, a small avatar beside others' names, compact Markdown. */
    @Test fun runsReadLikeAMessagingApp() {
        val session = ChannelSession("team", "chat-spacing", "release-planning", Transport())
        val posts = listOf(
            message("p1", "clark", "Clark Kent", "2026-11-03T09:00:00Z", "Thanks both, looks good to me."),
            message("p2", "me", "Bruce Wayne", "2026-11-03T09:02:00Z", "Will do"),
            message("p3", "diana", "Diana Prince", "2026-11-03T12:10:00Z", "Back from lunch. Any update on the build?"),
            message("p4", "diana", "Diana Prince", "2026-11-03T12:11:00Z", "ok?"),
            message("p5", "agent-ops", "Release ops", "2026-11-03T12:12:00Z",
                "### Release status\n\nBuild 412 finished processing.\n\nNext steps:\n\n- Submit to Play\n- Notify QA\n- Update the changelog\n\nI will post again when it is live.", agent = true),
            message("p6", "me", "Bruce Wayne", "2026-11-03T12:13:00Z", "Thumbs up"),
            message("p7", "me", "Bruce Wayne", "2026-11-03T12:14:00Z", "Synthetic sending check").copy(sending = true),
        )
        compose.setContent {
            NuphosTheme(darkTheme = dark) {
                ChannelTranscript(session, ChannelPost.items(posts, emptyList(), emptyList()), viewerId = "me", onLink = {})
            }
        }
        compose.waitForIdle()
        val inst = InstrumentationRegistry.getInstrumentation()
        java.io.File(inst.targetContext.getExternalFilesDir(null), "channel-spacing-${if (dark) "dark" else "light"}.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        // The pause before Diana's post gets a centered time and a new run; the next minute does not.
        compose.onNodeWithTag("channel-transcript").performScrollToNode(hasText("Clark Kent"))
        compose.onAllNodesWithTag("channel-time").assertCountEquals(2)
        compose.onNodeWithText("Diana Prince").assertExists()
        // No time under any bubble, and no footer on a post on its way.
        listOf("09:00", "09:02", "12:11", "12:13").forEach { compose.onNodeWithText(it).assertDoesNotExist() }
        compose.onNodeWithTag("channel-transcript").performScrollToNode(hasText("Synthetic sending check"))
        compose.onNodeWithText("Sending…").assertDoesNotExist()
        // Your own posts carry no name and no avatar.
        compose.onNodeWithText("Bruce Wayne").assertDoesNotExist()
        // Others: a 20 dp avatar left of the name, once per run, the bubble from the same leading edge.
        compose.onNodeWithTag("channel-transcript").performScrollToNode(hasText("Back from lunch. Any update on the build?"))
        val avatars = compose.onAllNodesWithTag("channel-avatar", useUnmergedTree = true).fetchSemanticsNodes()
        assertEquals("Clark, Diana and Release ops each start one run", 3, avatars.size)
        val density = compose.density
        avatars.forEach { assertEquals(20f, with(density) { it.size.width.toDp().value }, 1f) }
        val diana = compose.onNodeWithText("Diana Prince", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val dianaAvatar = avatars.map { it.boundsInRoot }.single { kotlin.math.abs(it.center.y - diana.center.y) < diana.height }
        assertTrue("avatar=$dianaAvatar name=$diana", dianaAvatar.right <= diana.left)
        val bubble = compose.onNodeWithText("Back from lunch. Any update on the build?", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val edge = with(density) { 24.dp.toPx() }
        assertTrue("avatar=$dianaAvatar bubble=$bubble", kotlin.math.abs((bubble.left - with(density) { 14.dp.toPx() }) - dianaAvatar.left) < edge)
    }
    /** The dots come and go in place, and being at the end, or not, doesn't change with them. */
    @Test fun typingComesAndGoesWithoutMovingTheReader() {
        val transport = Transport()
        val session = ChannelSession("team", "chat-typing", "Chat", transport)
        runBlocking { session.refresh(force = true) }
        val agents = androidx.compose.runtime.mutableStateOf(emptyList<ChannelAgent>())
        compose.setContent {
            NuphosTheme(darkTheme = dark) {
                ChannelTranscript(session, ChannelPost.items(session.posts, session.events, agents.value), viewerId = "me", onLink = {})
            }
        }
        val dots = hasContentDescription("Release ops is typing")
        compose.onNodeWithText("Post 30").assertIsDisplayed()
        compose.onNodeWithContentDescription("Scroll to latest").assertDoesNotExist()
        compose.onNode(dots).assertDoesNotExist()
        val before = compose.onNodeWithText("Post 30").fetchSemanticsNode().boundsInRoot
        // In: the dots show, and the newest post rises to make room.
        compose.runOnIdle { agents.value = listOf(ChannelAgent("agent-ops", "Release ops")) }
        compose.waitUntil(5_000) { compose.onAllNodes(dots).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        compose.onNode(dots).assertIsDisplayed()
        compose.onNodeWithContentDescription("Scroll to latest").assertDoesNotExist()
        val above = compose.onNodeWithText("Post 30").fetchSemanticsNode().boundsInRoot
        assertTrue("before=$before above=$above", above.top < before.top)
        // Out: the dots are still there as they leave, then gone, and the post settles back.
        compose.mainClock.autoAdvance = false
        compose.runOnIdle { agents.value = emptyList() }
        compose.mainClock.advanceTimeByFrame()
        compose.mainClock.advanceTimeBy(48)
        compose.onNode(dots).assertExists()
        compose.mainClock.autoAdvance = true
        compose.waitUntil(5_000) { compose.onAllNodes(dots).fetchSemanticsNodes().isEmpty() }
        compose.waitForIdle()
        assertEquals(before.top, compose.onNodeWithText("Post 30").fetchSemanticsNode().boundsInRoot.top, 2f)
        compose.onNodeWithContentDescription("Scroll to latest").assertDoesNotExist()
        // While reading older posts, the dots coming and going moves nothing on screen.
        compose.onNodeWithTag("channel-transcript").performScrollToNode(hasText("Post 1"))
        compose.waitForIdle()
        val reading = compose.onNodeWithText("Post 1").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { agents.value = listOf(ChannelAgent("agent-ops", "Release ops")) }
        compose.waitForIdle()
        assertEquals(reading.top, compose.onNodeWithText("Post 1").fetchSemanticsNode().boundsInRoot.top, 1f)
        compose.runOnIdle { agents.value = emptyList() }
        compose.waitForIdle()
        assertEquals(reading.top, compose.onNodeWithText("Post 1").fetchSemanticsNode().boundsInRoot.top, 1f)
    }
}

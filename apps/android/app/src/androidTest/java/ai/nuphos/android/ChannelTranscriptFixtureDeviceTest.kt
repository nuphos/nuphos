package ai.nuphos.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChannelPost
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
        override suspend fun post(text: String, id: String, upload: String?) = error("Not posting in this fixture")
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
}

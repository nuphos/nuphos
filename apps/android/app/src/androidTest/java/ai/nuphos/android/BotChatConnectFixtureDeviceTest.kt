package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChannelPost
import ai.nuphos.android.model.InputRequest
import ai.nuphos.android.session.ChannelSession
import ai.nuphos.android.ui.chats.ChannelTranscript
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/**
 * In a Bot's chat, an integration question naming providers is answered on its card through the
 * asking conversation's credential picker, as in the Inbox, never behind "Answer in the task".
 * Synthetic chat only; no account, network or preference.
 */
@RunWith(AndroidJUnit4::class)
class BotChatConnectFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    private class Transport : ChannelSession.Transport {
        val read = CopyOnWriteArrayList<String>()
        override suspend fun detail(tail: Int): AgentConversationDetail = Http.json.decodeFromString(
            """{"kind":"channel","title":"Release Lead","faces":[{"id":"bot-1","name":"Release Lead","agent":{"avatar":"05"}}],"messages":[]}""")
        override suspend fun agents() = emptyList<ChannelAgent>()
        override suspend fun attachment(groupId: String): TransferDownloadGroup = error("No files in this fixture")
        override suspend fun upload(attachments: List<ai.nuphos.android.model.ComposerAttachment>): String = error("Not posting in this fixture")
        override suspend fun post(text: String, id: String, upload: String?, replyTo: String?) = error("Not posting in this fixture")
        override suspend fun pending() = listOf(
            AgentConversation(sessionId = "docs", title = "Docs deploy", isOwner = true, parentSessionId = "bot-1",
                inputRequests = listOf(InputRequest("q-gcp", "integration", "Select the GCP project to deploy the docs to.", null,
                    "2026-11-16T09:00:00Z", providers = listOf("gcp")))),
            AgentConversation(sessionId = "bot-1", title = "Release Lead", isOwner = true))
        override suspend fun credentials(sessionId: String): JsonValue? { read += sessionId; return JsonValue.Obj(emptyMap()) }
    }

    @Test fun anIntegrationQuestionChoosesCredentialsInABotsChat() {
        val transport = Transport()
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        runBlocking { session.refresh(force = true); session.refreshQuestions() }
        val agents = ai.nuphos.android.session.AgentStore("synthetic-no-credentials", InstrumentationRegistry.getInstrumentation().targetContext)
        compose.setContent {
            NuphosTheme {
                androidx.compose.runtime.CompositionLocalProvider(ai.nuphos.android.ui.LocalAgentStore provides agents) {
                    ChannelTranscript(session, ChannelPost.items(session.posts, session.events, emptyList(), session.questions),
                        viewerId = "me", onLink = {})
                }
            }
        }
        compose.onNodeWithText("Select the GCP project to deploy the docs to.").assertIsDisplayed()
        capture("bot-chat-card")
        compose.onNodeWithText("Answer in the task").assertDoesNotExist()
        compose.onNodeWithTag("bot-question-connect").assertIsDisplayed().performClick()
        // The Inbox's flow: the asking conversation's selection is read, then its picker opens.
        compose.waitUntil(5_000) { transport.read.isNotEmpty() }
        assertEquals(listOf("docs"), transport.read.toList())
        compose.waitForIdle()
        capture("bot-chat-picker")
    }

    /** Saved under the app's files, `review-3080/`, for the PR's screenshots. */
    private fun capture(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.getExternalFilesDir(null), "review-3080").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}

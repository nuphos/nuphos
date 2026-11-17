package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChannelPost
import ai.nuphos.android.model.InputRequest
import ai.nuphos.android.session.ChannelSession
import ai.nuphos.android.session.OpenQuestions
import ai.nuphos.android.ui.chats.ChannelTranscript
import ai.nuphos.android.ui.inbox.InboxPage
import ai.nuphos.android.ui.theme.NuphosTheme
import java.io.File
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Inbox's Snooze and Dismiss: a snoozed question moves to the Snoozed section and Unsnooze brings
 * it back; Dismiss asks for an optional reason and waits out its Undo. A Bot's chat offers Dismiss
 * alone, sent at once. Synthetic questions only; no account, network or preference.
 */
@RunWith(AndroidJUnit4::class)
class InboxSnoozeFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    private class Source : ChannelSession.Transport {
        val snoozed = CopyOnWriteArrayList<Pair<String, Instant?>>()
        val dismissed = CopyOnWriteArrayList<Pair<String, String?>>()
        override suspend fun detail(tail: Int): AgentConversationDetail = Http.json.decodeFromString(
            """{"kind":"channel","title":"Release Lead","faces":[{"id":"bot-1","name":"Release Lead","agent":{"avatar":"05"}}],"messages":[]}""")
        override suspend fun agents() = emptyList<ChannelAgent>()
        override suspend fun attachment(groupId: String): TransferDownloadGroup = error("No files in this fixture")
        override suspend fun upload(attachments: List<ai.nuphos.android.model.ComposerAttachment>): String = error("Not posting in this fixture")
        override suspend fun post(text: String, id: String, upload: String?, replyTo: String?) = error("Not posting in this fixture")
        override suspend fun pending() = listOf(
            AgentConversation(sessionId = "docs", title = "Docs deploy", isOwner = true, parentSessionId = "bot-1",
                inputRequests = listOf(InputRequest("q-region", "preference", "Which region should the docs site deploy to?",
                    listOf("us-east-1", "eu-west-1"), "2026-11-17T09:00:00Z"))),
            AgentConversation(sessionId = "bot-1", title = "Release Lead", isOwner = true,
                inputRequests = listOf(InputRequest("q-ship", "approval", "Ship release 4.2 to production?",
                    listOf("Ship it", "Hold"), "2026-11-17T09:05:00Z"))))
        override suspend fun snooze(sessionId: String, requestId: String, until: Instant?) { snoozed += requestId to until }
        override suspend fun dismiss(sessionId: String, requestId: String, reason: String?) { dismissed += requestId to reason }
    }

    private val agents get() = ai.nuphos.android.session.AgentStore("synthetic-no-credentials",
        InstrumentationRegistry.getInstrumentation().targetContext)

    @Test fun theInboxSnoozesAndDismissesWithAReason() {
        val source = Source()
        val inbox = OpenQuestions(source)
        runBlocking { inbox.refresh() }
        val store = agents
        compose.setContent {
            NuphosTheme {
                androidx.compose.runtime.CompositionLocalProvider(ai.nuphos.android.ui.LocalAgentStore provides store) {
                    InboxPage(inbox, rememberNavController(), allowed = { true })
                }
            }
        }
        compose.onNodeWithText("Ship release 4.2 to production?").assertIsDisplayed()
        capture("1-inbox-question")
        compose.onAllNodesWithTag("bot-question-snooze")[0].performClick()
        compose.onNodeWithText("Tomorrow, 9:00").assertIsDisplayed()
        capture("2-snooze-menu")
        compose.onNodeWithText("Tomorrow, 9:00").performClick()
        compose.waitUntil(5_000) { source.snoozed.isNotEmpty() }
        assertEquals("q-ship", source.snoozed.single().first)
        compose.onNodeWithTag("inbox-snoozed").assertIsDisplayed()
        compose.onNodeWithTag("bot-question-dismiss").performClick()
        compose.onNodeWithTag("bot-question-dismiss-reason").performTextInput("We deploy the docs from CI now.")
        capture("3-dismiss-reason")
        compose.onNodeWithText("Cancel").performClick()
        capture("4-snoozed-section")
        compose.onNodeWithTag("inbox-unsnooze").performClick()
        compose.waitUntil(5_000) { source.snoozed.size == 2 }
        assertEquals(null, source.snoozed.last().second)
        compose.onNodeWithTag("inbox-snoozed").assertDoesNotExist()
        compose.onAllNodesWithTag("bot-question-dismiss")[1].performClick()
        compose.onNodeWithTag("bot-question-dismiss-reason").performTextInput("We deploy the docs from CI now.")
        compose.onNodeWithTag("bot-question-dismiss-send").performClick()
        compose.onNodeWithTag("inbox-undo").assertIsDisplayed()
        capture("5-dismiss-undo")
        assertTrue(source.dismissed.isEmpty())
        compose.mainClock.advanceTimeBy(OpenQuestions.UNDO_MS + 100)
        compose.waitUntil(5_000) { source.dismissed.isNotEmpty() }
        assertEquals("q-region" to "We deploy the docs from CI now.", source.dismissed.single())
    }

    @Test fun aBotsChatDismissesAtOnceWithoutAReason() {
        val source = Source()
        val session = ChannelSession("team", "chat-release", "Chat", source)
        runBlocking { session.refresh(force = true); session.refreshQuestions() }
        val store = agents
        compose.setContent {
            NuphosTheme {
                androidx.compose.runtime.CompositionLocalProvider(ai.nuphos.android.ui.LocalAgentStore provides store) {
                    ChannelTranscript(session, ChannelPost.items(session.posts, session.events, emptyList(), session.questions),
                        viewerId = "me", onLink = {})
                }
            }
        }
        compose.onNodeWithText("Ship release 4.2 to production?").assertIsDisplayed()
        compose.onNodeWithTag("bot-question-snooze").assertDoesNotExist()
        capture("6-bot-chat-dismiss")
        compose.onAllNodesWithTag("bot-question-dismiss")[0].performClick()
        compose.onNodeWithTag("bot-question-dismiss-reason").assertDoesNotExist()
        compose.waitUntil(5_000) { source.dismissed.isNotEmpty() }
        assertEquals(null, source.dismissed.single().second)
    }

    /** Saved under the app's files, `review-3231/`, by window width, for the PR's screenshots. */
    private fun capture(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val width = context.resources.configuration.screenWidthDp
        val directory = File(context.getExternalFilesDir(null), "review-3231").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name-${width}dp.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}

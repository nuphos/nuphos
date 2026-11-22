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

    private class Source(val asked: List<AgentConversation>? = null, val failSnooze: Boolean = false) : ChannelSession.Transport {
        val snoozed = CopyOnWriteArrayList<Pair<String, Instant?>>()
        val dismissed = CopyOnWriteArrayList<Pair<String, String?>>()
        override suspend fun detail(tail: Int): AgentConversationDetail = Http.json.decodeFromString(
            """{"kind":"channel","title":"Release Lead","faces":[{"id":"bot-1","name":"Release Lead","agent":{"avatar":"05"}}],"messages":[]}""")
        override suspend fun agents() = emptyList<ChannelAgent>()
        override suspend fun attachment(groupId: String): TransferDownloadGroup = error("No files in this fixture")
        override suspend fun upload(attachments: List<ai.nuphos.android.model.ComposerAttachment>): String = error("Not posting in this fixture")
        override suspend fun post(text: String, id: String, upload: String?, replyTo: String?) = error("Not posting in this fixture")
        override suspend fun pending() = asked ?: listOf(
            AgentConversation(sessionId = "docs", title = "Docs deploy", isOwner = true, parentSessionId = "bot-1",
                inputRequests = listOf(InputRequest("q-region", "preference", "Which region should the docs site deploy to?",
                    listOf("us-east-1", "eu-west-1"), "2026-11-17T09:00:00Z"))),
            AgentConversation(sessionId = "bot-1", title = "Release Lead", isOwner = true,
                inputRequests = listOf(InputRequest("q-ship", "approval", "Ship release 4.2 to production?",
                    listOf("Ship it", "Hold"), "2026-11-17T09:05:00Z"))))
        override suspend fun snooze(sessionId: String, requestId: String, until: Instant?) {
            if (failSnooze) throw java.io.IOException("offline")
            snoozed += requestId to until
        }
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
        compose.onNodeWithText("Ship release 4.2 to production?").assertIsDisplayed().performClick()
        capture("1-inbox-question")
        compose.onNodeWithTag("bot-question-snooze").performClick()
        compose.onNodeWithText("Tomorrow, 9:00").assertIsDisplayed()
        capture("2-snooze-menu")
        compose.onNodeWithText("Tomorrow, 9:00").performClick()
        compose.waitUntil(5_000) { source.snoozed.isNotEmpty() }
        assertEquals("q-ship", source.snoozed.single().first)
        compose.onNodeWithTag("inbox-detail").assertIsDisplayed()
        compose.onNodeWithTag("bot-question-dismiss").performClick()
        compose.onNodeWithTag("bot-question-dismiss-reason").performTextInput("We deploy the docs from CI now.")
        capture("3-dismiss-reason")
        compose.onNodeWithText("Cancel").performClick()
        compose.onNodeWithText("Back").performClick()
        capture("4-snoozed-section")
        compose.onNodeWithTag("inbox-unsnooze").performClick()
        compose.waitUntil(5_000) { source.snoozed.size == 2 }
        assertEquals(null, source.snoozed.last().second)
        compose.onNodeWithTag("inbox-snoozed").assertDoesNotExist()
        // The reason typed before Cancel is still there.
        compose.onNodeWithText("Which region should the docs site deploy to?").performClick()
        compose.onNodeWithTag("bot-question-dismiss").performClick()
        compose.onNodeWithTag("bot-question-dismiss-reason").assertTextContains("We deploy the docs from CI now.")
        // The reason sits under the card's own row, and on a small screen under the keyboard too (#3468).
        compose.onNodeWithTag("bot-question-dismiss-send").performScrollTo().performClick()
        // Sent at once: nothing waits for an Undo.
        compose.waitUntil(1_000) { source.dismissed.isNotEmpty() }
        capture("5-dismissed")
        assertEquals("q-region" to "We deploy the docs from CI now.", source.dismissed.single())
    }

    /** #3474: a secret could only be answered with its value. Dismiss sits under its masked card too. */
    @Test fun theInboxDismissesASecretWithAReason() {
        val source = Source(listOf(AgentConversation(sessionId = "ops", title = "Release ops", isOwner = true,
            inputRequests = listOf(InputRequest("q-token", "credential", "The rollout needs a deploy token.",
                askedAt = "2026-11-17T09:10:00Z", secretName = "DEPLOY_TOKEN")))))
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
        // The masked field itself is SecretQuestionFixtureDeviceTest's; here, the card's own Snooze and Dismiss.
        compose.onNodeWithText("The rollout needs a deploy token.").assertIsDisplayed().performClick()
        compose.onNodeWithTag("bot-question-snooze").assertIsDisplayed()
        capture("7-inbox-secret")
        compose.onNodeWithTag("bot-question-dismiss").performClick()
        compose.onNodeWithTag("bot-question-dismiss-reason").performTextInput("Use the token already in CI")
        capture("8-inbox-secret-reason")
        // The reason sits under the card's own row, and on a small screen under the keyboard too (#3468).
        compose.onNodeWithTag("bot-question-dismiss-send").performScrollTo().performClick()
        compose.waitUntil(1_000) { source.dismissed.isNotEmpty() }
        // A dismissal with its reason, never a value.
        assertEquals("q-token" to "Use the token already in CI", source.dismissed.single())
    }

    /** An Unsnooze the server refused leaves the question snoozed and says why, rather than nothing. */
    @Test fun aFailedUnsnoozeSaysWhy() {
        val later = Instant.now().plusSeconds(3_600).toString()
        val source = Source(listOf(AgentConversation(sessionId = "ops", title = "Release ops", isOwner = true,
            inputRequests = listOf(InputRequest("q-later", "preference", "Tag the release now?", listOf("Yes", "No"),
                "2026-11-17T09:10:00Z", snoozedUntil = later)))), failSnooze = true)
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
        compose.onNodeWithTag("inbox-unsnooze").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("inbox-snoozed-failure").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("inbox-snoozed").assertIsDisplayed()
        capture("9-unsnooze-failed")
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
        // Idle is not yet drawn: a slow emulator can still show the previous frame.
        Thread.sleep(1_500)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val width = context.resources.configuration.screenWidthDp
        val directory = File(context.getExternalFilesDir(null), "review-3231").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name-${width}dp.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        // And to the additional test output, which CI uploads with the device test report (#3468).
        val uploaded = File(context.externalMediaDirs.first(), "additional_test_output").apply { mkdirs() }
        File(uploaded, "review-3468-inbox-$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}

package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.CredentialRef
import ai.nuphos.android.model.InputRequest
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.session.ChatSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chat.ChatComposer
import ai.nuphos.android.ui.chats.BotQuestionCard
import ai.nuphos.android.ui.chats.ReplyChip
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * "Other…" on a question card starts the answer in the composer, quoting the question, and a plan
 * keeps only Approve and Reject. Synthetic questions only; no account, network or preference.
 */
@RunWith(AndroidJUnit4::class)
class QuestionOtherFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    private val deploy = BotQuestion("bot-release", "Release Lead",
        InputRequest("q-deploy", "approval", "Roll out 1.4 to production?", listOf("Ship it", "Wait for QA")))
    private val staging = BotQuestion("agent-staging", "Check the staging cluster",
        InputRequest("q-staging", "preference", "Which node pool should the staging cluster use?", emptyList()))
    private val plan = BotQuestion("bot-release", "Release Lead",
        InputRequest("q-plan", "approval", "Approve the plan \"Move staging to the new cluster\"?", listOf("Approve", "Reject"), planId = "p1"))

    @Test fun inABotChatOtherOpensTheAskingConversationsComposer() {
        var conversation by mutableStateOf<ChatSession?>(null)
        screen {
            val store = LocalAgentStore.current
            val chat = conversation
            if (chat == null) {
                Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                    for (question in listOf(deploy, plan)) {
                        BotQuestionCard(question, onOpen = {}, onAnswer = {}, showsFrom = false, onReply = {
                            // As the chat does: no post quoting it; the asking conversation answers it.
                            conversation = store.session(question.sessionId, question.title).also { it.answering = question }
                        })
                    }
                }
            } else {
                Spacer(Modifier.weight(1f))
                chat.answering?.let { ReplyChip(it.quote) { chat.answering = null } }
                ChatComposer(isStreaming = false, onSend = { false })
            }
        }
        // Other… beside the options; nothing on the plan.
        compose.onAllNodesWithTag("bot-question-other").assertCountEquals(1)
        capture("bot-chat")
        compose.onNodeWithText("Other…").performClick()
        compose.onNodeWithTag("channel-reply-chip").assertIsDisplayed()
        assertEquals(deploy, conversation?.answering)
        capture("bot-chat-other")
    }

    @Test fun fromTheInboxOtherOpensTheConversationComposerAnsweringIt() {
        var conversation by mutableStateOf<ChatSession?>(null)
        screen {
            val store = LocalAgentStore.current
            val chat = conversation
            if (chat == null) {
                Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                    for (question in listOf(deploy, staging, plan)) {
                        BotQuestionCard(question, onOpen = {}, onAnswer = {}, onReply = {
                            // As the Inbox does: the conversation's session answers it, then the conversation opens.
                            conversation = store.session(question.sessionId, question.title).also { it.answering = question }
                        })
                    }
                }
            } else {
                Spacer(Modifier.weight(1f))
                chat.answering?.let { ReplyChip(it.quote) { chat.answering = null } }
                ChatComposer(isStreaming = false, onSend = { false })
            }
        }
        // Other… beside options, Reply… without them, nothing on the plan.
        compose.onAllNodesWithTag("bot-question-other").assertCountEquals(2)
        compose.onNodeWithText("Reply…").assertIsDisplayed()
        capture("inbox")
        compose.onNodeWithText("Other…").performClick()
        compose.onNodeWithTag("channel-reply-chip").assertIsDisplayed()
        assertEquals(deploy, conversation?.answering)
        capture("inbox-other")
    }

    @Test fun anIntegrationQuestionChoosesCredentialsInTheInbox() {
        val github = BotQuestion("agent-ops", "Release ops",
            InputRequest("q-github", "integration", "Select your own GitHub so I can open the PR as you.", null))
        // One naming the member's own GitHub: answered by that alone, with no picker.
        val own = BotQuestion("agent-ops", "Release ops", InputRequest("q-own", "integration",
            "Connect your own GitHub so I can push as you.", null, credentials = listOf(CredentialRef("personal", "github"))))
        var connecting by mutableStateOf<BotQuestion?>(null)
        screen {
            Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                BotQuestionCard(github, onOpen = {}, onAnswer = {}, onConnect = { connecting = github })
                BotQuestionCard(own, onOpen = {}, onAnswer = {}, onConnect = { connecting = own })
            }
        }
        compose.onNodeWithText("Use your own GitHub").assertIsDisplayed()
        // Answered here, in the asking conversation's credential picker, not in the conversation.
        compose.onAllNodesWithTag("bot-question-connect").assertCountEquals(2)
        compose.onNodeWithText("Answer in the conversation").assertDoesNotExist()
        capture("inbox-integration")
        compose.onNodeWithText("Choose credentials").performClick()
        assertEquals(github, connecting)
    }

    private fun screen(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
        compose.setContent {
            val context = LocalContext.current
            val store = remember { AgentStore("synthetic", context) }
            val auth = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication).authSession
            NuphosTheme { Surface(Modifier.fillMaxSize()) {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    Column(Modifier.fillMaxSize().padding(vertical = 24.dp), content = content)
                }
            } }
        }
    }

    /** Saved under the app's files, `review-2012/`, for the PR's screenshots. */
    private fun capture(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.getExternalFilesDir(null), "review-2012").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}

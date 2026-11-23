package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.navigation.compose.rememberNavController
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.CredentialRef
import ai.nuphos.android.model.InputRequest
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.session.OpenQuestions
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chats.BotQuestionCard
import ai.nuphos.android.ui.inbox.InboxPage
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * A question card is answered in place: an option, or words typed in the card, never the composer and
 * never a bare "Done.". A plan keeps only Approve and Reject. Synthetic questions only; no account,
 * network or preference.
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

    @Test fun inABotChatOtherOpensATextBoxInTheCard() {
        val answers = mutableListOf<String>()
        screen {
            Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                for (question in listOf(deploy, plan)) {
                    BotQuestionCard(question, onOpen = {}, onConnect = {}, onAnswer = { answers += it }, showsFrom = false)
                }
            }
        }
        // Other… beside the options; nothing on the plan; no text box until asked for.
        compose.onAllNodesWithTag("bot-question-other").assertCountEquals(1)
        compose.onAllNodesWithTag("bot-question-answer").assertCountEquals(0)
        capture("bot-chat")
        compose.onNodeWithText("Other…").performClick()
        compose.onNodeWithTag("bot-question-answer").performTextInput("After QA signs off")
        capture("bot-chat-other")
        compose.onNodeWithTag("bot-question-send").performClick()
        assertEquals(listOf("After QA signs off"), answers)
    }

    @Test fun inboxGroupsQuestionsAndAnswersOneAtATime() {
        val answers = mutableListOf<Pair<String, String>>()
        val inbox = OpenQuestions(object : OpenQuestions.Source {
            override suspend fun pending() = listOf(
                AgentConversation(deploy.sessionId, title = deploy.title, avatar = "05-rembrandt", isOwner = true,
                    inputRequests = listOf(deploy.request, plan.request)),
                AgentConversation(staging.sessionId, title = staging.title, parentSessionId = deploy.sessionId,
                    isOwner = true, inputRequests = listOf(staging.request)),
            )

            override suspend fun answer(sessionId: String, requestId: String, answer: JsonValue) {
                answers += sessionId to requestId
            }
        })
        screen {
            LaunchedEffect(inbox) { inbox.refresh() }
            InboxPage(inbox, rememberNavController(), allowed = { true })
        }
        compose.onAllNodesWithTag("inbox-source").assertCountEquals(1)
        compose.onAllNodesWithTag("inbox-question").assertCountEquals(3)
        compose.onNodeWithTag("bot-question-answer").assertDoesNotExist()
        capture("inbox-grouped")
        compose.onNodeWithText(staging.request.question).performClick()
        capture("inbox-detail")
        compose.onNodeWithTag("bot-question-answer").assertIsDisplayed().performTextInput("The arm64 pool")
        compose.onNodeWithTag("bot-question-send").performClick()
        compose.onNodeWithText("Ship it").assertIsDisplayed()
        compose.runOnIdle { assertEquals(listOf(staging.sessionId to staging.request.id), answers) }
        compose.onNodeWithText("Back").performClick()
        compose.onAllNodesWithTag("inbox-question").assertCountEquals(2)
    }

    @Test fun inboxRestoresTheListPositionAfterOpeningAQuestion() {
        val inbox = OpenQuestions(object : OpenQuestions.Source {
            override suspend fun pending() = listOf(AgentConversation(
                "rollout", title = "Release ops", isOwner = true,
                inputRequests = (1..30).map { number ->
                    staging.request.copy(id = "q-%02d".format(number), question = "Synthetic question $number")
                },
            ))
        })
        screen {
            LaunchedEffect(inbox) { inbox.refresh() }
            InboxPage(inbox, rememberNavController(), allowed = { true })
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("inbox-list").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("inbox-list").performScrollToIndex(28)
        compose.onNodeWithText("Synthetic question 28").assertIsDisplayed().performClick()
        compose.onNodeWithTag("inbox-detail").assertIsDisplayed()
        compose.onNodeWithText("Back").performClick()
        compose.onNodeWithText("Synthetic question 28").assertIsDisplayed()
        compose.onNodeWithText("Synthetic question 1").assertIsNotDisplayed()
    }

    @Test fun inboxCanRetryItsFirstLoad() {
        var attempts = 0
        val inbox = OpenQuestions(object : OpenQuestions.Source {
            override suspend fun pending(): List<AgentConversation> {
                if (++attempts == 1) error("Synthetic listing failure")
                return emptyList()
            }
        })

        screen {
            LaunchedEffect(inbox) { inbox.refresh() }
            InboxPage(inbox, rememberNavController(), allowed = { true })
        }
        compose.onNodeWithText("Retry").assertIsDisplayed()
        capture("inbox-retry")
        compose.onNodeWithText("Retry").performClick()
        compose.onNodeWithText("You're all caught up").assertIsDisplayed()
    }

    @Test fun anIntegrationQuestionChoosesCredentialsInTheInbox() {
        val github = BotQuestion("agent-ops", "Release ops",
            InputRequest("q-github", "integration", "Select your own GitHub so I can open the PR as you.", null, providers = listOf("github")))
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
        compose.onNodeWithText("Answer in the task").assertDoesNotExist()
        capture("inbox-integration")
        compose.onNodeWithText("Choose credentials").performClick()
        assertEquals(github, connecting)
    }

    @Test fun anIntegrationQuestionNamingNoProviderIsAnsweredWithItsOptionsOrWords() {
        val play = BotQuestion("agent-ops", "Release ops", InputRequest("q-play", "integration",
            "How should I handle Android releases stuck in Play review?", listOf("I'll check the Publishing overview", "Wait for it to go live")))
        val answers = mutableListOf<String>()
        screen {
            Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                BotQuestionCard(play, onOpen = {}, onAnswer = { answers += it }, onConnect = {})
            }
        }
        // No connector names Play Console: no picker that can't answer it, nor "answer it in the task".
        compose.onAllNodesWithTag("bot-question-connect").assertCountEquals(0)
        compose.onNodeWithText("Answer in the task").assertDoesNotExist()
        compose.onAllNodesWithTag("bot-question-option").assertCountEquals(2)
        compose.onNodeWithText("Other…").performClick()
        compose.onNodeWithTag("bot-question-answer").performTextInput("Check the review status by hand")
        compose.onNodeWithTag("bot-question-send").performClick()
        compose.onNodeWithText("Wait for it to go live").performClick()
        assertEquals(listOf("Check the review status by hand", "Wait for it to go live"), answers)
    }

    @Test fun aCredentialQuestionWithOptionsIsAnsweredWithThemOrWords() {
        // #4029: a credential question with options and no secret is a choice like any other, Other… included.
        val signIn = BotQuestion("agent-ops", "Release ops", InputRequest("q-signin", "credential",
            "Codex on the Mac mini needs signing in again. Sign in now?", listOf("I'll sign in again", "Not now")))
        val answers = mutableListOf<String>()
        screen {
            Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                BotQuestionCard(signIn, onOpen = {}, onAnswer = { answers += it }, onConnect = {})
            }
        }
        compose.onAllNodesWithTag("bot-question-option").assertCountEquals(2)
        compose.onAllNodesWithTag("bot-question-other").assertCountEquals(1)
        artifact("credential-card-4029")
        compose.onNodeWithText("Other…").performClick()
        compose.onNodeWithTag("bot-question-answer").performTextInput("Use the other Codex for now")
        artifact("credential-other-4029")
        compose.onNodeWithTag("bot-question-send").performClick()
        assertEquals(listOf("Use the other Codex for now"), answers)
    }

    @Test fun aLongQuestionIsOneLineUntilTapped() {
        val long = BotQuestion("agent-ops", "Release ops", InputRequest("q-long", "approval",
            "Delete the staging cluster now? It has been idle for thirty days, costs about forty dollars a day, and nobody has deployed to it since the migration.",
            listOf("Delete", "Keep"), body = "Idle since the migration."))
        screen {
            Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                BotQuestionCard(long, onOpen = {}, onConnect = {}, onAnswer = {}, answersInPlace = true)
            }
        }
        // One line, cut, with the body under it.
        val title = compose.onNodeWithTag("bot-question-title")
        val category = compose.onNodeWithTag("bot-question-category")
        assertTrue(title.fetchSemanticsNode().config.contains(SemanticsProperties.Heading))
        assertTrue(title.fetchSemanticsNode().boundsInRoot.bottom <= category.fetchSemanticsNode().boundsInRoot.top)
        assertEquals(1, layout(title).lineCount)
        assertTrue(layout(title).hasVisualOverflow)
        compose.onNodeWithText("Idle since the migration.", substring = true).assertExists()
        artifact("long-question-cut")
        // A tap shows it in full.
        title.performClick()
        compose.waitForIdle()
        assertTrue(layout(title).lineCount > 1)
        artifact("long-question-open")
    }

    private fun layout(node: SemanticsNodeInteraction): TextLayoutResult {
        val results = mutableListOf<TextLayoutResult>()
        node.fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
        return results.first()
    }

    private fun screen(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
        compose.setContent {
            val context = LocalContext.current
            val store = remember { AgentStore("synthetic", context) }
            val auth = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication).authSession
            NuphosTheme(darkTheme = false) { Surface(Modifier.fillMaxSize()) {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    Column(Modifier.fillMaxSize().padding(vertical = 24.dp), content = content)
                }
            } }
        }
    }

    /** Saved to the additional test output, which CI uploads with the device test report. */
    private fun artifact(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.externalMediaDirs.first(), "additional_test_output").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "review-3273-$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }

    /** Saved under the app's files, `review-2298/`, for the PR's screenshots. */
    private fun capture(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.getExternalFilesDir(null), "review-2298").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}

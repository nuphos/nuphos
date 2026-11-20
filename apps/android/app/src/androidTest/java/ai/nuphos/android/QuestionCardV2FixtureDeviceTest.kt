package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.DecisionConversation
import ai.nuphos.android.model.InputRequest
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chats.BotQuestionCard
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.Duration
import java.time.Instant

/**
 * #2879: in a chat, a question card leads with the question, names who asked and how long ago when another
 * Bot or Task did, cuts a long body at four lines behind a full-width Show more, and answers with one
 * wrapping row of the same pill: the options, Other… and Dismiss (#3489). Synthetic questions only.
 */
@RunWith(AndroidJUnit4::class)
class QuestionCardV2FixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val dark = InstrumentationRegistry.getArguments().getString("darkTheme") == "true"

    private val deploy = BotQuestion("agent-release", "Release ops", InputRequest("q-deploy", "approval",
        "Roll out 1.4 to production?", listOf("Ship it", "Wait for QA"), askedAt = Instant.now().minus(Duration.ofDays(15)).toString(),
        body = (1..8).joinToString("\n") { "Finding $it: the canary held for an hour." }), runtime = "claude-code")

    private fun show(onDismiss: (String?) -> Unit = {}, answers: MutableList<String> = mutableListOf(), question: BotQuestion = deploy, onOpenConversation: (String) -> Unit = {}) {
        compose.setContent {
            val context = LocalContext.current
            val store = remember { AgentStore("synthetic", context) }
            val auth = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication).authSession
            NuphosTheme(darkTheme = dark) { Surface(Modifier.fillMaxSize()) {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 24.dp)) {
                        BotQuestionCard(question, onOpenConversation = onOpenConversation, onOpen = {}, onConnect = {}, onAnswer = { answers += it }, showsFrom = true, onDismiss = onDismiss)
                    }
                }
            } }
        }
    }

    @Test fun namesAndOpensTheConversationsThatActOnTheAnswer() {
        var opened: String? = null
        val question = deploy.copy(request = deploy.request.copy(aboutConversations = listOf(
            DecisionConversation("writer", "Release writer"), DecisionConversation("checker", "Release checker"),
        )))
        show(question = question, onOpenConversation = { opened = it })
        compose.onNodeWithText("Acted on by").assertIsDisplayed()
        compose.onNodeWithText("Release writer").assertIsDisplayed()
        compose.onNodeWithText("Release checker").assertIsDisplayed()
        capture("decision-conversations")
        compose.onNodeWithText("Release writer").performClick()
        assertEquals("writer", opened)
    }

    private fun bounds(tag: String, index: Int = 0) = compose.onAllNodesWithTag(tag)[index].fetchSemanticsNode().boundsInRoot

    @Test fun theQuestionLeadsAndAnotherAgentIsNamed() {
        show()
        compose.onNodeWithTag("bot-question-heading").assertTextEquals("Roll out 1.4 to production?")
        compose.onNodeWithText("Approval needed").assertDoesNotExist()
        compose.onNodeWithTag("bot-question-from").assertIsDisplayed()
        compose.onNodeWithText("Release ops", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("bot-question-age", useUnmergedTree = true).assertTextEquals("· 15 days")
        capture("question-card-v2")
    }

    @Test fun optionsOtherAndDismissAreOneRowOfTheSamePill() {
        show()
        val card = bounds("bot-question")
        compose.onAllNodesWithTag("bot-question-option").assertCountEquals(2)
        val pills = listOf(bounds("bot-question-option", 0), bounds("bot-question-option", 1), bounds("bot-question-other"), bounds("bot-question-dismiss"))
        for ((i, pill) in pills.withIndex()) {
            assertEquals("Pill $i is as high as the first", pills[0].height, pill.height, 1f)
            assertTrue("Pill $i fits its label, not the card", pill.width < card.width / 2)
        }
        assertEquals("The options and Other… start one row", pills[0].top, pills[2].top, 1f)
        assertTrue("Dismiss follows in the row, or wraps under it", pills[3].top >= pills[0].top - 1)
    }

    @Test fun showMoreIsAFullWidthRowThatOpensTheBody() {
        show()
        val density = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.density
        val more = bounds("bot-question-more")
        assertTrue("Show more is 44dp high", more.height >= 44 * density - 1)
        assertTrue("Show more is full width", more.width >= bounds("bot-question").width - 40 * density)
        val cut = bounds("bot-question-body").height
        compose.onNodeWithTag("bot-question-more").performClick()
        compose.onNodeWithText("Show less").assertIsDisplayed()
        assertTrue("The body opens", bounds("bot-question-body").height > cut)
    }

    @Test fun dismissClosesIt() {
        var dismissed = false
        show(onDismiss = { dismissed = true })
        compose.onNodeWithTag("bot-question-dismiss").performClick()
        assertTrue(dismissed)
    }

    @Test fun otherOpensTheAnswerField() {
        val answers = mutableListOf<String>()
        show(answers = answers)
        compose.onNodeWithTag("bot-question-other").performClick()
        compose.onNodeWithTag("bot-question-answer").performTextInput("After the board meeting")
        compose.onNodeWithTag("bot-question-send").performClick()
        assertEquals(listOf("After the board meeting"), answers)
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        val inst = InstrumentationRegistry.getInstrumentation()
        val dir = inst.targetContext.getExternalFilesDir("question-card")!!
        File(dir, "$name-${if (dark) "dark" else "light"}.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}

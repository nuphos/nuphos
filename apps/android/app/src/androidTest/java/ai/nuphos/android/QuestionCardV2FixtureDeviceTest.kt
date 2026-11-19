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

/**
 * #2879: in a chat, a question card leads with the question, names who asked when another Bot or Task
 * did, cuts a long body at four lines behind a full-width Show more, and answers with full-width
 * options and two half-width buttons, Other… and Skip. Synthetic questions only.
 */
@RunWith(AndroidJUnit4::class)
class QuestionCardV2FixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val dark = InstrumentationRegistry.getArguments().getString("darkTheme") == "true"

    private val deploy = BotQuestion("agent-release", "Release ops", InputRequest("q-deploy", "approval",
        "Roll out 1.4 to production?", listOf("Ship it", "Wait for QA"),
        body = (1..8).joinToString("\n") { "Finding $it: the canary held for an hour." }))

    private fun show(onDismiss: (String?) -> Unit = {}, answers: MutableList<String> = mutableListOf()) {
        compose.setContent {
            val context = LocalContext.current
            val store = remember { AgentStore("synthetic", context) }
            val auth = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication).authSession
            NuphosTheme(darkTheme = dark) { Surface(Modifier.fillMaxSize()) {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 24.dp)) {
                        BotQuestionCard(deploy, onOpen = {}, onConnect = {}, onAnswer = { answers += it }, showsFrom = true, onDismiss = onDismiss)
                    }
                }
            } }
        }
    }

    private fun bounds(tag: String, index: Int = 0) = compose.onAllNodesWithTag(tag)[index].fetchSemanticsNode().boundsInRoot

    @Test fun theQuestionLeadsAndAnotherAgentIsNamed() {
        show()
        compose.onNodeWithTag("bot-question-heading").assertTextEquals("Roll out 1.4 to production?")
        compose.onNodeWithText("Approval needed").assertDoesNotExist()
        compose.onNodeWithTag("bot-question-from").assertIsDisplayed()
        compose.onNodeWithText("Release ops", useUnmergedTree = true).assertIsDisplayed()
        capture("question-card-v2")
    }

    @Test fun optionsAreFullWidthAndOtherAndSkipShareARow() {
        show()
        val density = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.density
        val card = bounds("bot-question")
        compose.onAllNodesWithTag("bot-question-option").assertCountEquals(2)
        for (i in 0..1) {
            val option = bounds("bot-question-option", i)
            assertTrue("Option $i is 44dp high", option.height >= 44 * density - 1)
            assertTrue("Option $i is full width", option.width >= card.width - 40 * density)
        }
        val other = bounds("bot-question-other")
        val skip = bounds("bot-question-dismiss")
        assertEquals("Other and Skip share a row", other.top, skip.top, 1f)
        assertEquals("Other and Skip are the same width", other.width, skip.width, 2f)
        assertTrue("Other is about half", other.width < card.width / 2)
        assertTrue("Other is 44dp high", other.height >= 44 * density - 1)
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

    @Test fun skipClosesIt() {
        var dismissed = false
        show(onDismiss = { dismissed = true })
        compose.onNodeWithTag("bot-question-dismiss").performClick()
        assertTrue(dismissed)
    }

    @Test fun otherTakesTheRow() {
        val answers = mutableListOf<String>()
        show(answers = answers)
        compose.onNodeWithTag("bot-question-other").performClick()
        compose.onNodeWithTag("bot-question-dismiss").assertDoesNotExist()
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

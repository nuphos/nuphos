package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
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
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.DecisionQuestion
import ai.nuphos.android.model.InputRequest
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chats.BotQuestionCard
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * A card with several questions, or a multi-select one, is a form: each question's options toggle,
 * words can take their place, and one "Send answer" sends them together as Desktop and iOS do.
 * Synthetic questions only; no account, network or preference.
 */
@RunWith(AndroidJUnit4::class)
class DecisionFormFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    // As the backend sends it: `body` ends with the questions written out for clients without forms.
    private val release = BotQuestion("bot-release", "Release Lead", Http.json.decodeFromString(InputRequest.serializer(), """
        {"id":"q-release","category":"preference","question":"Two things before the 1.4 rollout",
         "body":"The canary has been clean for a day.\n\n---\n\n**1. Roll out now?**\n- Ship it\n- Wait for QA\n\n**2. Which regions first?** (any number)\n- us-east\n- eu-west\n- ap-northeast",
         "questions":[{"question":"Roll out now?","options":["Ship it","Wait for QA"]},
                      {"question":"Which regions first?","options":["us-east","eu-west","ap-northeast"],"multiSelect":true}]}
    """))

    @Test fun severalQuestionsAreAnsweredAsOneForm() {
        val sent = mutableListOf<JsonValue>()
        val texts = mutableListOf<String>()
        screen { BotQuestionCard(release, onOpen = {}, onAnswer = { texts += it }, onForm = { sent += it }, answersInPlace = true) }
        // The written-out list is not repeated under the form; the agent's own text is.
        compose.onNodeWithText("The canary has been clean for a day.").assertIsDisplayed()
        compose.onNodeWithText("**1. Roll out now?**", substring = true).assertDoesNotExist()
        compose.onAllNodesWithTag("bot-question-choice").assertCountEquals(5)
        // Nothing is sent until every question has an answer.
        compose.onNodeWithTag("bot-question-form-send").assertIsNotEnabled()
        capture("form")

        compose.onNodeWithText("Wait for QA").performClick()
        // One choice for a single-choice question: the second replaces the first.
        compose.onNodeWithText("Ship it").performClick()
        compose.onNodeWithTag("bot-question-form-send").assertIsNotEnabled()
        // Any number for a multi-select one.
        compose.onNodeWithText("us-east").performClick()
        compose.onNodeWithText("ap-northeast").performClick()
        capture("form-picked")
        compose.onNodeWithTag("bot-question-form-send").performScrollTo().performClick()

        assertTrue(texts.isEmpty())
        assertEquals(listOf("""{"questions":[{"choices":["Ship it"]},{"choices":["us-east","ap-northeast"]}]}"""),
            sent.map { it.compact })
    }

    @Test fun typedWordsTakeThePlaceOfAQuestionsPicks() {
        val sent = mutableListOf<JsonValue>()
        screen { BotQuestionCard(release, onOpen = {}, onAnswer = {}, onForm = { sent += it }) }
        compose.onNodeWithText("Ship it").performClick()
        compose.onAllNodesWithTag("bot-question-form-text")[1].performTextInput("Only us-east, then wait a day")
        capture("form-typed")
        compose.onNodeWithTag("bot-question-form-send").performScrollTo().performClick()
        assertEquals(listOf("""{"questions":[{"choices":["Ship it"]},{"text":"Only us-east, then wait a day"}]}"""),
            sent.map { it.compact })
    }

    @Test fun aCardTheAgentCorrectsStartsItsFormOver() {
        val sent = mutableListOf<JsonValue>()
        var card by mutableStateOf(release)
        screen { BotQuestionCard(card, onOpen = {}, onAnswer = {}, onForm = { sent += it }) }
        compose.onNodeWithText("Ship it").performClick()
        // Same card id, one more question: the form is rebuilt for three, not indexed past two.
        val questions = release.request.questions!! + DecisionQuestion("Who watches the rollout?", listOf("Can", "Yuanlin"))
        // The backend writes the corrected list into the body again, which the form leaves out.
        card = release.copy(request = release.request.copy(questions = questions,
            body = "The canary has been clean for a day." + BotQuestion.writtenQuestions(questions)))
        compose.onAllNodesWithTag("bot-question-choice").assertCountEquals(7)
        compose.onAllNodesWithTag("bot-question-form-text").assertCountEquals(3)
        compose.onNodeWithTag("bot-question-form-send").assertIsNotEnabled()
        compose.onNodeWithText("Wait for QA").performClick()
        compose.onNodeWithText("eu-west").performClick()
        compose.onNodeWithText("Yuanlin").performScrollTo().performClick()
        compose.onNodeWithTag("bot-question-form-send").performScrollTo().performClick()
        assertEquals(listOf("""{"questions":[{"choices":["Wait for QA"]},{"choices":["eu-west"]},{"choices":["Yuanlin"]}]}"""),
            sent.map { it.compact })
    }

    @Test fun aSingleChoiceQuestionKeepsItsOneTapOptions() {
        val answers = mutableListOf<String>()
        val deploy = BotQuestion("bot-release", "Release Lead",
            InputRequest("q-deploy", "approval", "Roll out 1.4 to production?", listOf("Ship it", "Wait for QA")))
        screen { BotQuestionCard(deploy, onOpen = {}, onAnswer = { answers += it }, showsFrom = false) }
        compose.onAllNodesWithTag("bot-question-form").assertCountEquals(0)
        compose.onNodeWithText("Ship it").performClick()
        assertEquals(listOf("Ship it"), answers)
    }

    private fun screen(content: @androidx.compose.runtime.Composable () -> Unit) {
        compose.setContent {
            val context = LocalContext.current
            val store = remember { AgentStore("synthetic", context) }
            val auth = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication).authSession
            NuphosTheme { Surface(Modifier.fillMaxSize()) {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 24.dp)) {
                        content()
                    }
                }
            } }
        }
    }

    /** Saved under the app's files, `review-2241/`, for the PR's screenshots. */
    private fun capture(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.getExternalFilesDir(null), "review-2241").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}

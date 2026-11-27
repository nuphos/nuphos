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
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createComposeRule
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
 * A card with several questions, or a multi-select one, picks the same option buttons a
 * single-choice card answers with: each question's options toggle, "Other" is picked in their place
 * with its words under it, and one footer's Send sends them together, "Answer N more" until every
 * question is answered (#3468, #5257). Synthetic questions only; no account, network or preference.
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
        screen { BotQuestionCard(release, onOpen = {}, onConnect = {}, onAnswer = { texts += it }, onForm = { sent += it }, answersInPlace = true,
            onDismiss = {}, asksReason = true, onSnooze = {}) }
        artifact("several")
        // The written-out list is not repeated under the form; the agent's own text is.
        compose.onNodeWithText("The canary has been clean for a day.").assertIsDisplayed()
        compose.onNodeWithText("**1. Roll out now?**", substring = true).assertDoesNotExist()
        compose.onAllNodesWithTag("bot-question-option").assertCountEquals(5)
        // Numbered, and "Choose any" on the multi-select; no field until Other is picked.
        compose.onAllNodesWithTag("bot-question-marker").assertCountEquals(2)
        compose.onNodeWithText("Choose any").assertIsDisplayed()
        compose.onAllNodesWithTag("bot-question-answer").assertCountEquals(0)
        // Nothing is sent until every question has an answer: the footer counts what is left.
        compose.onNodeWithTag("bot-question-send").assertIsNotEnabled().assertTextEquals("Answer 2 more")
        // Snooze and Dismiss share the footer with it, on its left.
        val send = compose.onNodeWithTag("bot-question-send").fetchSemanticsNode().boundsInRoot
        val dismiss = compose.onNodeWithTag("bot-question-dismiss").fetchSemanticsNode().boundsInRoot
        assertTrue(dismiss.right <= send.left && dismiss.bottom > send.top && dismiss.top < send.bottom)
        capture("form")

        compose.onNodeWithText("Wait for QA").performClick()
        // One choice for a single-choice question: the second replaces the first.
        compose.onNodeWithText("Ship it").performClick()
        compose.onNodeWithTag("bot-question-send").assertIsNotEnabled().assertTextEquals("Answer 1 more")
        compose.onAllNodesWithTag("bot-question-marker")[0].assertIsSelected()
        // Any number for a multi-select one.
        compose.onNodeWithText("us-east").performClick()
        compose.onNodeWithText("ap-northeast").performClick()
        capture("form-picked")
        compose.onNodeWithTag("bot-question-send").assertIsEnabled().assertTextEquals("Send")
        compose.onNodeWithTag("bot-question-send").performScrollTo().performClick()

        assertTrue(texts.isEmpty())
        assertEquals(listOf("""{"questions":[{"choices":["Ship it"]},{"choices":["us-east","ap-northeast"]}]}"""),
            sent.map { it.compact })
    }

    @Test fun otherIsPickedInPlaceOfAQuestionsOptions() {
        val sent = mutableListOf<JsonValue>()
        screen { BotQuestionCard(release, onOpen = {}, onConnect = {}, onAnswer = {}, onForm = { sent += it }) }
        compose.onNodeWithText("Ship it").performClick()
        compose.onNodeWithText("us-east").performClick()
        // Words only behind "Other…"; picking it unpicks the multi-select's options too.
        compose.onAllNodesWithTag("bot-question-answer").assertCountEquals(0)
        compose.onAllNodesWithTag("bot-question-other")[1].performScrollTo().performClick()
        compose.onNodeWithText("us-east").assertIsNotSelected()
        compose.onAllNodesWithTag("bot-question-other")[1].assertIsSelected().assertTextEquals("Other")
        // Picked with no words, the question is not answered; return sends nothing yet.
        compose.onNodeWithTag("bot-question-send").assertIsNotEnabled().assertTextEquals("Answer 1 more")
        val words = compose.onNodeWithTag("bot-question-answer")
        words.performImeAction()
        assertTrue(sent.isEmpty())
        words.performTextInput("Only us-east, then wait a day")
        capture("form-typed")
        // The field has no send of its own: return sends the complete card.
        words.performImeAction()
        assertEquals(listOf("""{"questions":[{"choices":["Ship it"]},{"text":"Only us-east, then wait a day"}]}"""),
            sent.map { it.compact })
    }

    @Test fun eachQuestionKeepsItsOwnWords() {
        val sent = mutableListOf<JsonValue>()
        screen { BotQuestionCard(release, onOpen = {}, onConnect = {}, onAnswer = {}, onForm = { sent += it }) }
        compose.onAllNodesWithTag("bot-question-other")[0].performScrollTo().performClick()
        compose.onNodeWithTag("bot-question-answer").performTextInput("After the freeze")
        // Other on the second question opens its own field; the first keeps its words.
        compose.onAllNodesWithTag("bot-question-other")[1].performScrollTo().performClick()
        compose.onAllNodesWithTag("bot-question-answer").assertCountEquals(2)
        compose.onAllNodesWithTag("bot-question-answer")[0].assertTextContains("After the freeze")
        compose.onAllNodesWithTag("bot-question-answer")[1].performTextInput("Only eu-west")
        // An option unpicks Other and its field; picked again, its words are back.
        compose.onNodeWithText("Ship it").performScrollTo().performClick()
        compose.onAllNodesWithTag("bot-question-answer").assertCountEquals(1)
        compose.onAllNodesWithTag("bot-question-other")[0].performScrollTo().performClick()
        compose.onAllNodesWithTag("bot-question-answer")[0].assertTextContains("After the freeze")
        compose.onNodeWithTag("bot-question-send").performScrollTo().performClick()
        assertEquals(listOf("""{"questions":[{"text":"After the freeze"},{"text":"Only eu-west"}]}"""), sent.map { it.compact })
    }

    @Test fun aCardTheAgentCorrectsStartsItsFormOver() {
        val sent = mutableListOf<JsonValue>()
        var card by mutableStateOf(release)
        screen { BotQuestionCard(card, onOpen = {}, onConnect = {}, onAnswer = {}, onForm = { sent += it }) }
        compose.onNodeWithText("Ship it").performClick()
        // Same card id, one more question: the form is rebuilt for three, not indexed past two.
        val questions = release.request.questions!! + DecisionQuestion("Who watches the rollout?", listOf("Can", "Yuanlin"))
        // The backend writes the corrected list into the body again, which the form leaves out.
        card = release.copy(request = release.request.copy(questions = questions,
            body = "The canary has been clean for a day." + BotQuestion.writtenQuestions(questions)))
        compose.onAllNodesWithTag("bot-question-option").assertCountEquals(7)
        compose.onAllNodesWithTag("bot-question-other").assertCountEquals(3)
        compose.onNodeWithTag("bot-question-send").assertIsNotEnabled()
        compose.onNodeWithText("Wait for QA").performClick()
        compose.onNodeWithText("eu-west").performClick()
        compose.onNodeWithText("Yuanlin").performScrollTo().performClick()
        compose.onNodeWithTag("bot-question-send").performScrollTo().performClick()
        assertEquals(listOf("""{"questions":[{"choices":["Wait for QA"]},{"choices":["eu-west"]},{"choices":["Yuanlin"]}]}"""),
            sent.map { it.compact })
    }

    @Test fun aSingleAndAMultiSelectQuestionAreOneCard() {
        val answers = mutableListOf<String>()
        val sent = mutableListOf<JsonValue>()
        val deploy = BotQuestion("bot-release", "Release Lead",
            InputRequest("q-deploy", "approval", "Roll out 1.4 to production?", listOf("Ship it", "Wait for QA")))
        val regions = BotQuestion("bot-release", "Release Lead", Http.json.decodeFromString(InputRequest.serializer(), """
            {"id":"q-regions","category":"preference","question":"Which regions ship today?",
             "options":["us-east","eu-west","ap-northeast"],"multiSelect":true}
        """))
        screen {
            // As the Inbox draws them: Snooze and Dismiss end the row (#3468).
            BotQuestionCard(deploy, onOpen = {}, onConnect = {}, onAnswer = { answers += it }, showsFrom = false,
                onDismiss = {}, asksReason = true, onSnooze = {})
            BotQuestionCard(regions, onOpen = {}, onConnect = {}, onAnswer = { answers += it }, onForm = { sent += it }, showsFrom = false,
                onDismiss = {}, asksReason = true, onSnooze = {})
        }
        artifact("single-and-multi")
        // Every button in a row is the one pill: options, Other…, Snooze and Dismiss, no Skip.
        compose.onAllNodesWithTag("bot-question-snooze").assertCountEquals(2)
        compose.onAllNodesWithTag("bot-question-dismiss").assertCountEquals(2)
        compose.onNodeWithText("Skip").assertDoesNotExist()
        // The same option buttons and "Other…" on both, and no text box until "Other…" opens one.
        compose.onAllNodesWithTag("bot-question-option").assertCountEquals(5)
        compose.onAllNodesWithTag("bot-question-other").assertCountEquals(2)
        compose.onAllNodesWithTag("bot-question-answer").assertCountEquals(0)
        // Only the multi-select has Send, for its picks; a single choice is answered by its option.
        compose.onAllNodesWithTag("bot-question-send").assertCountEquals(1)
        compose.onNodeWithText("Ship it").performClick()
        assertEquals(listOf("Ship it"), answers)

        compose.onNodeWithText("us-east").performClick()
        compose.onNodeWithText("ap-northeast").performClick()
        compose.onNodeWithText("us-east").assertIsSelected()
        compose.onNodeWithText("eu-west").assertIsNotSelected()
        artifact("multi-picked")
        compose.onNodeWithTag("bot-question-send").performScrollTo().performClick()
        assertEquals(listOf("""{"choices":["us-east","ap-northeast"]}"""), sent.map { it.compact })
        assertEquals(listOf("Ship it"), answers)
    }

    /** #3468: a one-entry `questions` card takes its mode from that entry, the top level saying nothing of it. */
    @Test fun aOneEntryQuestionsCardTakesItsModeFromThatEntry() {
        val sent = mutableListOf<JsonValue>()
        val answers = mutableListOf<String>()
        val card = BotQuestion("bot-release", "Release Lead", Http.json.decodeFromString(InputRequest.serializer(), """
            {"id":"q-one","category":"preference","question":"Which regions ship today?","options":["a","b"],
             "questions":[{"question":"Which regions ship today?","options":["x","y"],"multiSelect":true}]}
        """))
        screen { BotQuestionCard(card, onOpen = {}, onConnect = {}, onAnswer = { answers += it }, onForm = { sent += it }, showsFrom = false) }
        // The entry's own options, picked rather than answered by a tap.
        compose.onAllNodesWithTag("bot-question-option").assertCountEquals(2)
        compose.onNodeWithText("x").performClick()
        compose.onNodeWithText("y").performClick()
        compose.onNodeWithText("x").assertIsSelected()
        compose.onNodeWithText("y").assertIsSelected()
        assertTrue(answers.isEmpty() && sent.isEmpty())
        compose.onNodeWithTag("bot-question-send").performScrollTo().performClick()
        assertEquals(listOf("""{"choices":["x","y"]}"""), sent.map { it.compact })
        assertTrue(answers.isEmpty())
    }

    /** Words being typed, and the box they are in, outlive a rotation or the process, as before #3468. */
    @Test fun wordsBeingTypedSurviveRecreation() {
        val tester = StateRestorationTester(compose)
        val deploy = BotQuestion("bot-release", "Release Lead",
            InputRequest("q-deploy", "approval", "Roll out 1.4 to production?", listOf("Ship it", "Wait for QA")))
        tester.setContent { NuphosTheme { Surface { BotQuestionCard(deploy, onOpen = {}, onConnect = {}, onAnswer = {}, showsFrom = false) } } }
        compose.onNodeWithTag("bot-question-other").performClick()
        compose.onNodeWithTag("bot-question-answer").performTextInput("After QA signs off")
        tester.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag("bot-question-answer").assertTextContains("After QA signs off")
        compose.onNodeWithTag("bot-question-send").assertIsEnabled()
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

    /** Saved to the additional test output, which CI uploads with the device test report. */
    private fun artifact(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.externalMediaDirs.first(), "additional_test_output").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "review-3468-$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
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

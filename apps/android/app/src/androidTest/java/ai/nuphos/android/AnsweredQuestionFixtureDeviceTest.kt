package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.AnsweredQuestion
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.ui.chat.AnsweredLine
import ai.nuphos.android.ui.theme.NuphosTheme
import java.io.File
import java.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Synthetic UI only; no auth, transport or production activity. */
@RunWith(AndroidJUnit4::class)
class AnsweredQuestionFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val asked = Instant.parse("2026-11-14T01:12:00Z")
    private val answered = Instant.parse("2026-11-14T01:47:00Z")
    private val questions = listOf(
        AnsweredQuestion(
            "Yuanlin Lin", "How should I run the sessions migration?", "Online, about 3 hours",
            "The migration touches the `sessions` table.\n\n- **Online** keeps the API up.\n- **Offline** needs a 20 minute window.",
            listOf("Online, about 3 hours", "Offline, 20 minute window", "Not yet"), asked, answered,
        ),
        AnsweredQuestion("Yuanlin Lin", "Which platforms ship today?", "Desktop, iOS", null, listOf("Desktop", "iOS", "Android"), asked, answered),
        AnsweredQuestion("Yuanlin Lin", "What goes in the changelog?", "One line about the answered notice, nothing else.", null, listOf("Nothing"), asked, answered),
    )

    private fun capture(name: String) {
        compose.waitForIdle()
        val inst = InstrumentationRegistry.getInstrumentation()
        inst.waitForIdleSync()
        android.os.SystemClock.sleep(500)
        File(inst.targetContext.getExternalFilesDir(null), name).outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun answeredQuestionsAreOneLineEachAndOpenToTheirCard() {
        compose.setContent {
            NuphosTheme {
                Surface {
                    Column(
                        Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(horizontal = 16.dp).verticalScroll(rememberScrollState()),
                    ) {
                        questions.forEachIndexed { index, question -> AnsweredLine(ChatRow.Answered("answered.$index", question)) {} }
                    }
                }
            }
        }
        compose.onAllNodesWithTag("answered-line").assertCountEquals(3)
        compose.onAllNodesWithTag("answered-line")[0].assertHeightIsAtLeast(48.dp)
        compose.onNodeWithText("Offline, 20 minute window").assertDoesNotExist()
        capture("answered-collapsed-light.png")
        compose.onAllNodesWithTag("answered-line")[0].performClick()
        compose.onNodeWithText("Offline, 20 minute window").assertIsDisplayed()
        capture("answered-choice-expanded-light.png")
        compose.onAllNodesWithTag("answered-line")[0].performClick()
        compose.onAllNodesWithTag("answered-line")[1].performClick()
        compose.onAllNodesWithTag("answered-line")[2].performClick()
        compose.onNodeWithText("Android").assertIsDisplayed()
        capture("answered-several-expanded-light.png")
    }
}

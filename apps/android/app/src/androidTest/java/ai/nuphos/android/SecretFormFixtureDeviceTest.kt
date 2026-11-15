package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.session.ChatSession
import ai.nuphos.android.ui.chat.SecretCard
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * The secure input card for a website form's details: it names the site, lists each detail by its
 * label, masks what is typed until the person reveals it, and sends only once every field is filled.
 * A synthetic request only; no account or network, and nothing is sent.
 */
@RunWith(AndroidJUnit4::class)
class SecretFormFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    private fun ask(input: String) = ChatPart.Tool(
        toolCallId = "ask",
        toolName = "request_user_decision",
        isDynamic = false,
        state = ChatPart.Tool.State.OutputAvailable,
        input = JsonValue.parse(input),
    )

    private val form = ask(
        """{"category":"credential","question":"Looking up your appointment needs these details.","secretName":"CLINIC_LOOKUP",
            "fields":[{"name":"NATIONAL_ID","label":"National ID number"},{"name":"BIRTH_DATE","label":"Date of birth (YYYY-MM-DD)"}],
            "site":"www.clinic.example"}""",
    )
    private val single = ask("""{"category":"credential","question":"Calling the API needs your key.","secretName":"OPENAI_API_KEY"}""")

    private fun show(part: ChatPart.Tool) {
        val session = runBlocking {
            ChatSession("fixture", "team", readBypass = { _, _ -> false }, aiAllowed = { true },
                readDetail = { _, _, _ -> AgentConversationDetail(isOwner = true, messages = listOf(ChatMessage(id = "m", parts = listOf(part)))) })
                .apply { load() }
        }
        compose.setContent {
            NuphosTheme { Surface(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 24.dp)) { SecretCard(part, null, session) }
            } }
        }
    }

    @Test fun aFormsDetailsAreAskedTogetherAndMaskedUntilRevealed() {
        show(form)
        compose.onNodeWithText("Details needed for www.clinic.example").assertExists()
        compose.onNodeWithText("Send securely").assertIsNotEnabled()
        capture("form-empty")
        compose.onNodeWithTag("secret-value:ask:NATIONAL_ID").performTextInput("A123456789")
        // One field is not the form: nothing is sent until every detail is there.
        compose.onNodeWithText("Send securely").assertIsNotEnabled()
        compose.onNodeWithTag("secret-value:ask:BIRTH_DATE").performTextInput("1990-04-12")
        compose.onNodeWithText("Send securely").assertIsEnabled()
        compose.onNodeWithText("A123456789").assertDoesNotExist()
        capture("form-masked")
        compose.onNodeWithTag("secret-reveal:ask").performClick()
        compose.onNodeWithText("A123456789").assertExists()
        compose.onNodeWithText("1990-04-12").assertExists()
        capture("form-revealed")
    }

    @Test fun aSingleSecretKeepsItsOneMaskedInput() {
        show(single)
        compose.onNodeWithText("OPENAI_API_KEY").assertExists()
        compose.onNodeWithTag("secret-value:ask").assertExists()
        compose.onNodeWithTag("secret-reveal:ask").assertDoesNotExist()
        capture("single")
    }

    /** Saved under the app's files, `review-1914/`, for the PR's screenshots. */
    private fun capture(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.getExternalFilesDir(null), "review-1914").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}

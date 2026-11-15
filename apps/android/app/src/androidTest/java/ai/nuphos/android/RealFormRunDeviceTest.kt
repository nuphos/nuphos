package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.URL
import java.util.concurrent.Executors

/**
 * Local only: the form card against a real backend on the host computer. The Desktop app has
 * already started the Task and its agent has asked; this signs in on the phone, fills the card
 * in and sends it. Every step is captured, since the screens between are not fixtures.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class RealFormRunDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private val args = InstrumentationRegistry.getArguments()

    /** The helper beside the backend answers what the phone cannot read from the host. */
    private fun helper(path: String): String =
        Executors.newSingleThreadExecutor().submit<String> { URL("http://127.0.0.1:18914$path").readText() }.get()

    @Test fun theCardIsAnsweredAgainstARealBackend() {
        val email = args.getString("formEmail")
        assumeNotNull(email)
        // Sign in only when asked to: the device may keep a session across runs.
        runCatching { compose.waitUntilAtLeastOneExists(hasText("Email address"), 15_000) }.onSuccess {
            compose.onNode(hasSetTextAction() and hasText("Email address")).performTextInput(email!!)
            compose.onNodeWithText("Continue").performScrollTo().performClick()
            compose.waitUntilAtLeastOneExists(hasText("Enter the 6-digit code sent to"), 15_000)
            Thread.sleep(2_000)
            val code = Regex("\\d{6}").find(helper("/code?email=$email"))!!.value
            compose.onNodeWithContentDescription("6-digit email code").performTextInput(code)
            compose.onNodeWithText("Sign in").performClick()
        }
        // A synthetic account on a local backend: it agrees to AI use, as a person would on first sign-in.
        runCatching { compose.waitUntilAtLeastOneExists(hasText("Agree and continue"), 20_000) }.onSuccess {
            compose.onNodeWithText("Agree and continue").performScrollTo().performClick()
        }
        Thread.sleep(6_000)
        capture("1-signed-in")

        compose.waitUntilAtLeastOneExists(hasText("fill the form E2E_FORM", substring = true), 30_000)
        compose.onAllNodesWithText("fill the form E2E_FORM", substring = true).onFirst().performClick()
        compose.waitUntilAtLeastOneExists(hasText("Details needed for www.clinic.example"), 30_000)
        capture("2-card")

        compose.onNode(hasSetTextAction() and hasText("ID number")).performTextInput("E2E-ID-48213-phone")
        compose.onNode(hasSetTextAction() and hasText("Date of birth")).performTextInput("1990-04-12-phone")
        capture("3-typed")
        compose.onNodeWithText("Send securely").performClick()
        compose.waitUntilAtLeastOneExists(hasText("www.clinic.example saved on the task's runtime."), 30_000)
        // The agent's next turn answers the reply by itself.
        compose.waitUntilAtLeastOneExists(hasText("ACK E2E_DELIVERY:missing", substring = true), 60_000)
        capture("4-agent-continued")
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.getExternalFilesDir(null), "real-1914").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}

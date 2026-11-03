package ai.nuphos.android

import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.AnnotatedString
import androidx.test.espresso.Espresso
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.ui.login.EmailLoginContent
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicLong

/** Standalone synthetic content; never reads tokens, preferences or a live API. */
class EmailLoginFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val clock = AtomicLong(1_000_000L)
    private val busy = mutableStateOf(false)
    private val authError = mutableStateOf<String?>(null)
    private var requests = 0
    private var submits = 0
    private var passwordSubmits = 0
    private var cancellations = 0
    private var dismissals = 0
    private var transport: suspend () -> Unit = {}

    @Before fun isolatedPackageOnly() {
        check(InstrumentationRegistry.getInstrumentation().targetContext.packageName == "ai.nuphos.android.emailfixture1335")
    }
    @androidx.compose.runtime.Composable
    private fun content() {
        Surface {
            EmailLoginContent(busy.value, authError.value,
                onSubmit = { email, code ->
                    assertEquals("fixture@example.com", email); assertEquals(6, code.length)
                    submits++; busy.value = true
                },
                onPasswordSubmit = { email, password ->
                    assertEquals("fixture@example.com", email); assertEquals("synthetic-password", password)
                    passwordSubmits++; busy.value = true
                },
                onCancel = { cancellations++; busy.value = false },
                onDismissError = { dismissals++; authError.value = null },
                alternatives = { Text("Synthetic alternatives") },
                nowMillis = clock::get,
                requestCode = { assertEquals("fixture@example.com", it); requests++; transport() },
            )
        }
    }
    private val dark get() = InstrumentationRegistry.getArguments().getString("darkTheme") == "true"
    private fun render() { compose.setContent { NuphosTheme(darkTheme = dark) { content() } } }
    private fun typeEmail() { compose.onNodeWithText("Email address").performTextInput("fixture@example.com") }
    private fun send() {
        typeEmail()
        compose.onNodeWithText("Continue").performScrollTo().performClick()
        compose.waitUntil { requests == 1 }
        compose.waitUntil { compose.onAllNodesWithText("Check your email").fetchSemanticsNodes().isNotEmpty() }
    }
    private fun code() = compose.onNodeWithContentDescription("6-digit email code")
    private fun advance(millis: Long) {
        clock.addAndGet(millis)
        compose.mainClock.advanceTimeBy(1_100)
        compose.waitForIdle()
    }
    private fun shot(name: String) {
        compose.waitForIdle()
        val inst = InstrumentationRegistry.getInstrumentation()
        java.io.File(inst.targetContext.getExternalFilesDir(null), "$name-${if (dark) "dark" else "light"}.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun captureSyntheticWelcomeAndCodeScreens() {
        render()
        compose.onNodeWithText("Continue").assertIsNotEnabled()
        compose.onNodeWithText("Synthetic alternatives").assertExists()
        shot("email-welcome")
        send()
        shot("email-code")
        code().performTextInput("123456")
        compose.onNodeWithText("Sign in").performClick()
        compose.runOnIdle { busy.value = false; authError.value = "That code is invalid or has expired. Request a new code." }
        shot("email-code-error")
    }

    @Test fun continueSendsOnceAndOpensTheCodeScreenWithoutPasswordReset() {
        render(); send()
        compose.onNodeWithText("Enter the 6-digit code sent to").assertExists()
        compose.onNodeWithText("fixture@example.com").assertExists()
        compose.onNodeWithText("The code expires in 10 minutes.").assertExists()
        compose.onNodeWithText("Set or reset my password").assertDoesNotExist()
        compose.onNodeWithText("Sign in").assertIsNotEnabled()
        code().performTextInput("12a3456789")
        code().assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("123456")))
        compose.onNodeWithText("Sign in").assertIsEnabled().performClick()
        compose.onNodeWithText("Please wait…").assertIsNotEnabled()
        assertEquals(1, submits); assertEquals(1, requests)
    }

    @Test fun resendWaitsSixtySecondsAndClearsTheCode() {
        render(); send()
        compose.onNodeWithText("Resend code in 60s").assertExists()
        compose.onNodeWithText("Resend code").assertDoesNotExist()
        code().performTextInput("123456")
        advance(60_000)
        compose.onNodeWithText("Resend code").performScrollTo().performClick()
        compose.waitUntil { requests == 2 }
        compose.onNodeWithText("Sign in").assertIsNotEnabled()
        compose.onNodeWithText("Resend code in 60s").assertExists()
    }

    @Test fun wrongCodeShowsErrorClearsOnEditAndRetriesWithoutAnotherEmail() {
        render(); send()
        code().performTextInput("123456")
        compose.onNodeWithText("Sign in").performClick()
        compose.runOnIdle { busy.value = false; authError.value = "Incorrect or expired code. Request a new code if needed." }
        compose.onNodeWithText("Incorrect or expired code. Request a new code if needed.").assertExists()
        code().performTextClearance(); code().performTextInput("654321")
        compose.onNodeWithText("Incorrect or expired code. Request a new code if needed.").assertDoesNotExist()
        assertTrue(dismissals > 0)
        compose.onNodeWithText("Sign in").performClick()
        assertEquals(2, submits); assertEquals(1, requests)
    }

    @Test fun changeAndBackKeepTheEmailAndReopenTheValidCodeWithoutResending() {
        render(); send()
        compose.onNodeWithContentDescription("Use a different email").performClick()
        compose.onNodeWithText("Email address").assert(hasText("fixture@example.com"))
        compose.onNodeWithText("Continue").performClick()
        compose.onNodeWithText("Check your email").assertExists()
        // The first Back only hides the code keyboard, as everywhere on Android.
        Espresso.closeSoftKeyboard()
        Espresso.pressBack()
        compose.onNodeWithText("Email address").assert(hasText("fixture@example.com"))
        assertEquals(1, requests); assertEquals(0, cancellations)
    }

    @Test fun backWhileVerifyingCancelsTheAttempt() {
        render(); send()
        code().performTextInput("123456")
        compose.onNodeWithText("Sign in").performClick()
        Espresso.pressBack()
        compose.onNodeWithText("Email address").assertExists()
        assertEquals(1, cancellations); assertEquals(1, submits)
    }

    @Test fun expiredCodeCannotSubmitAndCanRequestAnother() {
        render(); send()
        code().performTextInput("123456")
        advance(600_000)
        compose.onNodeWithText("Sign in").assertIsNotEnabled()
        compose.onNodeWithText("Code expired. Request a new code.").assertExists()
        compose.onNodeWithText("Resend code").performScrollTo().performClick()
        compose.waitUntil { requests == 2 }
    }

    @Test fun recreationKeepsDeliveryProgressButNeverRestoresSecrets() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent { NuphosTheme(darkTheme = dark) { content() } }
        send()
        code().performTextInput("123456")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("Check your email").assertExists()
        compose.onNodeWithText("fixture@example.com").assertExists()
        code().assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        compose.onNodeWithText("Sign in").assertIsNotEnabled()
        compose.onNodeWithText("Resend code in 60s").assertExists()
        assertEquals(1, requests)
    }

    @Test fun passwordIsASecondaryPathOnTheSameScreen() {
        render()
        typeEmail()
        compose.onNodeWithText("Use a password").performClick()
        compose.onNodeWithText("Password").performTextInput("short")
        compose.onNodeWithText("Sign in").assertIsNotEnabled()
        compose.onNodeWithText("Password").performTextClearance()
        compose.onNodeWithText("Password").performTextInput("synthetic-password")
        compose.onNodeWithText("Sign in").performScrollTo().performClick()
        assertEquals(1, passwordSubmits); assertEquals(0, requests)
        compose.runOnIdle { busy.value = false; authError.value = "The email or password is incorrect." }
        compose.onNodeWithText("The email or password is incorrect.").assertExists()
        shot("email-password-error")
        compose.onNodeWithText("Use an email code instead").performScrollTo().performClick()
        compose.onNodeWithText("Password").assertDoesNotExist()
        compose.onNodeWithText("The email or password is incorrect.").assertDoesNotExist()
        compose.onNodeWithText("Email address").assert(hasText("fixture@example.com"))
        compose.onNodeWithText("Continue").assertIsEnabled()
    }

    @Test fun canceledDeliveryStaysOnTheWelcomeScreen() {
        val held = CompletableDeferred<Unit>()
        transport = { held.await() }
        render(); typeEmail()
        compose.onNodeWithText("Continue").performClick()
        compose.waitUntil { requests == 1 }
        compose.onNodeWithText("Please wait…").assertIsNotEnabled()
        Espresso.pressBack()
        held.complete(Unit)
        compose.waitForIdle()
        compose.onNodeWithText("Check your email").assertDoesNotExist()
        assertEquals(1, cancellations); assertEquals(0, submits)
    }

    @Test fun requestFailureKeepsEmailAndDoesNotRetryAutomatically() {
        transport = { throw NuphosApi.Failure.Http(429, "untrusted transport text") }
        render(); typeEmail()
        compose.onNodeWithText("Continue").performClick()
        compose.waitUntil { requests == 1 }
        compose.onNodeWithText("Too many codes requested. Wait and try again later.").assertExists()
        compose.onNodeWithText("untrusted transport text").assertDoesNotExist()
        compose.onNodeWithText("Check your email").assertDoesNotExist()
        compose.onNodeWithText("Continue").assertIsNotEnabled()
        transport = {}
        advance(60_000)
        compose.onNodeWithText("Continue").performScrollTo().performClick()
        compose.waitUntil { requests == 2 }
        assertEquals(0, submits)
    }
}

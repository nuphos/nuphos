package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.NuphosWeb
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.login.LoginScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.io.IOException

/** Synthetic provider discovery only; never opens a browser or a provider sign-in. */
class LoginProvidersFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private lateinit var auth: AuthSession
    private lateinit var store: TokenStore
    private var loads = 0

    @Before fun isolated() {
        check(inst.targetContext.packageName == "ai.nuphos.android.emailfixture1335")
        val app = inst.targetContext.applicationContext as NuphosApplication
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("providers_fixture_$name", mode)
        }
        store = TokenStore(context)
        inst.runOnMainSync { auth = AuthSession(app, store); auth.signOut() }
    }
    @After fun cleanup() { inst.runOnMainSync { auth.signOut() }; store.clear() }

    private fun render(load: () -> List<NuphosWeb.Provider>) {
        compose.setContent {
            NuphosTheme(darkTheme = InstrumentationRegistry.getArguments().getString("darkTheme") == "true") {
                CompositionLocalProvider(LocalAuthSession provides auth) {
                    LoginScreen(loadProviders = { loads++; load() })
                }
            }
        }
        compose.waitUntil { loads > 0 }
        compose.waitForIdle()
    }

    @Test fun offeredProvidersAreSeparateButtonsInIosOrder() {
        render { NuphosWeb.providers("google,apple") }
        val apple = compose.onNodeWithText("Continue with Apple").assertIsEnabled().fetchSemanticsNode().boundsInRoot
        val google = compose.onNodeWithText("Continue with Google").assertIsEnabled().fetchSemanticsNode().boundsInRoot
        assertTrue(apple.top < google.top)
        compose.onNodeWithText("or").assertExists()
        compose.onNodeWithText("Retry sign-in options").assertDoesNotExist()
        compose.onNodeWithText("Continue with Google or Apple").assertDoesNotExist()
        compose.onNodeWithText("Email code / create account / reset password").assertDoesNotExist()
        compose.onNodeWithText("Continue").assertExists()
        compose.onNodeWithText("Use a password").assertExists()
        compose.waitForIdle()
        val theme = if (InstrumentationRegistry.getArguments().getString("darkTheme") == "true") "dark" else "light"
        java.io.File(inst.targetContext.getExternalFilesDir(null), "login-providers-$theme.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun unavailableSocialSignInShowsNoProviderButtonsOrRetry() {
        render { emptyList() }
        compose.onNodeWithText("Continue with Google").assertDoesNotExist()
        compose.onNodeWithText("Continue with Apple").assertDoesNotExist()
        compose.onNodeWithText("Retry sign-in options").assertDoesNotExist()
        compose.onNodeWithText("Continue").assertExists()
    }

    @Test fun failedDiscoveryKeepsEmailAndOffersRetry() {
        var fail = true
        render { if (fail) throw IOException("synthetic") else NuphosWeb.providers(null) }
        compose.onNodeWithText("Retry sign-in options").assertIsEnabled()
        compose.onNodeWithText("Continue with Google").assertDoesNotExist()
        compose.onNodeWithText("Email address").performTextInput("fixture@example.com")
        compose.onNodeWithText("Continue").assertIsEnabled()
        fail = false
        compose.onNodeWithText("Retry sign-in options").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("Continue with Google").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Continue with Apple").assertDoesNotExist()
        assertEquals(2, loads)
    }
}

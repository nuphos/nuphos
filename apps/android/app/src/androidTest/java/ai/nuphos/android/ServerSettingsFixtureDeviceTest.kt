package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.BackendOrigin
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.login.LoginScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Isolated package and synthetic provider discovery: no real backend or login. */
class ServerSettingsFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    @Test fun serverChangesResetTheFormAndKeepCredentialsScoped() {
        val inst = InstrumentationRegistry.getInstrumentation()
        check(inst.targetContext.packageName == "ai.nuphos.android.emailfixture1335")
        val app = inst.targetContext.applicationContext as NuphosApplication
        check(app.tokenStore.read() == null)
        val preferences = app.getSharedPreferences("nuphos.backend", Context.MODE_PRIVATE)
        val original = preferences.getString("origin", null)
        val previous = BackendOrigin.current
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("server_fixture_$name", mode)
        }
        val tokens = TokenStore(context)
        lateinit var auth: AuthSession
        inst.runOnMainSync { auth = AuthSession(app, tokens); auth.signOut() }
        try {
            compose.setContent { NuphosTheme { CompositionLocalProvider(LocalAuthSession provides auth) {
                LoginScreen(loadProviders = { emptyList() })
            } } }
            compose.onNodeWithText("Email address").performTextInput("old@example.invalid")
            compose.onNodeWithText("Server settings", substring = true).performScrollTo().performClick()
            compose.onNodeWithText("Server address").performTextReplacement("https://self.example:8443")
            compose.onNodeWithText("Save").performClick()
            compose.waitForIdle()
            assertEquals("https://self.example:8443", auth.serverOrigin)
            assertEquals(auth.serverOrigin, preferences.getString("origin", null))
            compose.onNodeWithText("old@example.invalid").assertDoesNotExist()
            BackendOrigin.bind("synthetic-server-settings", auth.serverOrigin)
            tokens.write("synthetic-server-settings")
            assertEquals("synthetic-server-settings", tokens.read())
            BackendOrigin.select(BackendOrigin.DEFAULT)
            assertNull(tokens.read())
            BackendOrigin.select(auth.serverOrigin)
            assertEquals("synthetic-server-settings", tokens.read())
            compose.onNodeWithText("Server settings", substring = true).performScrollTo().performClick()
            compose.onNodeWithText("Server address").performTextReplacement("http://self.example")
            compose.onNodeWithText("Save").performClick()
            compose.onNodeWithText("Use an HTTPS address", substring = true).assertExists()
            assertEquals("https://self.example:8443", BackendOrigin.current)
            compose.onNodeWithText("Use Nuphos Cloud").performClick()
            compose.waitForIdle()
            assertEquals(BackendOrigin.DEFAULT, auth.serverOrigin)
            assertNull(tokens.read())
        } finally {
            inst.runOnMainSync { auth.signOut() }
            (AuthSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(auth) as CoroutineScope).cancel()
            tokens.clear()
            preferences.edit().apply { if (original == null) remove("origin") else putString("origin", original) }.commit()
            BackendOrigin.select(previous)
        }
    }
}

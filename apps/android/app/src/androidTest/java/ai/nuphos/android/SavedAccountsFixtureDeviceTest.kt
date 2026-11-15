package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.BackendOrigin
import ai.nuphos.android.data.SavedAccount
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.login.LoginScreen
import ai.nuphos.android.ui.profile.ProfileContent
import ai.nuphos.android.ui.profile.SavedAccountsList
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** Synthetic saved accounts in isolated storage; no backend, login or network. */
class SavedAccountsFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val app = inst.targetContext.applicationContext as NuphosApplication
    private val ada = NuphosUser("synthetic-ada", "ada@example.invalid", "Ada Lovelace", "ada")
    private val grace = NuphosUser("synthetic-grace", "grace@example.invalid", "Grace Hopper", "grace")
    private lateinit var tokens: TokenStore
    private lateinit var auth: AuthSession

    @Before fun setUp() {
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("saved_accounts_fixture_$name", mode)
        }
        tokens = TokenStore(context)
        tokens.clear()
        tokens.accounts = listOf(
            SavedAccount(BackendOrigin.current, ada, "synthetic-ada-token"),
            SavedAccount("https://nuphos.example.com", grace, null),
        )
        inst.runOnMainSync { auth = AuthSession(app, tokens) }
    }

    @After fun tearDown() {
        (AuthSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(auth) as CoroutineScope).cancel()
        tokens.accounts = emptyList()
        tokens.clear()
    }

    @Test fun signInListsSavedAccountsAndSignsOutOnlyTheChosenOne() {
        inst.runOnMainSync { auth.restore() }
        compose.setContent { NuphosTheme { CompositionLocalProvider(LocalAuthSession provides auth) {
            LoginScreen(loadProviders = { emptyList() })
        } } }
        compose.waitUntil(5_000) { auth.state is AuthSession.State.SignedOut }
        compose.onNodeWithText("Ada Lovelace").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Sign in again").assertIsDisplayed()
        compose.onNodeWithText("nuphos.example.com").assertIsDisplayed()
        shot("login-after")
        compose.onNodeWithContentDescription("Account options for grace@example.invalid").performClick()
        compose.onNodeWithText("Sign out").performClick()
        shot("login-sign-out")
        compose.onAllNodesWithText("Sign out").onLast().performClick()
        compose.waitForIdle()
        assertEquals(listOf("synthetic-ada"), tokens.accounts.map { it.user.id })
        assertEquals("synthetic-ada-token", tokens.accounts.single().token)
        compose.onNodeWithText("Grace Hopper").assertDoesNotExist()
    }

    @Test fun loginWithoutSavedAccountsLooksAsBefore() {
        tokens.accounts = emptyList()
        inst.runOnMainSync { auth.restore() }
        compose.setContent { NuphosTheme { CompositionLocalProvider(LocalAuthSession provides auth) {
            LoginScreen(loadProviders = { emptyList() })
        } } }
        compose.waitUntil(5_000) { auth.state is AuthSession.State.SignedOut }
        compose.onNodeWithTag("saved-accounts").assertDoesNotExist()
        shot("login-before")
    }

    @Test fun accountSheetMarksTheCurrentAccountAndOffersAddAccount() {
        inst.runOnMainSync {
            auth.restore()
        }
        compose.waitUntil(5_000) { auth.state is AuthSession.State.SignedOut }
        inst.runOnMainSync {
            // Signed in as Ada without a network round trip.
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, "synthetic-ada-token")
            @Suppress("UNCHECKED_CAST")
            (AuthSession::class.java.getDeclaredField("state\$delegate").also { it.isAccessible = true }.get(auth) as MutableState<Any?>)
                .value = AuthSession.State.SignedIn(ada)
        }
        profile(withAccounts = true)
        compose.onNodeWithContentDescription("Active account").assertIsDisplayed()
        compose.onNodeWithTag("saved-account-synthetic-ada").assertIsSelected()
        compose.onNodeWithText("Add account").assertIsDisplayed()
        shot("profile-after")
    }

    @Test fun accountSheetWithoutTheListLooksAsBefore() {
        profile(withAccounts = false)
        shot("profile-before")
    }

    private fun profile(withAccounts: Boolean) {
        compose.setContent { NuphosTheme { CompositionLocalProvider(LocalAuthSession provides auth) {
            Surface(Modifier.fillMaxSize()) { Column(Modifier.systemBarsPadding()) {
                Text("SYNTHETIC ACCOUNTS · no network")
                ProfileContent(
                    user = ada, canWithdraw = true, consentBusy = false, consentError = null,
                    onEdit = {}, onDevices = {}, onTwoFactor = {}, onPrivacy = {}, onWithdraw = {}, onDeletion = {}, onSignOut = {},
                    voiceSettings = { Text("Voice input") },
                    accounts = if (withAccounts) ({ SavedAccountsList(auth, allowAdding = true) }) else null,
                )
            } }
        } } }
    }

    private fun shot(name: String) {
        compose.mainClock.advanceTimeBy(800)
        compose.waitForIdle()
        android.os.SystemClock.sleep(350)
        val dir = java.io.File(inst.targetContext.getExternalFilesDir(null), "saved-accounts").apply { mkdirs() }
        val bitmap = inst.uiAutomation.takeScreenshot()
        java.io.File(dir, "$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}

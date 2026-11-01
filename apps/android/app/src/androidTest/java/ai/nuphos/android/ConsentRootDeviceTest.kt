package ai.nuphos.android

import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.NuphosRoot
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

/** Exercises the production Root, not a copy of its destination predicate. No external network. */
@RunWith(AndroidJUnit4::class)
class ConsentRootDeviceTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var app: NuphosApplication
    private lateinit var auth: AuthSession
    private lateinit var client: OkHttpClient
    private lateinit var oldRevoked: () -> Unit
    private var access: Any? = null
    @Volatile private var reply = "failure"
    @Suppress("UNCHECKED_CAST")
    private fun state(owner: Any, name: String, delegated: Boolean = true) =
        owner.javaClass.getDeclaredField(name + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(owner) as MutableState<Any?>

    @Before fun setUp() {
        app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
        Assume.assumeTrue("Disposable navigation fixture only", app.packageName == "ai.nuphos.android.navigation1371")
        access = state(AiAccess, "state", false).value
        oldRevoked = AiAccess.onRevoked
        AiAccess.onRevoked = {}
        AiAccess.activate("synthetic-root")
        auth = AuthSession(app, app.tokenStore)
        AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, "synthetic-root")
        state(auth, "state").value = AuthSession.State.SignedIn(NuphosUser("synthetic-root"))
        client = Http.client
        val fixture = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            check(request.url.encodedPath == "/auth/ai-consent" && request.method == "GET")
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(if (reply == "failure") 503 else 200).message("synthetic")
                .body((if (reply == "failure") "{}" else
                    "{\"version\":\"${if (reply == "version") "future-version" else "2026-09-28"}\",\"accepted\":false}")
                    .toResponseBody(Http.jsonMedia)).build()
        }.build()
        Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, fixture)
    }

    @After fun tearDown() {
        if (::client.isInitialized) Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, client)
        if (::oldRevoked.isInitialized) {
            AiAccess.onRevoked = oldRevoked
            state(AiAccess, "state", false).value = access
        }
    }

    private fun renderAndLoad() {
        compose.setContent { NuphosTheme { NuphosRoot(auth) } }
        compose.runOnIdle { auth.loadAIConsent() }
        compose.waitUntil(10_000) { !auth.consentBusy }
    }

    @Test fun failedLookupDoesNotAskForConsentAndRetryCanShowRealDecline() {
        renderAndLoad()
        compose.onNodeWithText("Couldn’t verify your AI sharing choice").assertIsDisplayed()
        compose.onNodeWithText("Agree and continue").assertDoesNotExist()
        assertFalse(auth.aiAllowed)
        reply = "rejected"
        compose.onNodeWithText("Retry loading consent").performClick()
        compose.waitUntil(10_000) { !auth.consentBusy && auth.consentVersion == "2026-09-28" }
        compose.onNodeWithText("Before you use AI agents").assertIsDisplayed()
        compose.onNodeWithText("Couldn’t verify your AI sharing choice").assertDoesNotExist()
        assertFalse(auth.aiAllowed)
    }

    @Test fun incompatibleVersionRemainsBlockedInRecovery() {
        reply = "version"
        renderAndLoad()
        compose.onNodeWithText("Couldn’t verify your AI sharing choice").assertIsDisplayed()
        compose.onNodeWithText("Agree and continue").assertDoesNotExist()
        compose.onNodeWithText("Retry loading consent").assertIsEnabled()
        assertFalse(auth.aiAllowed)
    }
}

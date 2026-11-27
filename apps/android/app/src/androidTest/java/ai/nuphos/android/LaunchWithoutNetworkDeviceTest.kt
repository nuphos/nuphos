package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.AccountApi
import ai.nuphos.android.data.BackendOrigin
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.SavedAccount
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.session.LaunchConsent
import ai.nuphos.android.ui.NuphosRoot
import ai.nuphos.android.ui.theme.NuphosTheme
import java.io.File
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A launch with a saved account opens Home from the device, then checks it with the server (#5221).
 * Every request is answered here, on the device; no server or credentials are used.
 */
@RunWith(AndroidJUnit4::class)
class LaunchWithoutNetworkDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val app = inst.targetContext.applicationContext as NuphosApplication
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val requests = CopyOnWriteArrayList<String>()
    private val token = "synthetic-launch-token"
    private val ada = NuphosUser("synthetic-ada", "ada@example.invalid", "Ada Lovelace", "ada")
    private val team = "aaaaaaaaaaaaaaaaaaaaaaaa"
    private lateinit var tokens: TokenStore
    private lateinit var consent: LaunchConsent
    private var consentBefore: String? = null
    private var accessBefore: Any? = null
    private lateinit var revokedBefore: () -> Unit
    private var auth: AuthSession? = null

    /** `ok`, `offline` or `rejected`, and whom `/auth/me` names. */
    @Volatile private var me = "ok"
    @Volatile private var meUser = "synthetic-ada"
    /** `accepted`, `withdrawn`, `changed` or `offline`. */
    @Volatile private var aiConsent = "accepted"
    private val meHeld = CountDownLatch(1)
    @Volatile private var meRelease: CountDownLatch? = null

    private fun ago(seconds: Long) = java.time.Instant.now().minusSeconds(seconds).toString()
    @Suppress("UNCHECKED_CAST")
    private fun accessState() = AiAccess::class.java.getDeclaredField("state").also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>
    private val consentPrefs get() = app.getSharedPreferences("nuphos.launch-consent", Context.MODE_PRIVATE)

    @Before fun setUp() {
        inst.uiAutomation.grantRuntimePermission(app.packageName, android.Manifest.permission.POST_NOTIFICATIONS)
        accessBefore = accessState().value
        revokedBefore = AiAccess.onRevoked
        AiAccess.onRevoked = {}
        inst.runOnMainSync { AiAccess.revoke() }
        consentBefore = consentPrefs.getString("accepted", null)
        consent = LaunchConsent.preferences(app)
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("launch_fixture_$name", mode)
        }
        tokens = TokenStore(context)
        tokens.clear()
        tokens.accounts = listOf(SavedAccount(BackendOrigin.current, ada, token))
        tokens.write(token)
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            requests += "${request.method} $path"
            fun reply(code: Int, body: String) = Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(code).message("launch fixture").body(body.toResponseBody(Http.jsonMedia)).build()
            if (path == "/auth/me") {
                meHeld.countDown()
                meRelease?.let { check(it.await(15, TimeUnit.SECONDS)) { "Held /auth/me not released" } }
                return@addInterceptor when (me) {
                    "offline" -> throw IOException("Synthetic offline")
                    "rejected" -> reply(401, "{}")
                    else -> reply(200, """{"id":"$meUser","name":"Ada Lovelace","username":"ada","email":"ada@example.invalid","avatarURL":""}""")
                }
            }
            if (me == "offline") throw IOException("Synthetic offline")
            when {
                path == "/auth/ai-consent" && request.method == "GET" -> when (aiConsent) {
                    "offline" -> throw IOException("Synthetic offline")
                    "withdrawn" -> reply(200, """{"version":"${AccountApi.AI_CONSENT_VERSION}","accepted":false}""")
                    "changed" -> reply(200, """{"version":"2099-01-01","accepted":true}""")
                    else -> reply(200, """{"version":"${AccountApi.AI_CONSENT_VERSION}","accepted":true}""")
                }
                path == "/auth/sessions/current" -> reply(204, "")
                path == "/teams" -> reply(200, """{"teams":[{"id":"$team","name":"Example Labs"}]}""")
                path == "/agent/conversations" -> reply(200, """{"conversations":[
                    {"sessionId":"launch-one","teamId":"$team","title":"Draft the release notes","isOwner":true,"createdAt":"${ago(7_200)}","lastActiveAt":"${ago(300)}"},
                    {"sessionId":"launch-two","teamId":"$team","title":"Check the staging deploy","isOwner":true,"createdAt":"${ago(86_400)}","lastActiveAt":"${ago(3_600)}"}]}""")
                path.endsWith("/favorites") -> reply(200, """{"entries":[],"revision":0}""")
                path.endsWith("/members") -> reply(200, """{"members":[]}""")
                path.endsWith("/agent-runtimes/quota") -> reply(200, """{"quotas":[]}""")
                path.endsWith("/agent-runtimes") -> reply(200, """{"runtimes":[{"id":"r1","provider":"codex","label":"Example runtime","status":"active","kind":"managed"}]}""")
                path == "/agent/plans" -> reply(200, """{"plans":[]}""")
                path == "/agent/devices" -> reply(200, """{"devices":[]}""")
                path == "/agent/credential-options" -> reply(200, """{"options":{}}""")
                else -> reply(200, "{}")
            }
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient
            field.set(null, client)
        }
    }

    @After fun tearDown() {
        meRelease?.countDown()
        auth?.let { session ->
            val scope = AuthSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(session) as CoroutineScope
            runBlocking { scope.coroutineContext[Job]!!.children.toList().forEach { it.cancelAndJoin() } }
        }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
        tokens.accounts = emptyList()
        tokens.clear()
        consentPrefs.edit().apply { consentBefore?.let { putString("accepted", it) } ?: remove("accepted") }.commit()
        AiAccess.onRevoked = revokedBefore
        inst.runOnMainSync { accessState().value = accessBefore }
    }

    private fun launch(): AuthSession {
        lateinit var session: AuthSession
        inst.runOnMainSync { session = AuthSession(app, tokens) }
        auth = session
        compose.setContent { NuphosTheme { NuphosRoot(session) } }
        return session
    }

    private fun awaitText(text: String) = compose.waitUntil(10_000) {
        compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
    }

    @Test fun savedAccountOpensHomeBeforeTheServerAnswers() {
        consent.remember(token, ada.id, AccountApi.AI_CONSENT_VERSION)
        meRelease = CountDownLatch(1)
        val auth = launch()
        assertTrue(meHeld.await(10, TimeUnit.SECONDS))
        compose.waitUntil(10_000) { auth.aiAllowed }
        assertEquals(AuthSession.State.SignedIn(ada), auth.state)
        awaitText("Draft the release notes")
        capture("launch-1-home-before-auth-me")
        meRelease!!.countDown()
        compose.waitUntil(10_000) { requests.contains("GET /auth/ai-consent") && !auth.consentBusy }
        assertTrue(auth.aiAllowed)
        assertEquals(token, tokens.read())
    }

    @Test fun offlineLaunchStaysOnHome() {
        consent.remember(token, ada.id, AccountApi.AI_CONSENT_VERSION)
        me = "offline"
        val auth = launch()
        compose.waitUntil(10_000) { requests.contains("GET /auth/me") }
        compose.waitUntil(10_000) { auth.aiAllowed }
        compose.onNodeWithText("We could not reach Nuphos", substring = true).assertDoesNotExist()
        compose.waitForIdle()
        assertEquals(AuthSession.State.SignedIn(ada), auth.state)
        assertTrue(auth.aiAllowed)
        assertEquals(token, tokens.read())
        capture("launch-2-offline-home")
        // The next resume checks again, and an answer from the server then confirms the account.
        me = "ok"
        compose.runOnIdle { auth.onHostResumed() }
        compose.waitUntil(10_000) { requests.contains("GET /auth/ai-consent") && !auth.consentBusy }
        assertTrue(auth.aiAllowed)
    }

    @Test fun offlineConsentCheckKeepsHome() {
        consent.remember(token, ada.id, AccountApi.AI_CONSENT_VERSION)
        aiConsent = "offline"
        val auth = launch()
        compose.waitUntil(10_000) { requests.contains("GET /auth/ai-consent") && !auth.consentBusy }
        compose.waitForIdle()
        assertTrue(auth.aiAllowed)
        assertNull(auth.consentError)
        compose.onNodeWithText("Couldn’t verify your AI sharing choice").assertDoesNotExist()
    }

    @Test fun rejectedTokenSignsOut() {
        consent.remember(token, ada.id, AccountApi.AI_CONSENT_VERSION)
        me = "rejected"
        val auth = launch()
        compose.waitUntil(10_000) { auth.state is AuthSession.State.SignedOut }
        assertEquals(AuthSession.State.SignedOut("This account’s session expired. Sign in again."), auth.state)
        assertFalse(auth.aiAllowed)
        assertNull(tokens.read())
        assertEquals(listOf(SavedAccount(BackendOrigin.current, ada, null)), tokens.accounts)
        assertFalse(consent.accepted(token, ada.id))
        awaitText("This account’s session expired. Sign in again.")
        capture("launch-3-rejected-signs-out")
    }

    @Test fun anotherUsersTokenSignsOut() {
        consent.remember(token, ada.id, AccountApi.AI_CONSENT_VERSION)
        meUser = "synthetic-grace"
        val auth = launch()
        compose.waitUntil(10_000) { auth.state is AuthSession.State.SignedOut }
        assertNull(tokens.read())
        assertFalse(auth.aiAllowed)
    }

    @Test fun consentForAnotherAccountWaitsForTheServer() {
        consent.remember(token, "synthetic-grace", AccountApi.AI_CONSENT_VERSION)
        meRelease = CountDownLatch(1)
        val auth = launch()
        assertTrue(meHeld.await(10, TimeUnit.SECONDS))
        compose.waitForIdle()
        assertEquals(AuthSession.State.Restoring, auth.state)
        assertFalse(auth.aiAllowed)
        meRelease!!.countDown()
        compose.waitUntil(10_000) { auth.aiAllowed }
        assertEquals("synthetic-ada", auth.user?.id)
        assertTrue("The server's answer is kept for the next launch", consent.accepted(token, ada.id))
    }

    @Test fun withdrawnConsentReturnsToTheNotice() {
        consent.remember(token, ada.id, AccountApi.AI_CONSENT_VERSION)
        aiConsent = "withdrawn"
        val auth = launch()
        compose.waitUntil(10_000) { requests.contains("GET /auth/ai-consent") && !auth.consentBusy }
        assertFalse(auth.aiAllowed)
        awaitText("Before you use AI agents")
        assertFalse(consent.accepted(token, ada.id))
    }

    @Test fun changedNoticeReturnsToRecovery() {
        consent.remember(token, ada.id, AccountApi.AI_CONSENT_VERSION)
        aiConsent = "changed"
        val auth = launch()
        compose.waitUntil(10_000) { requests.contains("GET /auth/ai-consent") && !auth.consentBusy }
        assertFalse(auth.aiAllowed)
        awaitText("Couldn’t verify your AI sharing choice")
        assertFalse(consent.accepted(token, ada.id))
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        Thread.sleep(1_000)
        val directory = File(inst.targetContext.getExternalFilesDir(null), "launch-evidence").apply { mkdirs() }
        val bitmap = inst.uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$name.png").outputStream().use { check(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)) }
    }
}

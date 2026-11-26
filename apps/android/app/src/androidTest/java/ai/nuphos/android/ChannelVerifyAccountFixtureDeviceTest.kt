package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chats.ChannelScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import java.io.File
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Synthetic chat only (#3967): a Bot whose Claude account Anthropic holds offers its owner
 * Verify with Anthropic first, then Switch runtime, then Retry. Never touches a live API. */
@RunWith(AndroidJUnit4::class)
class ChannelVerifyAccountFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-verify-account"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private val ask = """{"id":"ask","role":"user","metadata":{"version":1,"sender":{"type":"user","id":"viewer","displayName":"Preview User"},"sentAt":"2026-11-20T05:00:00Z"},"parts":[{"type":"text","text":"Can you check the release notes?"}]}"""
    private val held = """{"kind":"agent_reply_failed","at":"2026-11-20T05:00:05Z","agentId":"agent-ops","cause":"usage_limit","text":"Release ops couldn’t reply: its Claude Code account must be verified with Anthropic.","verifyUrl":"https://portal.anthropic.com/verify"}"""

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("verify-account-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            val body = when {
                path.endsWith("/agent/conversations/chat-a") ->
                    """{"kind":"channel","group":true,"title":"Launch plan","transcriptUpdatedAt":"t1","messageCount":1,"activitySeq":1,"messages":[$ask],"timelineEvents":[$held]}"""
                path.endsWith("/agents") -> """{"agents":[{"sessionId":"agent-ops","title":"Release ops","ownerId":"viewer"}]}"""
                path.endsWith("/ai-consent") -> """{"version":"${ai.nuphos.android.data.AccountApi.AI_CONSENT_VERSION}","accepted":true}"""
                path.endsWith("/auth/me") -> """{"id":"viewer","email":"viewer@example.com","name":"Preview User"}"""
                path.endsWith("/agent/conversations") -> """{"conversations":[],"hasMore":false}"""
                path.endsWith("/read") -> """{"activitySeq":1,"readSeq":1,"unread":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("verify_account_fixture_$name", mode)
        }
        tokens = TokenStore(authContext)
        tokens.write(token)
        inst.runOnMainSync {
            savedAccess = access().value
            // Signed in as the Bot's owner, through the app's own restore.
            auth = AuthSession(app, tokens); auth.restore()
        }
        var ready = false
        repeat(100) { if (!ready) { inst.runOnMainSync { ready = auth.user != null && auth.aiAllowed }; Thread.sleep(50) } }
        assertTrue("The synthetic sign-in did not finish", ready)
        inst.runOnMainSync {
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(team), team.id)
        }
    }

    @After fun after() {
        inst.runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            if (::auth.isInitialized) auth.signOut()
            access().value = savedAccess
        }
        if (::tokens.isInitialized) tokens.clear()
        Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, original)
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        inst.waitForIdleSync()
        File(inst.targetContext.getExternalFilesDir(null), name).outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun aHeldAccountOffersVerifyFirst() {
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    ChannelScreen("chat-a", onBack = { fail("The chat closed itself") }, onLink = {})
                }
            }
        }
        compose.waitUntil(8_000) { compose.onAllNodesWithText("Verify with Anthropic").fetchSemanticsNodes().isNotEmpty() }
        capture("verify-account-light.png")
        val verify = compose.onNodeWithText("Verify with Anthropic").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        val switch = compose.onNodeWithText("Switch runtime").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        val retry = compose.onNodeWithText("Retry").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        // In reading order: the row wraps on a narrow phone.
        fun before(a: androidx.compose.ui.geometry.Rect, b: androidx.compose.ui.geometry.Rect) =
            a.top < b.top - 1 || (kotlin.math.abs(a.top - b.top) <= 1 && a.left < b.left)
        assertTrue("Verify, then Switch runtime, then Retry", before(verify, switch) && before(switch, retry))
    }
}
